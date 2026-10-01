# Free staging on Render + Neon

A zero-cost staging copy, for showing people and for checking against your own build.
Production can later move to our own server ([runbook.md](runbook.md)) with no code changes.

```
browser ──HTTPS──► Render (free web service, one container)
                     Caddy :$PORT ─┬─ /api, /socket.io, /healthz ─► API (Node, :4000)
                                   └─ everything else ────────────► Next.js site (:3000)
                     the API ──► Neon Postgres (free)      email ──► Brevo HTTPS API
GitHub Actions, every 15 min ──► worker jobs (letters, reminders, Sunday update) ──► Neon, Brevo
```

## What's different from our own server

|                 | Render + Neon (free)                                                  | Own server                     |
| --------------- | --------------------------------------------------------------------- | ------------------------------ |
| Sleeps          | After 15 min with no visitors; the next visit takes about a minute    | Never                          |
| Live updates    | Yes, while awake; the app reconnects and catches up after a sleep     | Yes                            |
| Background jobs | GitHub Actions every 15 min, so letters arrive 30–45 min after a post | Worker container, every minute |
| Redis           | None; rate limits and live events run in memory (one container)       | Redis                          |
| Email           | Brevo's HTTPS API (Render's free plan blocks SMTP ports)              | Any SMTP                       |
| Database        | Neon free: 0.5 GB, 100 compute-hours/month, sleeps after 5 min idle   | Postgres container             |
| Backups         | Neon keeps a short restore window; no `pg_dump` job                   | Daily `pg_dump` to a bucket    |

The spoiler gate is the same code everywhere. Nothing here changes what a reader can see.

## One-time setup (about 20 minutes)

### 1. Neon (database)

1. Sign up at **neon.com** and create a project: Postgres 16, region **AWS Asia Pacific (Singapore)**.
2. On the project dashboard, choose **Connect**, turn **Connection pooling off**, and copy the
   connection string. It looks like
   `postgresql://neondb_owner:…@ep-…-….ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Use this direct one (no `-pooler` in the host): migrations need it.

### 2. Brevo (email)

1. Sign up at **brevo.com** (free: 300 emails a day).
2. **Senders, domains & dedicated IPs → Senders → Add a sender** with the address you want emails
   to come from (your Gmail works for staging) and confirm the email Brevo sends you.
3. **SMTP & API → API keys → Generate a new API key**. Your `SMTP_URL` is `brevo://` followed by
   the key, e.g. `brevo://xkeysib-abc123…`.

Later, with a real domain, authenticate the domain in Brevo (SPF, DKIM, DMARC) and send from it.

### 3. GitHub (make the image readable)

The first push after this change builds `ghcr.io/farhasalim/bookmarker-render`. On GitHub:
your profile → **Packages → bookmarker-render → Package settings → Change visibility → Public**.
The image holds code only (already public); passwords live in Render's settings.

### 4. Render (the app)

1. Sign up at **render.com** with GitHub.
2. **New → Blueprint**, pick `farhasalim/bookmarker`. Render reads `render.yaml` and asks for:
   - `DATABASE_URL`: the Neon string from step 1
   - `SMTP_URL`: `brevo://…` from step 2
   - `EMAIL_FROM`: e.g. `BookMarker <you@gmail.com>` (the sender you verified)
     `SESSION_SECRET` is generated for you.
3. **Apply**. The first start runs the database migrations, then the site comes up at
   `https://bookmarker-xxxx.onrender.com` (shown on the service page).
4. Service → **Settings → Deploy Hook**: copy the URL.

### 5. GitHub (deploys and background jobs)

Repository → **Settings → Environments → staging** (create it if needed) → add secrets:

| Secret                | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `RENDER_DEPLOY_HOOK`  | the deploy hook URL from step 4                                           |
| `WORKER_DATABASE_URL` | the same Neon string as `DATABASE_URL`                                    |
| `SMTP_URL`            | the same `brevo://…`                                                      |
| `EMAIL_FROM`          | the same sender                                                           |
| `APP_URL`             | your `https://bookmarker-xxxx.onrender.com` address (used in email links) |

From then on: every push to `main` → CI passes → images build → Render deploys that exact
commit. **Actions → Worker (scheduled)** runs every 15 minutes; **Run workflow** runs it now.

## Checking it works

1. Open the address, sign in with your email, and click the link that arrives.
2. Create a club, open a room, invite a second address of yours, post at a chapter.
3. Run **Actions → Worker (scheduled) → Run workflow** about 31 minutes after a post: the other
   reader gets a letter (names and chapter numbers only, never the post's words).
4. Render → service → **Logs** should show no errors. If every sign-in from everyone gets "Too many
   requests", Render has changed how it passes the visitor's address: tell Claude, and in the
   meantime raise `RATE_LIMIT_AUTH` on the service.

## Limits to watch

- **Render: 750 free hours a month** per workspace. One service always awake uses about 730, so
  don't run a second free service in the same workspace.
- **Neon: 100 compute-hours a month.** The 15-minute jobs wake the database for about 5 minutes each
  time (about 60 hours a month), plus your own use. Neon's dashboard shows the total; if it gets
  close, change the schedule in `.github/workflows/worker-cron.yml` to every 20 or 30 minutes.
- **GitHub turns off scheduled workflows after 60 days with no commits.** Any commit, or
  **Actions → Worker (scheduled) → Enable workflow**, turns it back on.
- **Memory: 512 MB.** The container uses about 360 MB (API ~220, site ~90, Caddy ~45).

## Rolling back

**Actions → Deploy → Run workflow**, environment `staging`, and put the older commit's SHA in
**tag**. Render switches to that image. A rollback doesn't undo database migrations, so pick a commit
whose code still works with the current database (see "Roll back" in [runbook.md](runbook.md)).

## Leaving Render

Nothing here is Render-specific beyond `render.yaml`: the container is plain Docker
(`infra/Dockerfile.render`), the database is plain Postgres (`pg_dump` it from Neon and restore
anywhere), and email is one setting. Moving to our own server is the runbook's first-time setup
plus a restore.
