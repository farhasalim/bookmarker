# Decisions that could lock us in, and the way out

Rule: every outside service is reached through an open protocol or an interface we own, so any one
of them can be swapped in an afternoon.

| Concern | Chosen | Why | Lock-in | How to leave |
|---|---|---|---|---|
| Hosting | Oracle Cloud Always Free ARM VM (2 OCPU / 12 GB), Docker Compose | ₹0/month; plenty for Phase 1 | Low: plain Docker | Same `compose.server.yml` on Hetzner / DigitalOcean / any VPS (~₹400–800/month). Restore the latest backup, point DNS. |
| Web framework | Next.js, `output: standalone` | Required stack | Low: runs as a Node server, no Vercel features used | Any Node host. (Vercel's free plan forbids commercial use anyway.) |
| Database | Self-run Postgres 16 | Standard | None | `pg_dump` → any Postgres (Neon, Supabase, RDS). |
| ORM | Prisma 7 with the `pg` driver adapter | Required stack | Medium: queries are Prisma-shaped | All content queries sit in `packages/gate`, so a rewrite is one package. |
| Cache/queue | Redis + BullMQ | Standard, self-run | Low | Valkey is a drop-in; jobs are idempotent and DB-driven. |
| Auth | Self-built: Google OIDC via `arctic` + `jose`, magic links, DB sessions | No vendor, no per-user fee | None | Users, identities and sessions are our own tables. Auth.js or Clerk could be added later. |
| Email | Nodemailer over SMTP | Any provider speaks SMTP | None | Change `SMTP_URL`. Candidates: Resend (free 3k/month), Brevo, Amazon SES (cheapest at volume). |
| Backups | `pg_dump` → any S3-compatible bucket | Cloudflare R2 has a free tier | None | Any S3 API (R2, Backblaze B2, AWS S3, MinIO). |
| Errors (Phase 2) | Sentry SDK → self-hosted GlitchTip or Sentry free | Sentry protocol is open | Low | Change the DSN. |
| Analytics (Phase 2) | Umami, self-hosted, cookieless | Privacy-friendly, no consent banner needed for it | None | Data is in our Postgres. |
| Secrets | `.env` on the server now; SOPS + age in Phase 2 | No vendor | None | Plain files, encrypted in git. |
| CI/CD | GitHub Actions calling `pnpm` scripts; images on GHCR | Free for this size | Low | Scripts are portable; images can go to any registry. |
| Payments (Phase 3) | `PaymentProvider` interface; Razorpay first | Stripe accounts are invite-only for Indian businesses | Medium (subscriptions live at the provider) | Second adapter (Stripe); keep plan and entitlement data in our own DB so a switch only re-points billing. |
| Fonts | Newsreader + Karla from npm (`@fontsource`) | Self-hosted | None | They're files in our build. |

## Free-tier notes (checked October 2026)

- **Oracle** halved Always Free ARM to 2 OCPU / 12 GB in June 2026. Free accounts' idle VMs (all of
  CPU, network and memory under 20% for 7 days) can be reclaimed. **Upgrade the account to Pay As
  You Go** to switch that off; usage inside the free limits still costs ₹0.
- **Vercel Hobby** is non-commercial only. Not used.
- **Neon free** Postgres gives 0.5 GB with a 6-hour restore window, too short to be the only backup.
