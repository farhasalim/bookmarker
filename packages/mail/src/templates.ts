import type { MailMessage } from './mailer.ts';

/**
 * Email templates. SPOILER RULE FOR EMAIL: no template takes post, reply or review
 * text as input. Emails carry names, chapter numbers and counts only, so an email
 * can never leak content even if it is forwarded or read late. The AT-1 leak sweep
 * renders every template and checks this.
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, paragraphs: string[], cta: { label: string; url: string }, footerUrl: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#DBEADA;font-family:Georgia,serif;color:#1B1F1C">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<h1 style="font-weight:500;font-size:26px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:17px;line-height:1.5;margin:0 0 14px">${esc(p)}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#3F5A2E;color:#fff;padding:12px 18px;border-radius:4px;text-decoration:none;font-family:system-ui,sans-serif;font-weight:600">${esc(cta.label)}</a></p>
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#4A5249;margin-top:32px">BookMarker never emails what anyone wrote, only where they are. <a href="${esc(footerUrl)}" style="color:#3F5A2E">Email settings</a></p>
</div></body></html>`;
  const text = `${title}\n\n${paragraphs.join('\n\n')}\n\n${cta.label}: ${cta.url}\n\n--\nEmail settings: ${footerUrl}\n`;
  return { html, text };
}

export interface Links {
  appUrl: string;
}
const settingsUrl = (l: Links) => `${l.appUrl}/settings#email`;

export function magicLinkEmail(to: string, url: string, l: Links): MailMessage {
  return {
    to,
    subject: 'Your BookMarker sign-in link',
    ...layout(
      'Sign in to BookMarker',
      ['This link signs you in. It works once and expires in 15 minutes.', 'If you did not ask for it, ignore this email.'],
      { label: 'Sign in', url },
      settingsUrl(l),
    ),
  };
}

export function postDigestEmail(
  to: string,
  d: { bookTitle: string; roomUrl: string; items: Array<{ authorName: string; position: number }> },
  l: Links,
): MailMessage {
  const n = d.items.length;
  const lines = d.items.map((i) => `${i.authorName} left a thought at chapter ${i.position}.`);
  return {
    to,
    subject: `${n} new ${n === 1 ? 'thought' : 'thoughts'} in ${d.bookTitle}`,
    ...layout(
      `New in ${d.bookTitle}`,
      [...lines, 'You have read this far, so you hear about it.'],
      { label: 'Open the book', url: d.roomUrl },
      settingsUrl(l),
    ),
  };
}

export function replyEmail(
  to: string,
  d: { replierName: string; position: number; bookTitle: string; url: string },
  l: Links,
): MailMessage {
  return {
    to,
    subject: `${d.replierName} replied to your thought in ${d.bookTitle}`,
    ...layout(
      `${d.replierName} replied`,
      [`${d.replierName} replied to your thought at chapter ${d.position} of ${d.bookTitle}.`],
      { label: 'Read the reply', url: d.url },
      settingsUrl(l),
    ),
  };
}

export function reminderEmail(
  to: string,
  d: { bookTitle: string; nextPosition: number; waiting: number; days: number; roomUrl: string },
  l: Links,
): MailMessage {
  const waitingLine =
    d.waiting === 0
      ? 'Nobody has left a thought there yet. You could be first.'
      : `${d.waiting} ${d.waiting === 1 ? 'thought is' : 'thoughts are'} already there, ready when you are.`;
  return {
    to,
    subject: `Chapter ${d.nextPosition} is waiting for you`,
    ...layout(
      `Chapter ${d.nextPosition} is waiting for you`,
      [`It has been ${d.days} days since your last chapter of ${d.bookTitle}.`, waitingLine],
      { label: `Pick up ${d.bookTitle}`, url: d.roomUrl },
      settingsUrl(l),
    ),
  };
}

export function weeklyEmail(
  to: string,
  d: {
    bookTitle: string;
    you: { position: number; finished: boolean };
    friends: Array<{ name: string; position: number; finished: boolean }>;
    roomUrl: string;
  },
  l: Links,
): MailMessage {
  const where = (p: { position: number; finished: boolean }) =>
    p.finished ? 'finished' : p.position === 0 ? 'not started' : `chapter ${p.position}`;
  const lines = d.friends.length
    ? d.friends.map((f) => `${f.name}: ${where(f)}`)
    : ['Nobody else is sharing their place this week.'];
  return {
    to,
    subject: `Where everyone is in ${d.bookTitle}`,
    ...layout(
      'Where everyone is this week',
      [`You: ${where(d.you)}.`, ...lines, "Chapter numbers only, never what's in them."],
      { label: 'Open the book', url: d.roomUrl },
      settingsUrl(l),
    ),
  };
}
