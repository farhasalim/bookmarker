import nodemailer from 'nodemailer';

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
