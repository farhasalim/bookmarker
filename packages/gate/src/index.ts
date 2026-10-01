/**
 * @bookmarker/gate — the only module allowed to read or write posts, replies,
 * likes and reviews. See docs/architecture.md, "The spoiler gate".
 */
export * from './rules.ts';
export * from './errors.ts';
export * from './viewer.ts';
export * from './where.ts';
export * from './posts.ts';
export * from './recipients.ts';
export * from './reviews.ts';
export { toUserSummary } from './dto.ts';
export * from './admin.ts';
