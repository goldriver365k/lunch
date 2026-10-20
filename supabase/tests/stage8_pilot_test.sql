-- 8단계 운영 기능 DB 시험 (로컬 PostgreSQL + PostGIS 전용, 시험 DB 안에서만 데이터 생성)
\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000c001', 'user@example.com');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000a001');

-- 선릉역 북쪽 시험 매장 2곳 + 판교 1곳
insert into public.restaurants (id, name, category, lat, lng, coord_status, business_status, is_public, dine_in, takeout, delivery, region_id, verify_status)
values ('81000000-0000-0000-0000-000000000001', '시험 백반', '한식', 37.5045 + 30 / 111320.0, 127.049, 'valid', 'open', true, 'yes', 'yes', 'no', 'seolleung_yeoksam', 'needs_review'),
       ('81000000-0000-0000-0000-000000000002', '시험 백반', '한식', 37.5045 + 40 / 111320.0, 127.049, 'valid', 'open', true, 'yes', 'yes', 'no', 'seolleung_yeoksam', 'verified'),
       ('81000000-0000-0000-0000-000000000003', '판교 국수', '기타', 37.394762 + 30 / 111320.0, 127.111137, 'valid', 'open', true, 'yes', 'unknown', 'no', 'pangyo', 'unverified');
insert into public.menus (restaurant_id, name, is_signature, price_dine_in, price_verified_at)
values ('81000000-0000-0000-0000-000000000002', '김치찌개', true, 9000, '2026-10-01'),
       ('81000000-0000-0000-0000-000000000003', '잔치국수', true, 7000, null);
insert into public.order_connections (id, restaurant_id, provider, ingest_mode, status, store_consent, provider_permission, public_allowed, is_test, last_success_at)
values ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 'pos', 'polling', 'active', true, true, true, false, now()),
       ('82000000-0000-0000-0000-000000000009', '81000000-0000-0000-0000-000000000002', 'pos', 'webhook', 'active', true, true, false, true, now());

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select public.ingest_orders('82000000-0000-0000-0000-000000000001', (
  select jsonb_agg(jsonb_build_object('external_order_id', 'P' || g, 'channel', 'HALL', 'ordered_at', now() - make_interval(mins => g),
                                      'total_amount', 9000, 'order_status', 'completed', 'payment_status', 'paid'))
    from generate_series(1, 6) g)) is not null as ok \gset
reset role;

