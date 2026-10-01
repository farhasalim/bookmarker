# BookMarker

A spoiler-safe reading room for book clubs. Each reader moves a bookmark as they read; a post is
visible, and can notify someone, **only if its chapter is at or below that reader's bookmark (or they
wrote it)**. That one rule is enforced in one place on the server: `packages/gate`.

- Product: [PRD](https://claude.ai/artifact/SDNzFxRXgMAPhLFpCKT7S2) ·
  [SRS](https://claude.ai/artifact/Et8xzNasaodvubmSW5jTTY) ·
  [Screen designs](https://claude.ai/artifact/ADUyLgpdydoxhxqQKLfi2a)
- Where we differ from the SRS, and why: [docs/srs-addendum.md](docs/srs-addendum.md)
- How it fits together: [docs/architecture.md](docs/architecture.md)
- Free staging on Render + Neon (sleeps when idle): [docs/render.md](docs/render.md)
- Our own server (always on): deploy, roll back, restore, rotate secrets: [docs/runbook.md](docs/runbook.md)
- Choices that could lock us in, and the way out: [docs/decisions.md](docs/decisions.md)

## Layout

```
apps/web        Next.js (App Router) + Tailwind. UI only; talks to the API.
apps/api        Express + Socket.IO. The only service that reads content.
apps/worker     BullMQ jobs: notification batches, 3-day reminders, Sunday update.
packages/gate   THE spoiler gate. Only code allowed to touch posts/replies/likes/reviews.
packages/db     Prisma schema, migrations, seed (the SRS acceptance-test room).
packages/mail   SMTP mailer, spoiler-free templates, quiet hours.
packages/shared Zod schemas, API/socket types, plan limits (config, not code).
infra/          Dockerfiles, server compose, Caddy, backups.
```

## Run it locally

Needs Node 22, pnpm 10 and Docker.

```bash
cp .env.example .env                  # defaults work for local dev
docker compose up -d                  # Postgres, Redis, Mailpit (http://localhost:8025)
pnpm install
pnpm db:deploy                        # apply migrations
pnpm db:seed                          # demo club "Thursday Readers" (optional)
pnpm dev                              # web :3000, api :4000, worker
```

Open http://localhost:3000, sign in with any email, and click the link that arrives in Mailpit.
Seeded readers: `meera@example.test` (chapter 3), `rahul@example.test` (10), `anu@example.test` (finished, host).

For live updates in dev, set `NEXT_PUBLIC_SOCKET_URL=http://localhost:4000` in `.env`
(production serves sockets on the same origin through Caddy).

## Tests

```bash
pnpm test            # unit + gate + API + worker (needs the bookmarker_test DB from docker compose)
pnpm test:leak       # AT-1 spoiler leak sweep: every GET route × every reader, sockets, email
pnpm --filter @bookmarker/web e2e:build && pnpm test:e2e   # Playwright reading loop + accessibility
```

The leak sweep runs on every pull request as its own required check and blocks the merge.

## Worker jobs by hand

```bash
pnpm --filter @bookmarker/worker once deliver          # send due notifications now
pnpm --filter @bookmarker/worker once all --in=31m     # as if 31 minutes had passed
```

## Status

Phase 1 (SRS MVP, FR-1 to FR-20) is built and tested. Phase 2 is launch hardening (legal, domain email,
ops, landing). Phase 3 is charging. See the plan in docs/architecture.md.
