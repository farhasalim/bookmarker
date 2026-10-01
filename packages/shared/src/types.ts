/** Response shapes shared by the API and the web app. */

export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface PostDTO {
  id: string;
  chapterId: string;
  position: number;
  author: UserSummary;
  body: string;
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
  mine: boolean;
}

export interface ReplyDTO {
  id: string;
  postId: string;
  author: UserSummary;
  body: string;
  createdAt: string;
  mine: boolean;
}

/**
 * A chapter as one viewer sees it. When `unlocked` is false the viewer gets the
 * title and a count, nothing else (FR-9).
 */
export interface ChapterDTO {
  id: string;
  position: number;
  title: string;
  kind: 'chapter' | 'after_book';
  unlocked: boolean;
  /** Visible posts when unlocked; "thoughts waiting" when locked. */
  count: number;
}

export interface FriendPosition {
  userId: string;
  name: string;
  position: number;
  finished: boolean;
}

export interface RoomDTO {
  id: string;
  clubId: string;
  clubName: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  status: 'current' | 'done';
  chaptersConfirmed: boolean;
  chapterCount: number;
  me: { position: number; finished: boolean; isHost: boolean };
  chapters: ChapterDTO[];
  /** Friends' positions. Readers who hide their position are left out (FR-20). */
  friends: FriendPosition[];
  /** Highest position any reader reached or posted at; chapters at or below are frozen. */
  frozenThrough: number;
  seq: number;
}

export interface ReviewDTO {
  user: UserSummary;
  rating: number;
  body: string | null;
  isPublic: boolean;
  updatedAt: string;
  mine: boolean;
}

export interface UnlockResult {
  from: number;
  to: number;
  finished: boolean;
  posts: PostDTO[];
}

/** Socket.IO events (SRS section 7). */
export interface ServerToClientEvents {
  'post:new': (e: { roomId: string; seq: number; post: PostDTO }) => void;
  'post:update': (e: { roomId: string; seq: number; post: PostDTO }) => void;
  'reply:new': (e: { roomId: string; seq: number; reply: ReplyDTO }) => void;
  'like:update': (e: { roomId: string; seq: number; postId: string; count: number }) => void;
  'waiting:count': (e: { roomId: string; seq: number; position: number; count: number }) => void;
  'bookmark:update': (e: { roomId: string; seq: number; userId: string; position: number; finished: boolean }) => void;
  unlock: (e: { roomId: string; seq: number } & UnlockResult) => void;
  relock: (e: { roomId: string; seq: number; position: number; finished: boolean }) => void;
  finished: (e: { roomId: string; seq: number; userId: string }) => void;
  moderation: (e: { roomId: string; seq: number; postId: string; action: 'delete' }) => void;
  'notification:new': (e: { id: string }) => void;
  'room:replay-done': (e: { roomId: string; seq: number }) => void;
  /** Chapter list changed: refetch the room. */
  'room:changed': (e: { roomId: string; seq: number }) => void;
}

export interface ClientToServerEvents {
  'room:join': (e: { roomId: string; lastSeq?: number }, ack?: (r: { ok: boolean; seq?: number }) => void) => void;
  'room:leave': (e: { roomId: string }) => void;
}
