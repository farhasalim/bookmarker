import { describe, expect, it } from 'vitest';
import { inQuietHours, localWeekday, nextSendableTime } from '../src/quiet-hours.ts';
import { reminderEmail, weeklyEmail } from '../src/templates.ts';

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