-- ───── 이용 통계 ─────
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'visit', null, 'seolleung') is not null as ok \gset
select public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'search', 'walk', 'seolleung') is not null as ok \gset
select public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'search', 'delivery', 'seolleung') is not null as ok \gset
select public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'detail_view', 'walk', 'seolleung') is not null as ok \gset
select public.log_usage('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'search', 'takeout', 'pangyo') is not null as ok \gset
select public.log_usage('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'find_route', 'walk', 'pangyo') is not null as ok \gset
select public.log_usage('33333333-3333-3333-3333-333333333333', 'cccccccc-0000-0000-0000-000000000001', 'search', 'walk', 'yeouido', true) is not null as ok \gset
select pg_temp.check(not public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'hack'),
                     '알 수 없는 이벤트는 버림');
select pg_temp.check(not public.log_usage('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'search', 'walk', '37.5,127.0'),
                     '지역 칸에 좌표 같은 값은 저장하지 않음');
do $$ begin
  perform count(*) from public.usage_events;
  raise exception 'FAIL: 비로그인이 이용 기록을 읽음';
exception when insufficient_privilege then raise notice 'ok  비로그인은 이용 기록을 읽을 수 없음 (기록만 가능)';
end $$;
reset role;
-- 같은 기기에서 1분에 60건 넘게 보내면 버린다
select count(*) from (select public.log_usage('44444444-4444-4444-4444-444444444444', 'dddddddd-0000-0000-0000-000000000001', 'search', 'walk')
                        from generate_series(1, 70)) x \gset
select pg_temp.check((select count(*) from public.usage_events where visitor_id = '44444444-4444-4444-4444-444444444444') = 60,
                     '같은 기기 1분 60건 초과 요청은 버림 (비정상 사용 방지)');
delete from public.usage_events where visitor_id = '44444444-4444-4444-4444-444444444444';
select pg_temp.check(not exists (select 1 from information_schema.columns where table_name = 'usage_events' and column_name in ('lat', 'lng', 'ip')),
                     '이용 기록에 좌표·IP 열 없음');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
create temp table u as select public.admin_usage_overview() j;
select pg_temp.check((select (j ->> 'visitors')::int = 2 and (j ->> 'sessions')::int = 3 and (j ->> 'searches')::int = 3 from u),
                     '방문자 2 · 세션 3 · 검색 3 (사용자·세션·검색 구분, 테스트 위치 기록 제외)');
select pg_temp.check((select j -> 'searches_by_mode' = '{"walk": 1, "delivery": 1, "takeout": 1}'::jsonb
                         and (j ->> 'detail_views')::int = 1 and (j ->> 'find_route')::int = 1 from u), '도보·배달·포장 검색, 상세 조회, 매장찾기 클릭');
select pg_temp.check((select (a ->> 'searches')::int from u, jsonb_array_elements(j -> 'by_area') a where a ->> 'area' = 'seolleung') = 2,
                     '지역별 이용 건수');
select pg_temp.check((select jsonb_array_length(j -> 'by_hour') = 24 and jsonb_array_length(j -> 'last7') = 7 from u), '시간대별·최근 7일');
select pg_temp.check((select (public.admin_usage_overview(null, true) ->> 'searches')::int) = 4, '테스트 기록은 따로 볼 때만 포함');
select pg_temp.check((select (public.admin_system_status() ->> 'db_size_bytes')::bigint > 0), '서버 현황: DB 사용량');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', false);
do $$ begin
  perform public.admin_usage_overview();
  raise exception 'FAIL: 일반 회원이 운영 현황 조회';
exception when insufficient_privilege then raise notice 'ok  일반 회원은 운영 현황·서버 현황을 볼 수 없음';
end $$;
reset role;

-- ───── 관리 작업 이력 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
update public.restaurants set dine_in = 'yes' where region_id = 'seolleung_yeoksam';
select pg_temp.check((select actor = '00000000-0000-0000-0000-00000000a001' and op = 'UPDATE' and row_count = 2
                        from public.admin_audit_log where table_name = 'restaurants' order by id desc limit 1),
                     '관리 작업 이력: 누가·어느 표·몇 행 (여러 행도 한 줄)');
do $$ begin
  insert into public.admin_audit_log (table_name, op, row_count) values ('x', 'y', 1);
  raise exception 'FAIL: 이력 위조';
exception when insufficient_privilege then raise notice 'ok  이력은 직접 쓰거나 고칠 수 없음';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', false);
select pg_temp.check((select count(*) from public.admin_audit_log) = 0, '일반 회원에게 이력이 보이지 않음');
update public.app_settings set notice_message = 'x';
select pg_temp.check((select notice_message from public.app_settings) is null, '일반 회원은 운영 설정을 바꿀 수 없음 (0행)');
reset role;
select pg_temp.check((select notice_message from public.app_settings) is null, '운영 설정 그대로');

-- ───── 소비자 검색·실시간 표시 공개 범위 ─────
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
create temp table s1 as select * from public.search_restaurants(37.5045, 127.049, 'walk', 100);
select pg_temp.check((select activity ->> 'status' from s1 where id = '81000000-0000-0000-0000-000000000002') = 'active', '기본: 최근 주문 확인');
select pg_temp.check((select verify_status::text from s1 where id = '81000000-0000-0000-0000-000000000001') = 'needs_review',
                     '정보 확인 필요 상태를 화면에 넘김');
reset role;
update public.app_settings set live_orders_public = false, notice_message = '점심 시간 점검 중';
set role anon;
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100) where id = '81000000-0000-0000-0000-000000000002')
                     and (select count(*) from public.search_restaurants(37.5045, 127.049, 'walk', 100)) = 2,
                     '실시간 표시를 멈추면 주문정보 없이 거리순 검색은 유지');
select pg_temp.check((public.public_app_settings() ->> 'notice') = '점심 시간 점검 중' and not (public.public_app_settings() ->> 'live_orders_public')::boolean,
                     '공지·실시간 표시 상태를 소비자 앱에 전달');
reset role;
update public.app_settings set live_orders_public = true, notice_message = null;
update public.regions set live_public = false where id = 'seolleung_yeoksam';
set role anon;
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100) where id = '81000000-0000-0000-0000-000000000002'),
                     '실시간 인기매장 미공개 지역은 주문정보 없음으로 표시');
reset role;
update public.regions set live_public = true where id = 'seolleung_yeoksam';
update public.regions set search_public = false where id = 'pangyo';
set role anon;
select pg_temp.check((select count(*) from public.search_restaurants(37.394762, 127.111137, 'walk', 100)) = 0, '검색 미공개 지역(판교)은 일반 이용자에게 결과 없음');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select pg_temp.check((select count(*) from public.search_restaurants(37.394762, 127.111137, 'walk', 100)) = 1, '관리자는 미공개 지역도 검색해 확인 가능');
reset role;
update public.regions set search_public = true where id = 'pangyo';

