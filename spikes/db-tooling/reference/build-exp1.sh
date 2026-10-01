#!/usr/bin/env sh
# Builds the experiment 1 template database `exp1_main` from the canonical SQL: M1–M3 (the
# committed SQL migrations of arm A, applied in order) plus exp1-m4.sql, then loads the fixture.
# Then creates one working copy per arm from that template: exp1_<arm> for each argument.
#
#   sh reference/build-exp1.sh kysely drizzle prisma7 prisma8
#
# Runs psql inside the spike's Postgres container, so nothing but Docker is needed on the host.
set -eu
export MSYS_NO_PATHCONV=1
# On Git Bash, docker.exe needs a Windows path once path conversion is off.
here=$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })
c=${PG_CONTAINER:-db-tooling-db-1}

docker exec "$c" rm -rf /exp1-build
docker exec "$c" mkdir -p /exp1-build
for f in "$here"/arm-kysely/migrations/committed/00000[123]-*.sql "$here"/arm-kysely/db/bootstrap-extensions.sql \
         "$here"/reference/exp1-m4.sql "$here"/reference/exp1-fixture.sql; do
  docker cp "$f" "$c:/exp1-build/" >/dev/null
done

docker exec "$c" sh -c '
set -e
psql -q -U postgres -c "DROP DATABASE IF EXISTS exp1_main WITH (FORCE)" -c "CREATE DATABASE exp1_main OWNER skal_migrator"
psql -q -U postgres -d exp1_main -v ON_ERROR_STOP=1 -f /exp1-build/bootstrap-extensions.sql
for f in /exp1-build/00000*.sql /exp1-build/exp1-m4.sql /exp1-build/exp1-fixture.sql; do
  PGPASSWORD=migrator psql -q -U skal_migrator -h localhost -d exp1_main -v ON_ERROR_STOP=1 -f "$f"
done'

for arm in "$@"; do
  docker exec "$c" psql -q -U postgres \
    -c "DROP DATABASE IF EXISTS exp1_${arm} WITH (FORCE)" \
    -c "CREATE DATABASE exp1_${arm} TEMPLATE exp1_main OWNER skal_migrator"
  echo "exp1_${arm} ready"
done
