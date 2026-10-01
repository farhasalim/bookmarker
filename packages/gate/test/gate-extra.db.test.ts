import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '@bookmarker/db';
import { seed, type SeedResult } from '@bookmarker/db/seed';
import { resetDb } from '@bookmarker/db/testing';
import {
  canSeePostNow,
  countOwnPosts,
  createReply,
  editOwnPost,
  fileReport,
  getMyReview,
  getVisibleReply,
  highestPostedPosition,
  loadRoomAccess,
  locatePost,
  mayNotifyAboutPost,
  openReports,
  ownContent,
  postForReport,
  resolveReportsFor,
  softDeletePost,
  viewerCanSee,
  waitingCountAt,
  type RoomAccess,
} from '../src/index.ts';

const db = createDb();
let s: SeedResult;
const access = async (u: string) => (await loadRoomAccess(db, u, s.roomId)) as RoomAccess;
const postAt = (p: number, a: string) =>
  s.posts.find((x) => x.position === p && x.authorId === a)!.id;

beforeEach(async () => {
  await resetDb(db);
  s = await seed(db);
});
afterAll(() => db.$disconnect());

describe('send-time checks', () => {
  it('canSeePostNow follows the bookmark, membership and deletion', async () => {
    const p10 = postAt(10, s.users.rahul);
    expect(await canSeePostNow(db, s.users.anu, p10)).toBe(true);
    expect(await canSeePostNow(db, s.users.meera, p10)).toBe(false);
    expect(await canSeePostNow(db, s.users.rahul, p10)).toBe(true); // author
    expect(await canSeePostNow(db, s.users.outsider, p10)).toBe(false);
    await db.post.update({ where: { id: p10 }, data: { deletedAt: new Date() } });
    expect(await canSeePostNow(db, s.users.anu, p10)).toBe(false);
  });

  it('mayNotifyAboutPost never includes the author', async () => {
    const p8 = postAt(8, s.users.anu);
    expect(await mayNotifyAboutPost(db, s.users.rahul, p8)).toBe(true);
    expect(await mayNotifyAboutPost(db, s.users.anu, p8)).toBe(false);
    expect(await mayNotifyAboutPost(db, s.users.meera, p8)).toBe(false);
  });

  it('viewerCanSee mirrors the rule', async () => {
    const { viewer } = await access(s.users.meera);
    expect(viewerCanSee(viewer, { authorId: s.users.anu, position: 3 })).toBe(true);
    expect(viewerCanSee(viewer, { authorId: s.users.anu, position: 4 })).toBe(false);
  });
});

describe('small reads', () => {
  it('getVisibleReply is gated by its post', async () => {
    const r = s.replies.find((x) => x.position === 8)!;
    await expect(
      getVisibleReply(db, (await access(s.users.meera)).viewer, r.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getVisibleReply(db, (await access(s.users.rahul)).viewer, r.id),
    ).resolves.toMatchObject({ id: r.id });
  });

  it('counts, waiting counts and the highest posted chapter', async () => {
    const meera = (await access(s.users.meera)).viewer;
    expect(await countOwnPosts(db, meera)).toBe(3);
    expect(await waitingCountAt(db, meera, s.chapterIds[9]!)).toBe(2);
    expect(await waitingCountAt(db, (await access(s.users.anu)).viewer, s.chapterIds[9]!)).toBe(0);
    expect(await highestPostedPosition(db, s.roomId)).toBe(21);
  });

  it('locatePost reveals only the room, and nothing for deleted posts', async () => {
    const id = postAt(1, s.users.meera);
    expect(await locatePost(db, id)).toEqual({ roomId: s.roomId });
    await softDeletePost(db, await access(s.users.meera), id);
    expect(await locatePost(db, id)).toBeNull();
  });

  it('getMyReview returns mine or null', async () => {
    expect(await getMyReview(db, (await access(s.users.anu)).viewer)).toMatchObject({
      rating: 4,
      mine: true,
    });
    expect(await getMyReview(db, (await access(s.users.rahul)).viewer)).toBeNull();
  });
});

describe('writes', () => {
  it('editOwnPost edits only my own, undeleted post', async () => {
    const meera = (await access(s.users.meera)).viewer;
    await expect(editOwnPost(db, meera, postAt(3, s.users.meera), 'new')).resolves.toMatchObject({
      body: 'new',
    });
    await expect(editOwnPost(db, meera, postAt(3, s.users.rahul), 'x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('a reply on my own post records who wrote the post', async () => {
    const rahul = (await access(s.users.rahul)).viewer;
    const out = await createReply(db, rahul, postAt(2, s.users.anu), 'hi');
    expect(out.postAuthorId).toBe(s.users.anu);
  });
});

describe('reports (FR-19)', () => {
  it('files, lists for hosts, hides text beyond the host, and resolves', async () => {
    const rahulA = await access(s.users.rahul);
    const target = postAt(8, s.users.anu);
    expect(await fileReport(db, rahulA, target, 'spoiler')).toBe(true);
    expect(await fileReport(db, await access(s.users.meera), target, undefined)).toBe(false); // can't see it

    const asAnu = await openReports(db, new Map([[s.roomId, await access(s.users.anu)]]));
    expect(asAnu[0]).toMatchObject({
      postId: target,
      position: 8,
      reason: 'spoiler',
      authorName: 'Anu',
    });

    const asMeera = await openReports(db, new Map([[s.roomId, await access(s.users.meera)]]));
    expect(asMeera[0]).toMatchObject({ postId: null, body: null, authorName: null, position: 8 });
    expect(await postForReport(db, asMeera[0]!.reportId)).toEqual({
      postId: target,
      roomId: s.roomId,
    });

    await resolveReportsFor(db, target, s.users.anu, new Date());
    expect(await openReports(db, new Map([[s.roomId, await access(s.users.anu)]]))).toEqual([]);
    expect(await openReports(db, new Map())).toEqual([]);
  });

  it('postForReport is null for unknown reports and deleted posts', async () => {
    expect(await postForReport(db, '019a0000-0000-7000-8000-000000000000')).toBeNull();
    const id = postAt(1, s.users.meera);
    await fileReport(db, await access(s.users.rahul), id, undefined);
    const [r] = await db.report.findMany();
    await softDeletePost(db, await access(s.users.meera), id);
    expect(await postForReport(db, r!.id)).toBeNull();
  });
});

describe('export (SEC-11)', () => {
  it('contains only what the user wrote', async () => {
    const out = await ownContent(db, s.users.meera);
    expect(out.posts).toHaveLength(3);
    expect(JSON.stringify(out)).not.toContain('SPOILER');
    expect(out.replies.length).toBeGreaterThan(0);
  });
});
