#!/usr/bin/env sh
set -eu

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${EXPECTED_MANIFEST_SHA256:?EXPECTED_MANIFEST_SHA256 is required}"

actual="$(psql "$RESTORE_DATABASE_URL" -Atqc "select encode(digest(string_agg(schemaname || '.' || tablename, ',' order by schemaname, tablename), 'sha256'), 'hex') from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
test "$actual" = "$EXPECTED_MANIFEST_SHA256"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "select 1"
printf '%s\n' "Restore verification passed: schema manifest and connectivity are valid."
