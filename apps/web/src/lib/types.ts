import type { NotificationPrefs } from '@bookmarker/shared';

/** Shapes returned by endpoints that don't have a shared DTO. */
export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  starTotal: number;
  isAdmin: boolean;
  notificationPrefs: NotificationPrefs;
  clubs: Array<{
    id: string;
    name: string;
    role: 'host' | 'member';
    positionHidden: boolean;
    currentRooms: Array<{
      id: string;
      title: string;
      author: string | null;
      coverUrl: string | null;
      chaptersConfirmed: boolean;
      chapterCount: number;
      position: number;
      finished: boolean;
    }>;
  }>;
}

export interface ClubDetail {
  id: string;
  name: string;
  description: string | null;
  plan: string;
  limits: { maxMembers: number | null; maxCurrentRooms: number | null };
  me: { role: 'host' | 'member'; positionHidden: boolean };
  rooms: Array<{
    id: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    status: 'current' | 'done';
    openedAt: string;
  }>;
  members: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    role: 'host' | 'member';
    joinedAt: string;
  }>;
}

export interface NotificationItem {
  id: string;
  type: 'post' | 'reply' | 'reminder' | 'weekly' | 'friend_finished' | string;
  payload: Record<string, unknown>;
  roomId: string | null;
  chapterId: string | null;
  postId: string | null;
  sentAt: string;
  read: boolean;
}

export interface ProfileBook {
  roomId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  rating: number | null;
  review: { body: string; spoilerGuarded: boolean } | null;
  stars: number;
}

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  readingSince: number;
  starTotal: number;
  clubs: Array<{ id: string; name: string }>;
  booksFinished: number;
  reviewsWritten: number;
  books: ProfileBook[];
}

export interface BookHit {
  title: string;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
  chapterTitles: string[] | null;
}

export interface ReportItem {
  reportId: string;
  postId: string | null;
  roomId: string;
  position: number;
  reportCount: number;
  reason: string | null;
  createdAt: string;
  body: string | null;
  authorName: string | null;
}
