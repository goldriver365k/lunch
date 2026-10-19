#!/usr/bin/env bash
# DB 복원 — db-backup.sh로 만든 파일을 '새' 데이터베이스에 복원한다 (운영 DB 덮어쓰기 방지).
# 사용법: TARGET_DB_URL=postgresql://... [BACKUP_PASSPHRASE=...] scripts/db-restore.sh <백업파일> [--tables restaurants,menus]
#  - 운영 DB에 직접 복원하지 말고, 새 프로젝트·임시 DB에 복원해 확인한 뒤 필요한 표만 옮긴다.
#  - 대상 DB에는 먼저 supabase/migrations/*.sql을 실행해 두지 않는다 (백업에 구조가 들어 있다).
#  - --tables를 주면 그 표의 데이터만 복원한다 (예: 음식점·메뉴만 되살리기, 구조가 있는 DB에서).
set -euo pipefail
FILE="${1:?백업 파일이 필요해요}"
: "${TARGET_DB_URL:?TARGET_DB_URL이 필요해요}"
TABLES=""
[ "${2:-}" = "--tables" ] && TABLES="${3:?표 이름이 필요해요}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
sha256sum -c "$FILE.sha256" >/dev/null 2>&1 || echo "주의: 체크섬 파일이 없거나 맞지 않아요" >&2
if [[ "$FILE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?암호화된 백업은 BACKUP_PASSPHRASE가 필요해요}"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o "$WORK/db.dump" -d "$FILE"
  FILE="$WORK/db.dump"
fi
if [ -n "$TABLES" ]; then
  args=()
  IFS=',' read -ra T <<< "$TABLES"
  for t in "${T[@]}"; do args+=(--table="$t"); done
  pg_restore --no-owner --data-only "${args[@]}" -d "$TARGET_DB_URL" "$FILE"
else
  # public 스키마 자체는 새 프로젝트에도 이미 있으므로 만들지 않는다
  pg_restore -l "$FILE" | grep -v ' SCHEMA - public ' > "$WORK/list"
  pg_restore --no-owner --exit-on-error -L "$WORK/list" -d "$TARGET_DB_URL" "$FILE"
fi
echo "복원 완료 → 대상 DB에서 음식점·메뉴 수를 확인하고, 주문 집계는 관리자 '통계 다시 집계'로 다시 계산하세요."
