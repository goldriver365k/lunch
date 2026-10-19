#!/usr/bin/env bash
# 로컬 PostgreSQL 16 + PostGIS 3에서 마이그레이션과 RLS·검색·가져오기를 시험한다.
# 사용법: PGHOST=/tmp/pgtest PGPORT=54329 PGUSER=postgres supabase/tests/run_local_db_test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mwomeok_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>/dev/null; done
# 마이그레이션은 두 번 실행해도 안전해야 한다
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>/dev/null; done
for t in supabase/tests/stage4_db_test.sql supabase/tests/stage5_orders_test.sql supabase/tests/stage6_ranking_test.sql; do
  echo "== $t"
  # 각 단계 시험은 서로 섞이지 않게 새 DB에서 실행한다
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local_supabase_shim.sql
  for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>/dev/null; done
  psql -q -tA -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1 | grep -E '^(psql:.*NOTICE:  ok|psql:.*ERROR|ALL_)' | sed -E 's/^psql:[^ ]+ NOTICE:  /  /'
done
