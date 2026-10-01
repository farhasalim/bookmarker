#!/usr/bin/env bash
# Starts the API, the site and Caddy in one container (Render free plan).
# If any of them stops, the container exits and Render restarts it.
set -euo pipefail

# Render provides the public address; both the site and the API live there.
export APP_URL="${APP_URL:-${RENDER_EXTERNAL_URL:?set APP_URL}}"
export API_URL="${API_URL:-$APP_URL}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
export TRUST_PROXY="${TRUST_PROXY:-1}" # Caddy is the one hop the API sees
CADDY_PORT="${PORT:-10000}"
APP_DIR="${APP_DIR:-/app}"
WEB_DIR="${WEB_DIR:-/web}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

echo "Applying database migrations…"
(cd "$APP_DIR" && pnpm --filter @bookmarker/db migrate:deploy)

pids=()
(cd "$APP_DIR/apps/api" && PORT=4000 exec node --max-old-space-size=256 --import tsx src/server.ts) & pids+=($!)
(cd "$WEB_DIR" && PORT=3000 HOSTNAME=127.0.0.1 exec node --max-old-space-size=160 apps/web/server.js) & pids+=($!)
PORT="$CADDY_PORT" caddy run --config "$CADDYFILE" --adapter caddyfile & pids+=($!)

stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; wait; }
trap 'stop; exit 0' TERM INT

wait -n || true
echo "A process stopped; exiting so Render restarts the container." >&2
stop
exit 1
