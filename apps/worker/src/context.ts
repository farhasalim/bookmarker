import type { Db } from '@bookmarker/db';
import type { Mailer } from '@bookmarker/mail';
import type { Logger } from 'pino';

export interface JobContext {
  db: Db;
  mailer: Mailer;
  logger: Logger;
  appUrl: string;
  /** Tell open browser tabs a notification arrived (Redis pub/sub to the API). */
  ping: (userId: string, notificationId: string) => Promise<void>;
}

export const roomUrl = (appUrl: string, roomId: string) => `${appUrl}/rooms/${roomId}`;
