# Runbook

Everything runs on one server from `/opt/bookmarker` with `compose.server.yml`.
Shortcut used below: `dc` = `docker compose -f compose.server.yml --env-file .env.run`.

## First-time setup (staging)

1. **Oracle account.** Sign up at cloud.oracle.com, pick a home region close to India (Mumbai or
   Hyderabad), then **upgrade to Pay As You Go** (needs a card; stays ₹0 inside the free limits, and
   stops idle-server reclamation). If ARM capacity is "out of stock", retry later or try another
   availability domain.
2. **VM.** Compute → Instances → Create: image *Ubuntu 24.04*, shape *VM.Standard.A1.Flex*,
   2 OCPU / 12 GB, 50 GB boot volume. Add your SSH public key. In the subnet's security list, open
   TCP 80 and 443.
3. **Free address.** Create a free subdomain at duckdns.org (e.g. `bookmarker-staging.duckdns.org`)
   pointing at the VM's public IP.
4. **On the VM:**
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 unattended-upgrades
   sudo usermod -aG docker ubuntu && sudo dpkg-reconfigure -plow unattended-upgrades
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save
   sudo mkdir -p /opt/bookmarker && sudo chown ubuntu /opt/bookmarker
   ```
5. **`/opt/bookmarker/.env`** (never committed):
   ```
   DOMAIN=bookmarker-staging.duckdns.org
   GHCR_OWNER=farhasalim
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   SESSION_SECRET=<openssl rand -hex 32>
   SMTP_URL=smtp://mailpit:1025
   EMAIL_FROM=BookMarker <hello@bookmarker-staging.duckdns.org>
   MAILPIT_USER=staff
   MAILPIT_HASH=<docker run --rm caddy caddy hash-password --plaintext 'choose-one'>
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   BACKUP_S3_BUCKET=bookmarker-backups
   BACKUP_S3_KEY=...
   BACKUP_S3_SECRET=...
   ```
6. **GitHub.** Settings → Environments → create `staging` with secrets `SSH_HOST` (VM IP),
   `SSH_USER` (`ubuntu`), `SSH_KEY` (a deploy private key whose public half is in
   `~/.ssh/authorized_keys`). Settings → Branches → protect `main`: require the checks
   **checks**, **leak-test (AT-1)**, **e2e** and **security**. Packages: make the two GHCR images
   readable by the VM (`docker login ghcr.io` on the VM with a read-only token, or make them public).
7. Push to `main`. The Deploy workflow builds images, copies the compose files, runs migrations and
   starts everything. Staging email lands in Mailpit at `https://DOMAIN/mail`.

Google sign-in (optional on staging): Google Cloud Console → Credentials → OAuth client (Web),
redirect URI `https://DOMAIN/api/v1/auth/google/callback`, then set the two `GOOGLE_*` values and
redeploy. Magic links work without it.

## Deploy

Merging to `main` deploys staging automatically. For production: Actions → Deploy → Run workflow →
environment `production` (the environment's required reviewer approves).

What a deploy does: pull images tagged with the commit SHA → `migrate` runs `prisma migrate deploy`
→ `api`/`worker`/`web` restart → `/healthz` is checked. The SHA is appended to `deploy-history.log`.

## Roll back

Code: Actions → Deploy → Run workflow → pick the environment and paste the **previous SHA** from
`deploy-history.log` as *tag*. That redeploys the old images without rebuilding.

Database: migrations only move forward. Write every migration so the previous release still works
with it ("expand, then contract"). If a migration itself is bad, restore a backup (below) and roll
back the code.

## Back up and restore

Backups run nightly at `BACKUP_HOUR_UTC` (default 21:00 UTC = 02:30 IST), keep 7 days locally and
copy to the S3 bucket.

```bash
dc exec backup sh /backup/backup-loop.sh --now                 # take one now
dc exec backup ls -lh /backups                                 # list local copies
dc exec backup sh /backup/restore.sh /backups/<file>.dump      # restore into bookmarker_restore
```

The restore script prints row counts so you can check the copy. To make it live:
`dc stop api worker`, rename databases in `psql` (`bookmarker` → `bookmarker_old`,
`bookmarker_restore` → `bookmarker`), `dc start api worker`.

**Restore drill:** do it once before launch and after any schema change, and record the date here.
- 2026-10-01: drill on dev data, 17/17 posts restored.

To restore from the bucket, first copy the file down:
`dc exec backup aws s3 cp s3://$BUCKET/postgres/<file> /backups/ --endpoint-url $ENDPOINT`.

## Rotate secrets

| Secret | How | Effect |
|---|---|---|
| `SESSION_SECRET` | New value in `.env`, `dc up -d api` | Only signs the 10-minute OAuth state cookie; sessions are unaffected. |
| Everyone's sessions | `dc exec postgres psql -U bookmarker -c 'TRUNCATE sessions'` | Everyone signs in again. |
| `POSTGRES_PASSWORD` | `ALTER USER bookmarker PASSWORD '…'` in psql, then update `.env`, `dc up -d` | Brief restart. |
| `GOOGLE_CLIENT_SECRET` | Create a new secret in Google Console, update `.env`, `dc up -d api`, delete the old one | None. |
| SMTP / S3 keys | Issue new keys at the provider, update `.env`, `dc up -d api worker backup`, revoke old | None. |
| Deploy SSH key | New key pair; add the public key on the VM, update the GitHub environment secret, remove the old key | None. |

## Everyday checks

```bash
dc ps                               # all services up?
dc logs -f --tail=100 api           # JSON logs with request ids
curl -s https://DOMAIN/healthz      # {"ok":true}
pnpm --filter @bookmarker/worker once deliver   # (from a dev machine against staging DB) force a run
df -h /                             # disk (Postgres + backups)
```
