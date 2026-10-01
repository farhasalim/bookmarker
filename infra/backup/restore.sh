#!/bin/sh
# Restore a backup into a database. Run inside the backup container:
#   docker compose -f compose.server.yml exec backup sh /backup/restore.sh /backups/bookmarker-....dump [target_db]
# Default target is a NEW database "bookmarker_restore", so you can check it before switching.
set -eu
file="$1"
target="${2:-bookmarker_restore}"
psql -d postgres -c "DROP DATABASE IF EXISTS \"$target\";"
psql -d postgres -c "CREATE DATABASE \"$target\" OWNER bookmarker;"
pg_restore --no-owner --dbname="$target" "$file"
echo "restore: $file → $target"
psql -d "$target" -tAc "select 'users', count(*) from users union all select 'posts', count(*) from posts union all select 'rooms', count(*) from rooms;"
