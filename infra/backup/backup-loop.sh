#!/bin/sh
# Daily Postgres backup (NFR-11): pg_dump at BACKUP_HOUR_UTC, keep KEEP_DAYS locally,
# copy to an S3-compatible bucket when configured. Any S3 API works (R2, B2, S3, MinIO).
set -eu
command -v aws >/dev/null || apk add --no-cache aws-cli >/dev/null

backup_once() {
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  file="/backups/bookmarker-$stamp.dump"
  pg_dump --format=custom --no-owner --file="$file"
  echo "backup: wrote $file ($(du -h "$file" | cut -f1))"
  if [ -n "${S3_BUCKET:-}" ]; then
    aws s3 cp "$file" "s3://$S3_BUCKET/postgres/" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} --only-show-errors
    echo "backup: uploaded to s3://$S3_BUCKET/postgres/"
  fi
  find /backups -name 'bookmarker-*.dump' -mtime +"$KEEP_DAYS" -delete
}

if [ "${1:-}" = "--now" ]; then backup_once; exit 0; fi

while true; do
  if [ "$(date -u +%H)" = "$(printf %02d "$BACKUP_HOUR_UTC")" ]; then
    backup_once || echo "backup: FAILED" >&2
    sleep 3700
  fi
  sleep 300
done
