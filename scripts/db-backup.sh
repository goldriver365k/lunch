#!/usr/bin/env bash
# DB 백업 — Supabase(무료 플랜 포함) PostgreSQL의 public 스키마 구조·데이터를 내보낸다.
# 사용법: SUPABASE_DB_URL=postgresql://... BACKUP_PASSPHRASE=... scripts/db-backup.sh [출력 폴더]
#  - SUPABASE_DB_URL: Supabase → Project Settings → Database → Connection string (비밀값. 저장소·브라우저에 넣지 않는다)
#  - BACKUP_PASSPHRASE가 있으면 gpg(AES256)로 암호화한다. 없으면 --plain을 줘야 평문으로 저장한다 (로컬 확인용)
#  - auth 스키마(계정·비밀번호 해시)와 관리자·사업자 지정(admin_users·business_users 데이터)은 넣지 않는다.
#    복원한 뒤 계정을 다시 만들고 관리자·사업자를 다시 지정한다 (README '백업·복구').
set -euo pipefail
OUT="${1:-backups}"
PLAIN=0
[ "${2:-}" = "--plain" ] && PLAIN=1
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL이 필요해요}"
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/mwomeok-public-$STAMP.dump"
# custom 형식: pg_restore로 표·함수를 골라 복원할 수 있다. 이용 통계 원본은 크기를 줄이려고 구조만
# 권한(GRANT·REVOKE)도 함께 담는다 — 빼면 복원한 DB에서 비공개 함수가 다시 열린다
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --schema=public \
  --exclude-table-data=public.usage_events \
  --exclude-table-data=public.admin_users --exclude-table-data=public.business_users \
  --file="$FILE"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$FILE.gpg" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
elif [ "$PLAIN" -ne 1 ]; then
  rm -f "$FILE"
  echo "BACKUP_PASSPHRASE가 없어요. 암호화하지 않으려면 --plain을 붙이세요." >&2
  exit 2
fi
sha256sum "$FILE" > "$FILE.sha256"
echo "백업 완료: $FILE"