-- ───── 신선도: 제공처 주문 기준시각 ─────
update public.order_connections set provider_as_of = now() - interval '2 hours' where id = '82000000-0000-0000-0000-000000000001';
set role anon;
select pg_temp.check((select activity ->> 'status' from public.search_restaurants(37.5045, 127.049, 'walk', 100) where id = '81000000-0000-0000-0000-000000000002') = 'delayed',
                     'API 호출은 최신이어도 제공처 주문 기준시각이 오래되면 데이터 갱신 지연');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select public.report_connection_as_of('82000000-0000-0000-0000-000000000001', now()) is null as ok \gset
reset role;
set role anon;
select pg_temp.check((select activity ->> 'status' from public.search_restaurants(37.5045, 127.049, 'walk', 100) where id = '81000000-0000-0000-0000-000000000002') = 'active',
                     '제공처 기준시각이 갱신되면 다시 최신');
do $$ begin
  perform public.report_connection_as_of('82000000-0000-0000-0000-000000000001', now());
  raise exception 'FAIL: 비로그인이 기준시각 조작';
exception when insufficient_privilege then raise notice 'ok  기준시각은 관리자·서버만 기록';
end $$;
reset role;

-- ───── 수집 일시중지 ─────
update public.app_settings set collection_paused = true;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
do $$ begin
  perform public.ingest_orders('82000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object(
    'external_order_id', 'Z1', 'channel', 'HALL', 'ordered_at', now(), 'total_amount', 9000)));
  raise exception 'FAIL: 일시중지 중 실제 주문 수집';
exception when object_not_in_prerequisite_state then raise notice 'ok  수집 일시중지 중에는 실제 주문을 받지 않음';
end $$;
select pg_temp.check((public.ingest_orders('82000000-0000-0000-0000-000000000009', jsonb_build_array(jsonb_build_object(
    'external_order_id', 'T1', 'channel', 'HALL', 'ordered_at', now(), 'total_amount', 9000))) ->> 'ok')::boolean, '테스트 주문은 계속 검증 가능');
select pg_temp.check(not public.reserve_api_calls('82000000-0000-0000-0000-000000000001'), '일시중지 중에는 외부 API 호출 예약 거절');
reset role;
set role anon;
select pg_temp.check((select activity ->> 'status' from public.search_restaurants(37.5045, 127.049, 'walk', 100) where id = '81000000-0000-0000-0000-000000000002') = 'delayed',
                     '일시중지 중 실제 주문정보는 갱신 지연으로 표시 (가상 데이터로 대체하지 않음)');
reset role;
update public.app_settings set collection_paused = false;

-- ───── 데이터 점검 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
create temp table q as select r from jsonb_array_elements(public.admin_data_quality()) r;
select pg_temp.check((select (r ->> 'possible_duplicates')::int = 2 and (r ->> 'needs_review')::int = 1 and (r ->> 'menu_ready')::int = 1
                         and (r ->> 'live_ready')::int = 1 and (r ->> 'without_menu')::int = 1
                        from q where r ->> 'region_id' = 'seolleung_yeoksam'),
                     '선릉·역삼 점검: 중복 의심 2 · 정보 확인 필요 1 · 메뉴정보 1 · 실시간 준비 1 · 메뉴 없음 1');
select pg_temp.check((select (r ->> 'price_unverified')::int = 1 and (r ->> 'category_other')::int = 1 and (r ->> 'channel_unknown')::int = 1
                         and (r ->> 'live_ready')::int = 0 from q where r ->> 'region_id' = 'pangyo'),
                     '판교 점검: 가격 확인일 없음 · 음식 종류 기타 · 운영 여부 미확인 · 실시간 없음');
reset role;
-- ───── 김해 인제대 현장 시험 지역 ─────
insert into public.restaurants (name, category, lat, lng, coord_status, business_status, is_public, dine_in, region_id)
values ('김해 시험 식당', '한식', 35.248611 - 200 / 111320.0, 128.9025, 'valid', 'open', true, 'yes', 'gimhae_inje');
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check((select name from public.search_restaurants(35.248611, 128.9025, 'walk', 300)) = '김해 시험 식당',
                     '김해 인제대 시험 지역: 로그인 없이 휴대폰 GPS로 검색 가능 (200m 매장)');
reset role;
select pg_temp.check((select not live_public from public.regions where id = 'gimhae_inje')
                     and (select not business_visible from public.market_areas where id = 'inje'),
                     '김해 시험 지역은 실시간 인기매장·사업자 화면 비공개');
\echo ALL_STAGE8_TESTS_PASSED
