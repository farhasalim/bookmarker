/**
 * Plan limits live here as data, not as if-statements scattered through the code.
 * Business requirement 1: "Build plan limits as configuration, not hard-coded logic."
 *
 * Everyone is on "free" until charging ships (Phase 3). To change a limit, edit this
 * table; to add a plan, add a row. Code asks `limitsFor(club.plan)` and never checks
 * a plan name directly.
 */
export interface PlanLimits {
  /** Max members in a club (null = unlimited). */
  maxMembers: number | null;
  /** Max rooms with status "current" at once. SRS FR-4 says 1 for the MVP. */
  maxCurrentRooms: number | null;
  /** Feature flags for later paid features. */
  features: {
    readingPace: boolean;
    aiRecaps: boolean;
  };
}

export const PLANS = {
  free: {
    maxMembers: 20,
    maxCurrentRooms: 1,
    features: { readingPace: false, aiRecaps: false },
  },
  // Reserved for Phase 3. Not selectable until payments exist.
  club_plus: {
    maxMembers: null,
    maxCurrentRooms: null,
    features: { readingPace: true, aiRecaps: true },
  },
} as const satisfies Record<string, PlanLimits>;

export type PlanKey = keyof typeof PLANS;

export function limitsFor(plan: string): PlanLimits {
  return (PLANS as Record<string, PlanLimits>)[plan] ?? PLANS.free;
}

/** True when `count` more of something is still within `limit` (null = unlimited). */
export function withinLimit(limit: number | null, currentCount: number): boolean {
  return limit === null || currentCount < limit;
}
