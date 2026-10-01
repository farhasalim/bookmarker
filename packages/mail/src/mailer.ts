import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe (added in Phase 2). */
  headers?: Record<string, string>;
}

/**
 * Anything that can send email. Plain SMTP means no provider lock-in:
 * Mailpit locally, then Resend / Brevo / Amazon SES / Postmark by changing SMTP_URL.
 */
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/**
 * Picks the transport from SMTP_URL:
 *  - smtp://… or smtps://…  real SMTP (Mailpit, Resend, Brevo, SES, …)
 *  - file:///some/dir        dev/test only: each email is written as a JSON file
 */
export function mailerFromUrl(url: string, from: string): Mailer {
  if (url.startsWith('file://')) {
    if (process.env.NODE_ENV === 'production')
      throw new Error('file:// mailer is for development only');
    return fileMailer(new URL(url).pathname);
  }
  return smtpMailer(url, from);
}

export function fileMailer(dir: string): Mailer {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    async send(msg) {
      const name = `${Date.now()}-${process.pid}-${++n}.json`;
      writeFileSync(join(dir, name), JSON.stringify(msg, null, 2));
    },
  };
}

export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}

/** Test double: keeps every message in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
  to(email: string): MailMessage[] {
    return this.sent.filter((m) => m.to === email);
  }
  clear(): void {
    this.sent.length = 0;
  }
}
