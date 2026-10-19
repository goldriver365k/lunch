-- 4단계 DB 시험 (로컬 PostgreSQL + PostGIS 전용)
-- 실행: psql -v ON_ERROR_STOP=1 -f local_supabase_shim.sql -f ../migrations/*.sql -f stage4_db_test.sql
-- 아래 '시험 매장'은 이 시험 DB 안에서만 만들고 지운다. 실제 DB에는 넣지 않는다.
\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000b001', 'user@example.com');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000a001');

-- 선릉역(37.504500, 127.049000) 기준 북동쪽 50m·150m·250m·350m에 시험 매장 배치
insert into public.restaurants (id, name, category, road_address, lat, lng, coord_status, business_status,
                                dine_in, takeout, delivery, delivery_radius_m, is_public, region_id, source)
select v.id::uuid, v.name, v.cat, v.addr,
       extensions.st_y(p::extensions.geometry), extensions.st_x(p::extensions.geometry),
       'valid', v.bs::public.business_status, v.di::public.channel_status, v.tk::public.channel_status,
       v.dl::public.channel_status, v.dr, v.pub, 'seolleung_yeoksam', 'admin'
  from (values
    ('10000000-0000-0000-0000-000000000050', '시험 50m 한식', '한식', '시험로 1', 50, 'open', 'yes', 'yes', 'yes', 2000, true),
    ('10000000-0000-0000-0000-000000000150', '시험 150m 중식', '중식', '시험로 2', 150, 'open', 'unknown', 'no', 'yes', null, true),
    ('10000000-0000-0000-0000-000000000250', '시험 250m 한식', '한식', '시험로 3', 250, 'open', 'yes', 'unknown', 'no', null, true),
    ('10000000-0000-0000-0000-000000000350', '시험 350m 일식', '일식', '시험로 4', 350, 'open', 'yes', 'yes', 'no', null, true),
    ('10000000-0000-0000-0000-000000000099', '시험 폐업', '한식', '시험로 5', 80, 'closed', 'yes', 'yes', 'no', null, true),
    ('10000000-0000-0000-0000-000000000098', '시험 비공개', '한식', '시험로 6', 90, 'open', 'yes', 'yes', 'no', null, false)
  ) as v(id, name, cat, addr, d, bs, di, tk, dl, dr, pub),
  lateral (select extensions.st_project(
             extensions.st_setsrid(extensions.st_makepoint(127.049000, 37.504500), 4326)::extensions.geography,
             v.d, radians(45)) as p) g;

insert into public.menus (restaurant_id, name, is_signature, price_dine_in, price_delivery, price_takeout, sort_order)
values ('10000000-0000-0000-0000-000000000050', '제육볶음', true, 9000, 10000, null, 1),
       ('10000000-0000-0000-0000-000000000050', '김치찌개', false, 8500, null, null, 2);

select pg_temp.check(has_signature_menu, '대표메뉴 등록 시 has_signature_menu 트리거 반영')
  from public.restaurants where id = '10000000-0000-0000-0000-000000000050';

-- ───── 일반 이용자(anon) ─────
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.check((select count(*) from public.restaurants) = 4, 'anon: 공개·영업·좌표정상 매장만 보임 (폐업·비공개 제외)');
select pg_temp.check((select array_agg(name order by distance_m) from public.search_restaurants(37.5045, 127.049, 'walk', 100))
                     = array['시험 50m 한식'], 'walk 100m: 50m 매장만');
select pg_temp.check((select array_agg(name order by distance_m) from public.search_restaurants(37.5045, 127.049, 'walk', 200))
                     = array['시험 50m 한식', '시험 150m 중식'], 'walk 200m: 150m 매장 추가');
select pg_temp.check((select array_agg(name order by distance_m) from public.search_restaurants(37.5045, 127.049, 'walk', 300))
                     = array['시험 50m 한식', '시험 150m 중식', '시험 250m 한식'], 'walk 300m: 250m 매장 추가, 350m 제외');
select pg_temp.check((select array_agg(distance_m) from public.search_restaurants(37.5045, 127.049, 'walk', 300))
                     = array[50, 150, 250], '거리(m)는 PostGIS 직선거리');
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'takeout', 300))
                     = array['시험 50m 한식', '시험 250m 한식'], 'takeout: 포장 안 함(no) 제외, 미확인 포함');
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'walk', 300, '한식'))
                     = array['시험 50m 한식', '시험 250m 한식'], '음식 종류 필터');
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'walk', 300, null, '제육'))
                     = array['시험 50m 한식'], '키워드: 메뉴명 검색');
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'delivery', 100))
                     = array['시험 50m 한식'], 'delivery: 배달 확인 + 배달 가능 거리 확인된 매장만');
select pg_temp.check((select (menus->0->>'name') = '제육볶음' and (menus->0->>'price_takeout') is null
                        from public.search_restaurants(37.5045, 127.049, 'walk', 100)),
                     '메뉴: 대표메뉴 먼저, 미확인 가격은 null');
select pg_temp.check(not exists (select 1 from public.search_restaurants(37.4948, 127.0280, 'walk', 300)),
                     '다른 위치(역삼역 남쪽)에서는 선릉역 매장이 안 나옴');

do $$ begin
  perform * from public.search_restaurants(37.5045, 127.049, 'walk', 500);
  raise exception 'FAIL: 반경 500m 허용됨';
exception when sqlstate '22023' then raise notice 'ok  반경 100/200/300 외 거부';
end $$;
do $$ begin
  perform * from public.search_restaurants(0, 0, 'walk', 100);
  raise exception 'FAIL: 잘못된 좌표 허용됨';
exception when sqlstate '22023' then raise notice 'ok  잘못된 기준 좌표 거부';
end $$;
do $$ begin
  insert into public.restaurants (name) values ('침입');
  raise exception 'FAIL: anon 등록 허용됨';
exception when insufficient_privilege then raise notice 'ok  anon: 음식점 등록 불가';
end $$;
do $$ declare n int; begin
  update public.restaurants set name = '변조' where true;
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL: anon 수정 허용됨'; end if;
  raise notice 'ok  anon: 음식점 수정 불가';
exception when insufficient_privilege then raise notice 'ok  anon: 음식점 수정 불가';
end $$;
do $$ begin
  perform public.admin_dashboard_stats();
  raise exception 'FAIL: anon 관리자 통계 허용됨';
exception when insufficient_privilege then raise notice 'ok  anon: 관리자 함수 실행 불가';
end $$;

-- ───── 로그인한 일반 사용자 ─────
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b001', false);
select pg_temp.check(not public.is_admin(), '일반 로그인 사용자는 관리자 아님');
do $$ declare n int; begin
  update public.menus set price_dine_in = 1 where true;
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL: 일반 사용자 가격 수정 허용됨'; end if;
  raise notice 'ok  일반 사용자: 가격 수정 불가';
end $$;
do $$ begin
  insert into public.restaurants (name) values ('침입');
  raise exception 'FAIL: 일반 사용자 등록 허용됨';
exception when insufficient_privilege then raise notice 'ok  일반 사용자: 음식점 등록 불가 (RLS)';
end $$;
do $$ begin
  perform public.admin_commit_import(gen_random_uuid());
  raise exception 'FAIL: 일반 사용자 가져오기 허용됨';
exception when insufficient_privilege then raise notice 'ok  일반 사용자: 공공데이터 반영 불가';
end $$;
do $$ begin
  perform count(*) from public.admin_users;
  raise exception 'FAIL: 일반 사용자 관리자 목록 조회 허용됨';
exception when insufficient_privilege then raise notice 'ok  일반 사용자: 관리자 목록 볼 수 없음';
end $$;

-- ───── 관리자 ─────
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);
select pg_temp.check(public.is_admin(), '관리자 인증');
select pg_temp.check((select count(*) from public.restaurants) = 6, '관리자: 비공개·폐업 포함 전체 보기');

-- 가격 수정 → 소비자 검색 결과에 반영
update public.menus set price_dine_in = 9500 where name = '제육볶음';
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select (menus->0->>'price_dine_in')::int from public.search_restaurants(37.5045, 127.049, 'walk', 100)) = 9500,
                     '관리자 가격 수정이 소비자 검색에 반영');
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);

-- 신규 등록·비공개 전환
insert into public.restaurants (id, name, category, lat, lng, coord_status, business_status, is_public)
values ('10000000-0000-0000-0000-0000000000a1', '관리자 등록 매장', '분식', 37.50455, 127.04905, 'valid', 'open', true);
update public.restaurants set is_public = false where id = '10000000-0000-0000-0000-000000000050';
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'walk', 100)) = array['관리자 등록 매장'],
                     '관리자 신규 등록 노출 · 비공개 전환 매장 숨김');
select pg_temp.check((select count(*) from public.menus where restaurant_id = '10000000-0000-0000-0000-000000000050') = 0,
                     '비공개 매장의 메뉴도 anon에게 숨김');
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', false);
update public.restaurants set is_public = true where id = '10000000-0000-0000-0000-000000000050';

-- ───── 공공데이터 가져오기 ─────
create temp table t_batch(id uuid);
grant all on t_batch to authenticated;
with b as (insert into public.import_batches (file_name, region_id, source_name, collected_at)
           values ('test.csv', 'seolleung_yeoksam', '공공데이터포털 전국일반음식점표준데이터', '2026-10-19') returning id)
insert into t_batch select id from b;
insert into public.import_staging (batch_id, license_no, name, category, road_address, lat, lng, coord_status, business_status)
select (select id from t_batch), v.* from (values
  ('LIC-1', '공공 매장 A', '한식', '서울 강남구 테헤란로 1', 37.5046, 127.0491, 'valid'::public.coord_status, 'open'::public.business_status),
  ('LIC-2', '공공 매장 B', '중식', '서울 강남구 테헤란로 2', null, null, 'missing', 'open'),
  ('LIC-3', '공공 폐업 매장', '한식', '서울 강남구 테헤란로 3', 37.5047, 127.0492, 'valid', 'closed')
) v;
select pg_temp.check((select (r->>'inserted')::int = 2 and (r->>'closed_skipped')::int = 1
                        from (select public.admin_commit_import((select id from t_batch)) r) x),
                     '가져오기: 영업 매장 2건 등록, 폐업 1건 제외');
select pg_temp.check((select is_public from public.restaurants where license_no = 'LIC-2') = false,
                     '좌표 누락 매장은 비공개로 분류');
select pg_temp.check((select count(*) from public.import_staging) = 0, '반영 후 원본 스테이징 행 삭제');

-- 관리자가 메뉴·가격을 등록한 뒤 같은 파일을 다시 올려도 중복·메뉴 손실이 없어야 한다
insert into public.menus (restaurant_id, name, is_signature, price_dine_in)
select id, '공공A 대표메뉴', true, 11000 from public.restaurants where license_no = 'LIC-1';
update public.restaurants set dine_in = 'yes', is_public = true where license_no = 'LIC-1';

truncate t_batch;
with b as (insert into public.import_batches (file_name, region_id, source_name, collected_at)
           values ('test.csv', 'seolleung_yeoksam', '공공데이터포털 전국일반음식점표준데이터', '2026-10-20') returning id)
insert into t_batch select id from b;
insert into public.import_staging (batch_id, license_no, name, category, road_address, lat, lng, coord_status, business_status)
select (select id from t_batch), v.* from (values
  ('LIC-1', '공공 매장 A', '한식', '서울 강남구 테헤란로 1', 37.5046, 127.0491, 'valid'::public.coord_status, 'open'::public.business_status),
  ('LIC-2', '공공 매장 B', '중식', '서울 강남구 테헤란로 2', null, null, 'missing', 'closed'),
  ('LIC-3', '공공 폐업 매장', '한식', '서울 강남구 테헤란로 3', 37.5047, 127.0492, 'valid', 'closed')
) v;
select pg_temp.check((select (r->>'inserted')::int = 0 and (r->>'updated')::int = 1 and (r->>'unchanged')::int = 1
                        from (select public.admin_commit_import((select id from t_batch)) r) x),
                     '재업로드: 신규 0건, 폐업으로 바뀐 1건만 갱신, 1건 변경 없음');
select pg_temp.check((select count(*) from public.restaurants where license_no like 'LIC-%') = 2, '재업로드 후 중복 매장 없음');
select pg_temp.check((select count(*) from public.menus m join public.restaurants r on r.id = m.restaurant_id
                       where r.license_no = 'LIC-1' and m.price_dine_in = 11000) = 1, '재업로드 후 관리자 메뉴·가격 유지');
select pg_temp.check((select dine_in = 'yes' and is_public from public.restaurants where license_no = 'LIC-1'),
                     '재업로드 후 관리자 운영여부·공개설정 유지');
select pg_temp.check((select business_status = 'closed' from public.restaurants where license_no = 'LIC-2'),
                     '재업로드로 폐업 상태 반영');

-- 관리자가 고친 이름은 재업로드로 덮어쓰지 않는다
update public.restaurants set name = '공공 매장 A (정정)', admin_edited = true where license_no = 'LIC-1';
truncate t_batch;
with b as (insert into public.import_batches (file_name, region_id, source_name, collected_at)
           values ('test.csv', 'seolleung_yeoksam', 'x', '2026-10-21') returning id)
insert into t_batch select id from b;
insert into public.import_staging (batch_id, license_no, name, category, lat, lng, coord_status, business_status)
values ((select id from t_batch), 'LIC-1', '공공 매장 A', '한식', 37.5046, 127.0491, 'valid', 'open');
select public.admin_commit_import((select id from t_batch)) is not null as committed \gset
select pg_temp.check((select name from public.restaurants where license_no = 'LIC-1') = '공공 매장 A (정정)',
                     '관리자 정정 이름 유지');

-- 실패한 반영은 전부 되돌려진다 (이미 반영된 배치를 다시 반영하면 오류 → 데이터 변화 없음)
do $$ declare before int; after int; begin
  select count(*) into before from public.restaurants;
  begin
    perform public.admin_commit_import((select id from t_batch));
    raise exception 'FAIL: 같은 배치 두 번 반영됨';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select count(*) into after from public.restaurants;
  if before <> after then raise exception 'FAIL: 실패한 반영이 데이터를 바꿈'; end if;
  raise notice 'ok  실패한 반영은 데이터 변경 없음';
end $$;

-- 대시보드·중복 확인
select pg_temp.check((select (s->>'total')::int = 9 and (s->>'coord_problem')::int = 1 and (s->>'with_menu')::int = 2
                        from (select public.admin_dashboard_stats() s) x), '관리자 대시보드 집계');
insert into public.restaurants (name, category, road_address, lat, lng, coord_status, business_status)
values ('시험 50m  한식', '한식', '시험로 9', 37.50482, 127.04941, 'valid', 'open');
select pg_temp.check(exists (select 1 from public.admin_find_duplicates() where a_name like '시험 50m%'),
                     '중복 의심 매장 찾기 (같은 이름·30m 이내)');

reset role;
\echo ALL_DB_TESTS_PASSED
