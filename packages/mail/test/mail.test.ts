import { describe, expect, it } from 'vitest';
import { inQuietHours, localWeekday, nextSendableTime } from '../src/quiet-hours.ts';
import { reminderEmail, weeklyEmail } from '../src/templates.ts';
import { brevoMailer, mailerFromUrl, parseFrom } from '../src/mailer.ts';

const IST = 'Asia/Kolkata'; // UTC+05:30

describe('quiet hours', () => {
  it('is quiet from 22:00 to 07:00 local', () => {
    expect(inQuietHours(new Date('2026-10-01T16:30:00Z'), IST)).toBe(true); // 22:00 IST
    expect(inQuietHours(new Date('2026-10-01T01:29:00Z'), IST)).toBe(true); // 06:59 IST
    expect(inQuietHours(new Date('2026-10-01T01:30:00Z'), IST)).toBe(false); // 07:00 IST
  });

  it('holds a 23:15 email until 07:00 the next morning', () => {
    const at = new Date('2026-10-01T17:45:00Z'); // 23:15 IST
    expect(nextSendableTime(at, IST).toISOString()).toBe('2026-10-02T01:30:00.000Z');
  });

  it('holds a 03:10 email until 07:00 the same morning', () => {
    const at = new Date('2026-10-01T21:40:00Z'); // 03:10 IST on Oct 2
    expect(nextSendableTime(at, IST).toISOString()).toBe('2026-10-02T01:30:00.000Z');
  });

  it('leaves daytime alone', () => {
    const at = new Date('2026-10-01T06:00:00Z');
    expect(nextSendableTime(at, IST)).toBe(at);
  });

  it('knows the local weekday', () => {
    expect(localWeekday(new Date('2026-10-03T19:00:00Z'), IST)).toBe('Sun'); // 00:30 Sunday IST
  });
});

describe('templates', () => {
  it('reminders carry counts, never text', () => {
    const m = reminderEmail(
      'a@b.c',
      { bookTitle: 'P&P', nextPosition: 7, waiting: 3, days: 3, roomUrl: 'https://x/r' },
      { appUrl: 'https://x' },
    );
    expect(m.subject).toBe('Chapter 7 is waiting for you');
    expect(m.text).toContain('3 thoughts are already there');
    expect(m.html).toContain('P&amp;P');
  });

  it('weekly update lists chapter numbers only', () => {
    const m = weeklyEmail(
      'a@b.c',
      {
        bookTitle: 'Book',
        you: { position: 6, finished: false },
        friends: [
          { name: 'Anu', position: 12, finished: false },
          { name: 'Joel', position: 20, finished: true },
        ],
        roomUrl: 'https://x/r',
      },
      { appUrl: 'https://x' },
    );
    expect(m.text).toContain('Anu: chapter 12');
    expect(m.text).toContain('Joel: finished');
    expect(m.text).toContain('You: chapter 6.');
  });
});

describe('brevo:// mailer', () => {
  const msg = { to: 'meera@x.test', subject: 'Hi', text: 'plain', html: '<p>plain</p>' };

  it('posts the message to the Brevo API with the key and sender', async () => {
    const calls: [string, RequestInit][] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    await brevoMailer('xkeysib-ABC', 'BookMarker <hello@x.test>', fake).send(msg);
    expect(calls[0]![0]).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]![1].headers as Record<string, string>)['api-key']).toBe('xkeysib-ABC');
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      sender: { name: 'BookMarker', email: 'hello@x.test' },
      to: [{ email: 'meera@x.test' }],
      subject: 'Hi',
      textContent: 'plain',
      htmlContent: '<p>plain</p>',
    });
  });

  it('throws when Brevo rejects the send', async () => {
    const fake = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    await expect(brevoMailer('bad', 'a@x.test', fake).send(msg)).rejects.toThrow(/401/);
  });

  it('is chosen by mailerFromUrl, keeping the key’s case', () => {
    expect(() => mailerFromUrl('brevo://', 'a@x.test')).toThrow(/API key/);
    expect(mailerFromUrl('brevo://xkeysib-AbC', 'a@x.test')).toBeTruthy();
  });

  it('parses sender addresses', () => {
    expect(parseFrom('"Book Marker" <a@x.test>')).toEqual({
      name: 'Book Marker',
      email: 'a@x.test',
    });
    expect(parseFrom('a@x.test')).toEqual({ email: 'a@x.test' });
  });
});
