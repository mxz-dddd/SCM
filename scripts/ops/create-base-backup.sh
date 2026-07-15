#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY is required}"

umask 077
mkdir -p "$BACKUP_DIRECTORY"
pg_basebackup --dbname="$DATABASE_URL" --pgdata="$BACKUP_DIRECTORY" --format=plain --wal-method=stream --checkpoint=fast --progress
test -f "$BACKUP_DIRECTORY/backup_manifest"
sha256sum "$BACKUP_DIRECTORY/backup_manifest" > "$BACKUP_DIRECTORY/backup_manifest.sha256"
