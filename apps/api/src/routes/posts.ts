import { Router } from 'express';
import { CreatePost, CreateReply, EditPost, Pagination } from '@bookmarker/shared';
import {
  createPost,
  createReply,
  editOwnPost,
  getVisiblePost,
  listChapterPosts,
  listReplies,
  locatePost,
  postAudience,
  setLike,
  softDeletePost,
} from '@bookmarker/gate';
import type { Tx } from '@bookmarker/db';
import type { Deps } from '../deps.ts';
import { me } from '../auth/sessions.ts';
import { notFound } from '../http/errors.ts';
import { requireRoomAccess } from '../http/access.ts';
import { limit } from '../http/rate-limit.ts';
import { recordEvent } from '../realtime/bus.ts';
import { queuePostNotifications, queueReplyNotification } from '../services/notify.ts';

/** Finds the room a chapter belongs to, then the caller's access to it (404 if none). */
async function accessForChapter(tx: Tx, userId: string, chapterId: string) {
  const chapter = await tx.chapter.findUnique({
    where: { id: chapterId },
    select: { roomId: true },
  });
  if (!chapter) throw notFound();
  return requireRoomAccess(tx, userId, chapter.roomId);
}

async function accessForPost(tx: Tx, userId: string, postId: string) {
  const loc = await locatePost(tx, postId);
  if (!loc) throw notFound();
  return requireRoomAccess(tx, userId, loc.roomId);
}

export function postRoutes(d: Deps): Router {
  const r = Router();
  const writes = limit(d.limiter, 'writes', (req) => req.user?.id ?? req.ip ?? '');
  const posting = limit(d.limiter, 'posts', (req) => req.user?.id ?? req.ip ?? '');

  r.get('/chapters/:chapterId/posts', async (req, res) => {
    const user = me(req);
    const page = Pagination.parse(req.query);
    const chapterId = String(req.params.chapterId);
    const out = await d.db.$transaction(async (tx) => {
      const { viewer } = await accessForChapter(tx, user.id, chapterId);
      return listChapterPosts(tx, viewer, chapterId, page);
    });
    res.json(out);
  });

  r.post('/chapters/:chapterId/posts', writes, posting, async (req, res) => {
    const user = me(req);
    const { body } = CreatePost.parse(req.body);
    const chapterId = String(req.params.chapterId);
    const now = d.now();
    const { post, event } = await d.db.$transaction(async (tx) => {
      const access = await accessForChapter(tx, user.id, chapterId);
      const post = await createPost(tx, access, chapterId, body);
      const room = await tx.room.findUniqueOrThrow({
        where: { id: access.viewer.roomId },
        select: { title: true },
      });
      // Audience decided by the gate NOW; re-checked by the worker at send time.
      const audience = await postAudience(tx, post.id);
      await queuePostNotifications(
        tx,
        {
          postId: post.id,
          roomId: access.viewer.roomId,
          chapterId,
          position: post.position,
          authorName: post.author.name,
          roomTitle: room.title,
        },
        audience,
        now,
      );
      const event = await recordEvent(tx, {
        type: 'post:new',
        roomId: access.viewer.roomId,
        postId: post.id,
        chapterId,
        position: post.position,
        authorId: user.id,
      });
      return { post, event };
    });
    await d.bus.publish(event);
    res.status(201).json(post);
  });

  r.get('/posts/:postId', async (req, res) => {
    const user = me(req);
    const postId = String(req.params.postId);
    const post = await d.db.$transaction(async (tx) => {
      const { viewer } = await accessForPost(tx, user.id, postId);
      return getVisiblePost(tx, viewer, postId);
    });
    res.json(post);
  });

  r.patch('/posts/:postId', writes, async (req, res) => {
    const user = me(req);
    const { body } = EditPost.parse(req.body);
    const postId = String(req.params.postId);
    const { post, event } = await d.db.$transaction(async (tx) => {
      const { viewer } = await accessForPost(tx, user.id, postId);
      const post = await editOwnPost(tx, viewer, postId, body);
      const event = await recordEvent(tx, {
        type: 'post:update',
        roomId: viewer.roomId,
        postId,
        position: post.position,
        authorId: user.id,
      });
      return { post, event };
    });
    await d.bus.publish(event);
    res.json(post);
  });

  r.delete('/posts/:postId', writes, async (req, res) => {
    const user = me(req);
    const postId = String(req.params.postId);
    const event = await d.db.$transaction(async (tx) => {
      const access = await accessForPost(tx, user.id, postId);
      // Authors delete their own here; hosts use /moderation (so it is logged as moderation).
      const own = { ...access, isHost: false };
      const del = await softDeletePost(tx, own, postId);
      return recordEvent(tx, { type: 'moderation', roomId: access.viewer.roomId, postId, ...del });
    });
    await d.bus.publish(event);
    res.status(204).end();
  });

  /* ---------------- replies and likes (FR-10) ---------------- */

  r.get('/posts/:postId/replies', async (req, res) => {
    const user = me(req);
    const postId = String(req.params.postId);
    const replies = await d.db.$transaction(async (tx) => {
      const { viewer } = await accessForPost(tx, user.id, postId);
      return listReplies(tx, viewer, postId);
    });
    res.json({ replies });
  });

  r.post('/posts/:postId/replies', writes, async (req, res) => {
    const user = me(req);
    const { body } = CreateReply.parse(req.body);
    const postId = String(req.params.postId);
    const { reply, event } = await d.db.$transaction(async (tx) => {
      const { viewer } = await accessForPost(tx, user.id, postId);
      const out = await createReply(tx, viewer, postId, body);
      const room = await tx.room.findUniqueOrThrow({
        where: { id: viewer.roomId },
        select: { title: true },
      });
      await queueReplyNotification(
        tx,
        {
          postAuthorId: out.postAuthorId,
          replierId: user.id,
          replierName: out.reply.author.name,
          postId,
          roomId: viewer.roomId,
          position: out.position,
          roomTitle: room.title,
        },
        d.now(),
      );
      const event = await recordEvent(tx, {
        type: 'reply:new',
        roomId: viewer.roomId,
        postId,
        replyId: out.reply.id,
        position: out.position,
        postAuthorId: out.postAuthorId,
      });
      return { reply: out.reply, event };
    });
    await d.bus.publish(event);
    res.status(201).json(reply);
  });

  for (const [method, liked] of [
    ['put', true],
    ['delete', false],
  ] as const) {
    r[method]('/posts/:postId/like', writes, async (req, res) => {
      const user = me(req);
      const postId = String(req.params.postId);
      const { count, event } = await d.db.$transaction(async (tx) => {
        const { viewer } = await accessForPost(tx, user.id, postId);
        const out = await setLike(tx, viewer, postId, liked);
        const event = await recordEvent(tx, {
          type: 'like:update',
          roomId: viewer.roomId,
          postId,
          position: out.position,
          authorId: out.authorId,
          count: out.count,
        });
        return { count: out.count, event };
      });
      await d.bus.publish(event);
      res.json({ postId, count, likedByMe: liked });
    });
  }

  return r;
}
