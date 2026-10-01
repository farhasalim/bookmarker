import { describe, expect, it } from 'vitest';
import { canSeePost, canSeeRoomReviews, positionVisible, postablePosition, reach, unlockedRange } from '../src/rules.ts';

const at = (position: number, finished = false) => ({ userId: 'me', roomId: 'r', position, finished });

describe('the spoiler rule', () => {
  it('shows chapters at or below the bookmark and hides those above', () => {
    expect(positionVisible(at(3), 2)).toBe(true);
    expect(positionVisible(at(3), 3)).toBe(true);
    expect(positionVisible(at(3), 4)).toBe(false);
  });

  it('shows nothing to a reader who has not started (bookmark 0)', () => {
    expect(positionVisible(at(0), 1)).toBe(false);
  });

  it('treats Finished as infinity, including the After-the-book section', () => {
    expect(reach(at(20, true))).toBe(Number.POSITIVE_INFINITY);
    expect(positionVisible(at(20, true), 21)).toBe(true);
    expect(positionVisible(at(20, false), 21)).toBe(false);
  });

  it('always shows readers their own posts, even after moving back (PRD rule 7)', () => {
    expect(canSeePost(at(2), { authorId: 'me', chapterPosition: 9 })).toBe(true);
    expect(canSeePost(at(2), { authorId: 'other', chapterPosition: 9 })).toBe(false);
  });

  it('gates reviews on Finished only', () => {
    expect(canSeeRoomReviews(at(20))).toBe(false);
    expect(canSeeRoomReviews(at(20, true))).toBe(true);
  });
});

describe('where a reader may post (FR-7)', () => {
  it('is exactly their bookmark chapter', () => {
    expect(postablePosition(at(3), 21)).toBe(3);
  });
  it('is nowhere at bookmark 0', () => {
    expect(postablePosition(at(0), 21)).toBeNull();
  });
  it('is the After-the-book section once Finished', () => {
    expect(postablePosition(at(20, true), 21)).toBe(21);
  });
});

describe('unlock ranges (gate rules 6 and 7)', () => {
  it('moving forward unlocks (from, to]', () => {
    expect(unlockedRange(at(3), at(8))).toEqual({ above: 3, through: 8 });
  });
  it('moving back or staying put unlocks nothing', () => {
    expect(unlockedRange(at(8), at(5))).toBeNull();
    expect(unlockedRange(at(5), at(5))).toBeNull();
  });
  it('finishing unlocks everything above the old bookmark', () => {
    expect(unlockedRange(at(10), at(20, true))).toEqual({ above: 10, through: Number.POSITIVE_INFINITY });
  });
  it('un-finishing unlocks nothing', () => {
    expect(unlockedRange(at(20, true), at(20))).toBeNull();
  });
});
