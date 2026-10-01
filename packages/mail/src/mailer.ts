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
 *  - brevo://API_KEY         Brevo's HTTPS API, for hosts that block SMTP ports
 *                            (Render's free plan does)
 *  - file:///some/dir        dev/test only: each email is written as a JSON file
 */
export function mailerFromUrl(url: string, from: string): Mailer {
  if (url.startsWith('brevo://')) return brevoMailer(url.slice('brevo://'.length), from);
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

/** "BookMarker <hello@x.org>" → { name, email }; a bare address works too. */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]!.replace(/^"|"$/g, '');
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}

/**
 * Brevo's transactional email API over HTTPS (https://developers.brevo.com).
 * Same message shape as SMTP, so switching back is one setting.
 */
export function brevoMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  if (!apiKey) throw new Error('brevo:// needs an API key: brevo://YOUR_KEY');
  const sender = parseFrom(from);
  return {
    async send(msg) {
      const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: msg.to }],
          subject: msg.subject,
          textContent: msg.text,
          htmlContent: msg.html,
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      if (!res.ok) {
        // The body explains what's wrong (bad key, unverified sender); never the email text.
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Brevo rejected the email (${res.status}): ${detail}`);
      }
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
