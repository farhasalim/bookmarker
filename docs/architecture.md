# Architecture

## The shape

```
 browser ──HTTPS──► Caddy ──┬── /api/*, /socket.io/* ──► api (Express + Socket.IO) ──┐
 (one origin)               └── everything else ───────► web (Next.js)               │
                                                                                     ▼
                     worker (BullMQ) ──────────────────────────────────────────► Postgres 16
                          │  └──── pub/sub "notification arrived" ──► Redis ◄─── api
                          └──── SMTP ──► any provider (Mailpit on staging)
```

One origin means the session cookie is first-party everywhere and CSRF protection stays simple.
Everything runs as containers from `infra/compose.server.yml` on one server.

## The spoiler gate

The rule: a post is visible to a reader, and may notify them, only if its chapter position is at or
below the reader's bookmark, or the reader wrote it. Finished = infinity.

Where it lives: `packages/gate`.

| File | What it holds |
|---|---|
| `rules.ts` | The rule as pure functions (`canSeePost`, `reach`, `postablePosition`, `unlockedRange`). |
| `where.ts` | The rule as the one Prisma filter (`visiblePostsWhere`) that every query composes. |
| `posts.ts`, `reviews.ts`, `admin.ts` | Every read and write of posts, replies, likes, reviews and reports. |
| `recipients.ts`, `notify-checks.ts` | Who may hear about a post **right now** (used at send time). |

How we stop anything going around it:

1. **Lint.** ESLint fails on any `x.post.*` / `x.reply.*` / `x.like.*` / `x.review.*` Prisma call, or
   raw SQL, anywhere in `apps/`. Content has to go through `@bookmarker/gate`.
2. **Same transaction.** Routes load the reader's bookmark and the content in one transaction.
3. **404, never 403.** A post above your bookmark is "not found", so its existence isn't confirmed.
4. **Ids, not text, in transit.** Room events (`room_events`, Redis) and notifications store ids,
   names and numbers only. Whoever delivers them loads the content through the gate, for that
   reader, at that moment.
5. **Send-time re-check.** The worker calls `canSeePostNow` immediately before every in-app or email
   delivery. Emails never contain post, reply or review text at all.
6. **Sockets.** Each socket caches its bookmark per room; the hub checks it before every emit, and
   updates it (then sends `unlock`/`relock`) the moment that reader's bookmark moves.
7. **Tests.** `apps/api/test/leak.test.ts` (AT-1) discovers every GET route from the router and calls
   each one as every seeded reader, then sweeps socket traffic. `apps/worker/test/leak.test.ts` queues
   a notification about every post for every reader and checks that none above a bookmark gets
   through. Both run in CI as the required `leak-test (AT-1)` check.

## Data

Prisma schema: `packages/db/prisma/schema.prisma` (the 15 SRS tables plus `sessions`,
`magic_tokens`, `reports` and `room_events`). Ids are UUIDv7. Posts are soft-deleted.
CHECK constraints in the first migration back up the Zod validation (body lengths, rating 1–5,
positions ≥ 0).

Chapters have a `position`. Bookmarks store a position too, so a chapter must never shift under a
reader. Hence the lock: after the host confirms, chapters at or below the furthest point any reader
reached or posted at can only be renamed (`apps/api/src/services/rooms.ts → frozenThrough`).
"After the book" is a real chapter row (`kind = after_book`) at position N+1. Only Finished
readers reach it, so the same gate covers it.

## Real time

Socket.IO, one socket per tab, authenticated by the session cookie with an Origin check.
`room:join { roomId, lastSeq }` replays missed events through the gate. Across several API
instances, room events travel over Redis pub/sub and each instance filters for its own sockets.

## Background jobs

`apps/worker`: BullMQ job schedulers fire `deliver` every minute and `reminders` and `weekly`
every 15 minutes. Every job works from database state and is idempotent (weekly uses a dedupe
key), so a missed or doubled run is harmless. Quiet hours (22:00–07:00 in the reader's own time
zone) hold email. `pnpm --filter @bookmarker/worker once …` runs any job by hand.

## Plans and limits

`packages/shared/src/plans.ts` is a table of limits per plan (members, current rooms, features).
Code asks `limitsFor(club.plan)`, never "is this club paid?". Everyone is on `free` until Phase 3.

## Design tokens

Colours are CSS variables in `apps/web/src/app/globals.css`, with light and dark sets. Every text
and background pair meets WCAG AA (4.5:1). The ratios were checked when chosen; re-check if you change them.
Fonts (Newsreader, Karla) are self-hosted from npm, so no Google request and no lock-in.

## Plan of record

- **Phase 1 (done, on staging once the server exists):** SRS MVP FR-1–FR-20, AT-1–AT-15.
- **Phase 2, launch hardening:** legal pages and the DPDP/GDPR memo, a domain with
  SPF/DKIM/DMARC, one-click unsubscribe, error tracking, uptime alerts, privacy-friendly analytics,
  an admin page, the OWASP checklist, landing/SEO/share cards, optional Postgres row-level security.
- **Phase 3, charging:** `PaymentProvider` interface, Razorpay adapter, trials, up/downgrades,
  failed payments, verified idempotent webhooks.
