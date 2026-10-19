-- 5단계 주문 수집 DB 시험 (로컬 PostgreSQL + PostGIS 전용, 시험 DB 안에서만 데이터 생성)
\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

-- 주문 JSON 만들기: 분 전, 채널, 금액, 메뉴 [(이름, 수량, 단가)]
create or replace function pg_temp.ord(ext text, mins_ago int, ch text, total int, items jsonb,
                                       link text default null, cancelled boolean default false, refund int default 0)
returns jsonb language sql as $$
  select jsonb_build_object('external_order_id', ext, 'link_key', link, 'channel', ch,
    'ordered_at', now() - make_interval(mins => mins_ago), 'paid_at', now() - make_interval(mins => mins_ago),
    'total_amount', total, 'refund_amount', refund, 'is_cancelled', cancelled,
    'order_status', case when cancelled then 'cancelled' else 'completed' end, 'payment_status', 'paid',
    -- 개인정보가 들어와도 저장되지 않아야 한다
    'customer_name', '홍길동', 'customer_phone', '010-0000-0000', 'delivery_address', '서울 어딘가 101동',
    'items', items)
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'admin@example.com');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000a001');

insert into public.restaurants (id, name, category, lat, lng, coord_status, business_status, is_public, dine_in, takeout, delivery, delivery_radius_m)
values ('20000000-0000-0000-0000-000000000001', '시험 불백식당', '한식', 37.50455, 127.04905, 'valid', 'open', true, 'yes', 'yes', 'yes', 2000),
       ('20000000-0000-0000-0000-000000000002', '시험 옆집', '한식', 37.50460, 127.04910, 'valid', 'open', true, 'yes', 'yes', 'no', null);
insert into public.menus (id, restaurant_id, name, is_signature, price_dine_in, price_delivery, price_takeout) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '돼지불백', true, 9000, 10000, 8500),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '고추장불백', false, 9500, 10500, 9000),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '간장불백', false, 9500, 10500, 9000);

insert into public.order_connections (id, restaurant_id, provider, vendor, ingest_mode, status, store_consent, provider_permission, public_allowed, is_test)
values ('40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001', 'pos', '시험POS', 'webhook', 'active', true, true, true, false),
       ('40000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-000000000001', 'baemin', '하이픈(시험)', 'polling', 'active', true, true, true, false),
       ('40000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-000000000001', 'coupangeats', '시험', 'polling', 'active', true, true, false, false),
       ('40000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000002', 'pos', '시험POS', 'webhook', 'preparing', false, false, false, false),
       ('40000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-000000000001', 'pos', '가상', 'webhook', 'active', true, true, true, true);

-- ───── 권한 ─────
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin
  perform count(*) from public.orders; raise exception 'FAIL: anon이 주문 원본을 읽음';
exception when insufficient_privilege then raise notice 'ok  anon: 주문 원본(orders) 읽기 불가';
end $$;
do $$ begin
  perform count(*) from public.order_connections; raise exception 'FAIL: anon이 연동정보를 읽음';
exception when insufficient_privilege then raise notice 'ok  anon: 연동정보 읽기 불가';
end $$;
do $$ begin
  perform public.ingest_orders('40000000-0000-0000-0000-0000000000a1', '[]'::jsonb); raise exception 'FAIL: anon 주문 수집 허용';
exception when insufficient_privilege then raise notice 'ok  anon: 주문 수집 함수 실행 불가';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);

do $$ begin
  update public.order_connections set status = 'active' where id = '40000000-0000-0000-0000-0000000000b1';
  raise exception 'FAIL: 동의 없이 활성화됨';
exception when check_violation then raise notice 'ok  매장 동의·제공업체 허락 없이 실제 연동 활성화 불가';
end $$;
do $$ begin
  perform public.ingest_orders('40000000-0000-0000-0000-0000000000b1', '[]'::jsonb);
  raise exception 'FAIL: 연동 준비 상태에서 수집됨';
exception when insufficient_privilege then raise notice 'ok  연동 준비(미활성) 상태에서는 수집 거부';
end $$;

-- ───── 홀(POS) 주문 ─────
select public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('P1', 2, 'HALL', 18000, '[{"name":"돼지불백","quantity":2,"unit_price":9000}]'),
  pg_temp.ord('P2', 4, 'HALL', 9000,  '[{"name":"돼지불백","quantity":1,"unit_price":9000}]'),
  pg_temp.ord('P3', 6, 'HALL', 19000, '[{"name":"고추장불백","quantity":2,"unit_price":9500}]'),
  pg_temp.ord('P4', 8, 'HALL', 9000,  '[{"name":"돼지 불백","quantity":1,"unit_price":9000}]'),
  pg_temp.ord('P5', 9, 'HALL', 9500,  '[{"name":"간장불백","quantity":1,"unit_price":9500}]'),
  pg_temp.ord('P6', 20, 'HALL', 27000, '[{"name":"돼지불백","quantity":3,"unit_price":9000}]'),
  pg_temp.ord('P7', 45, 'HALL', 9000, '[{"name":"돼지불백(대)","quantity":1,"unit_price":9000}]'),
  pg_temp.ord('P8', 90, 'HALL', 9000, '[{"name":"돼지불백","quantity":1,"unit_price":9000}]'),
  pg_temp.ord('K1', 3, 'PICKUP', 8500, '[{"name":"간장불백","quantity":1,"unit_price":8500}]')
)) \gset first_
select pg_temp.check((select count(*) from public.orders where not is_test) = 9, 'POS 주문 9건 수집 (홀 8 + 포장 1)');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'HALL') = 5, '최근 10분 홀 주문 5건');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '30m' and channel = 'HALL') = 6, '최근 30분 홀 주문 6건');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '60m' and channel = 'HALL') = 7, '최근 60분 홀 주문 7건 (90분 전 제외)');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'PICKUP') = 1, '포장은 별도 채널로 집계');
-- 메뉴 수량 ≠ 주문 건수: 10분 안 돼지불백 = 2 + 1 + 1(‘돼지 불백’ 공백 차이 자동 매칭) = 4개, 주문은 3건
select pg_temp.check((select (q ->> 'quantity')::int from public.order_aggregates a, jsonb_array_elements(a.menu_quantities) q
                       where a.restaurant_id = '20000000-0000-0000-0000-000000000001' and a.scope = 'internal'
                         and a.window_key = '10m' and a.channel = 'HALL' and q ->> 'name' = '돼지불백') = 4,
                     '메뉴별 판매 수량은 주문 건수와 따로 (돼지불백 4개)');
select pg_temp.check((select menu_quantities -> 0 ->> 'name' from public.order_aggregates
                       where restaurant_id = '20000000-0000-0000-0000-000000000001' and scope = 'internal'
                         and window_key = 'today' and channel = 'HALL') = '돼지불백', '홀 인기메뉴 = 판매 수량 1위');
select pg_temp.check((select count(*) from public.order_items where match_status = 'unmatched') = 1, '내부 메뉴와 다른 이름(돼지불백(대))은 확인 필요로 분류');

-- 개인정보는 저장할 곳이 없다
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public'
                       and table_name in ('orders', 'order_items', 'order_aggregates')
                       and column_name ~ '(customer|phone|address|card|name$)' and column_name <> 'external_menu_name'),
                     '주문 테이블에 고객 이름·전화·주소·카드 열 없음');

-- ───── 같은 주문 재수집 → 중복 생성·이중 집계 없음 ─────
select public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('P1', 2, 'HALL', 18000, '[{"name":"돼지불백","quantity":2,"unit_price":9000}]'),
  pg_temp.ord('P2', 4, 'HALL', 9000,  '[{"name":"돼지불백","quantity":1,"unit_price":9000}]')
)) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'inserted')::int = 0 and (:'r'::jsonb ->> 'updated')::int = 2, '재수집: 신규 0건, 기존 2건 갱신');
select pg_temp.check((select count(*) from public.orders where not is_test) = 9, '재수집 후 주문 수 그대로');
select pg_temp.check((select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.external_order_id = 'P1') = 1,
                     '재수집 후 메뉴 행이 두 번 쌓이지 않음');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'HALL') = 5, '재수집 후 10분 집계 그대로 5건');

-- ───── 취소·환불 ─────
select public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('P2', 4, 'HALL', 9000, '[{"name":"돼지불백","quantity":1,"unit_price":9000}]', null, true),
  pg_temp.ord('P3', 6, 'HALL', 19000, '[{"name":"고추장불백","quantity":2,"unit_price":9500}]', null, false, 9500)
)) is not null as ok \gset
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'HALL') = 4, '취소 반영: 10분 홀 4건');
select pg_temp.check((select cancelled_count = 1 and gross_amount = 18000 + 19000 + 9000 + 9500
                             and net_amount = 18000 + 9500 + 9000 + 9500
                        from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                         and scope = 'internal' and window_key = '10m' and channel = 'HALL'), '환불 반영: 실제 집계금액에서 환불 차감');

-- ───── 배민 배달 + POS 자동입력(연결번호 있음) → 하나로 통합 ─────
select public.ingest_orders('40000000-0000-0000-0000-0000000000a2', jsonb_build_array(
  pg_temp.ord('B1', 3, 'DELIVERY', 10500, '[{"name":"고추장불백","quantity":1,"unit_price":10500}]', 'LINK-1'),
  pg_temp.ord('B2', 5, 'DELIVERY', 21000, '[{"name":"고추장불백","quantity":2,"unit_price":10500}]', 'LINK-2'),
  pg_temp.ord('B3', 7, 'PICKUP', 9000, '[{"name":"간장불백","quantity":1,"unit_price":9000}]', 'LINK-3')
)) is not null as ok \gset
select public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('POS-B1', 3, 'DELIVERY', 10500, '[{"name":"고추장불백","quantity":1,"unit_price":10500}]', 'LINK-1'),
  pg_temp.ord('POS-B2', 5, 'DELIVERY', 21000, '[{"name":"고추장불백","quantity":2,"unit_price":10500}]', 'LINK-2')
)) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'merged')::int = 2, 'POS에 같은 연결번호로 들어온 배달 주문 2건 통합');
select pg_temp.check((select dedup_status from public.orders where external_order_id = 'B3') = 'unique',
                     '채널이 다른 주문(홀 P4 ↔ 배민 포장 B3)은 같은 금액·시각이어도 중복 의심하지 않음');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'DELIVERY') = 2, '통합 후 배달 주문 2건 (4건 아님)');
select pg_temp.check((select (by_provider ->> 'baemin')::int = 2 and by_provider ->> 'pos' is null from public.order_aggregates
                       where restaurant_id = '20000000-0000-0000-0000-000000000001' and scope = 'internal'
                         and window_key = '10m' and channel = 'DELIVERY'), '제공처별 건수: 배민 2 (POS 사본 제외)');
select pg_temp.check((select menu_quantities -> 0 ->> 'name' from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = 'today' and channel = 'DELIVERY') = '고추장불백', '배달 인기메뉴 = 고추장불백');

-- ───── 쿠팡이츠 + 연결번호 없는 POS 사본 → 중복 가능성 확인 필요 (합산 안 함) ─────
select public.ingest_orders('40000000-0000-0000-0000-0000000000a3', jsonb_build_array(
  pg_temp.ord('C1', 2, 'DELIVERY', 20000, '[{"name":"돼지불백","quantity":2,"unit_price":10000}]'),
  pg_temp.ord('C2', 6, 'DELIVERY', 10000, '[{"name":"돼지불백","quantity":1,"unit_price":10000}]')
)) is not null as ok \gset
select public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('POS-C1', 1, 'DELIVERY', 20000, '[{"name":"돼지불백","quantity":2,"unit_price":10000}]'),
  pg_temp.ord('POS-C2', 6, 'DELIVERY', 10000, '[{"name":"돼지불백","quantity":1,"unit_price":10000}]')
)) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'needs_review')::int = 2, '연결번호 없는 같은 금액·3분 이내 주문 2건 → 확인 필요');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'DELIVERY') = 4, '확인 필요 주문은 합산 안 함 (배민 2 + 쿠팡 2)');
select public.admin_resolve_duplicate((select id from public.orders where external_order_id = 'POS-C1'), 'duplicate');
select public.admin_resolve_duplicate((select id from public.orders where external_order_id = 'POS-C2'), 'separate');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'internal' and window_key = '10m' and channel = 'DELIVERY') = 5,
                     '관리자 판정: 같은 주문은 통합, 별개 주문은 포함 (5건)');

-- ───── 소비자 공개 집계 ─────
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check((select activity -> 'windows' ->> '10m' is null and (activity -> 'windows' ->> '30m')::int = 5
                        from public.search_restaurants(37.5045, 127.049, 'walk', 100) where name = '시험 불백식당'),
                     '소비자: 최소 공개 5건 미만 창(10분 4건)은 숨기고 30분 5건만 공개');
select pg_temp.check((select activity -> 'top_menu' ->> 'name' from public.search_restaurants(37.5045, 127.049, 'walk', 100)
                       where name = '시험 불백식당') = '돼지불백', '소비자: 홀 인기메뉴 공개 (내부 메뉴와 연결된 것만)');
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100) where name = '시험 옆집'),
                     '연동되지 않은 매장은 activity 없음 (0건이 아님)');
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'delivery', 100) where name = '시험 불백식당'),
                     '배달: 공개 허용 주문(배민 2)이 최소 건수 미만이면 비공개 — 쿠팡이츠(공개 불허)는 공개 집계에서 제외');
select pg_temp.check(not exists (select 1 from public.public_order_activity(array['20000000-0000-0000-0000-000000000001'::uuid], 'HALL', true)
                                  where activity ->> 'scope' = 'test'), '일반 이용자는 테스트 집계를 요청해도 볼 수 없음');
reset role;

-- ───── 테스트 주문 분리 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select public.ingest_orders('40000000-0000-0000-0000-0000000000f1', (
  select jsonb_agg(pg_temp.ord('T' || g, 1, 'HALL', 9000, '[{"name":"돼지불백","quantity":1,"unit_price":9000}]'))
    from generate_series(1, 30) g)) is not null as ok \gset
select pg_temp.check((select count(*) from public.orders where is_test) = 30 and (select count(*) from public.orders where not is_test) = 18,
                     '테스트 주문은 is_test로 분리 저장');
select pg_temp.check((select order_count from public.order_aggregates where restaurant_id = '20000000-0000-0000-0000-000000000001'
                       and scope = 'public' and window_key = '10m' and channel = 'HALL') = 4, '테스트 주문 30건이 공개·실제 집계에 섞이지 않음');
select pg_temp.check((select (activity -> 'windows' ->> '10m')::int from public.public_order_activity(
                       array['20000000-0000-0000-0000-000000000001'::uuid], 'HALL', true)) = 30, '관리자는 테스트 집계를 따로 볼 수 있음');
select pg_temp.check((select (r -> 'today' ->> 'HALL')::int = 7 and (r -> 'today' ->> 'DELIVERY')::int = 5
                             and (r -> 'today' ->> 'PICKUP')::int = 2 and (r ->> 'needs_review')::int = 0
                        from (select public.admin_order_overview(false) r) x), '관리자 메인: 오늘 홀 7 · 배달 5 · 포장 2 (실제)');
select pg_temp.check((select (r -> 'today' ->> 'HALL')::int = 30 from (select public.admin_order_overview(true) r) x), '관리자 메인: 테스트 보기 따로');
select pg_temp.check((select (r -> 'today_by_provider' ->> 'coupangeats')::int = 2 and (r -> 'today_by_provider' ->> 'baemin')::int = 3
                        from (select public.admin_restaurant_order_stats('20000000-0000-0000-0000-000000000001', false) r) x),
                     '매장별 현황: 배민 3 · 쿠팡이츠 2 따로');
select pg_temp.check((select (r -> 'windows' -> '10m' ->> 'HALL')::int = 4
                             and (r -> 'windows' -> 'lunch' ->> 'HALL') is not null
                        from (select public.admin_restaurant_order_stats('20000000-0000-0000-0000-000000000001', false) r) x),
                     '매장별 현황: 최근 10분 홀 4건 + 오늘 점심(11~14시) 창 제공');

-- ───── 메뉴 매칭 ─────
select pg_temp.check(public.admin_map_menu('20000000-0000-0000-0000-000000000001', '돼지불백(대)', '30000000-0000-0000-0000-000000000001') = 1,
                     '외부 메뉴명 → 내부 메뉴 연결');
select pg_temp.check((select count(*) from public.order_items where match_status = 'unmatched') = 0, '연결 후 미확인 메뉴 없음');
do $$ begin
  perform public.admin_map_menu('20000000-0000-0000-0000-000000000002', '돼지불백', '30000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: 다른 매장 메뉴에 연결됨';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok  다른 매장의 메뉴에는 연결 불가';
end $$;

-- ───── API 오류·호출 한도 ─────
update public.order_connections set test_simulate_error = true where id = '40000000-0000-0000-0000-0000000000f1';
select pg_temp.check((public.ingest_orders('40000000-0000-0000-0000-0000000000f1', '[]'::jsonb) ->> 'ok')::boolean = false,
                     '테스트: API 오류 상황 시뮬레이션');
select pg_temp.check((select status = 'error' and last_error is not null from public.order_connections where id = '40000000-0000-0000-0000-0000000000f1'),
                     '오류 상태·메시지·시각 기록');
select pg_temp.check((select (r ->> 'error_restaurants')::int = 1 from (select public.admin_order_overview(true) r) x), '관리자 메인: 오류 매장 수 표시');
select pg_temp.check((select bool_and(data_status = 'error') from public.order_aggregates where scope = 'test'),
                     '유일한 테스트 연동이 오류면 테스트 집계 상태 = error (소비자 비공개)');

update public.order_connections set unit_cost_krw = 10 where id = '40000000-0000-0000-0000-0000000000a2';
select pg_temp.check(public.reserve_api_calls('40000000-0000-0000-0000-0000000000a2', 1) = false, '예산 0원이면 유료 호출 예약 거부');
select pg_temp.check((select status = 'paused' from public.order_connections where id = '40000000-0000-0000-0000-0000000000a2'),
                     '한도 초과 시 연동 자동 일시중지');
update public.order_settings set monthly_budget_krw = 25;
update public.order_connections set status = 'active' where id = '40000000-0000-0000-0000-0000000000a2';
select pg_temp.check(public.reserve_api_calls('40000000-0000-0000-0000-0000000000a2', 2), '예산 안에서는 호출 예약 허용 (20원)');
select pg_temp.check(not public.reserve_api_calls('40000000-0000-0000-0000-0000000000a2', 1), '예산(25원) 초과분은 거부');
select pg_temp.check((select calls_this_month from public.order_connections where id = '40000000-0000-0000-0000-0000000000a2') = 2,
                     '이번 달 호출량 기록');

-- ───── 최소 공개 건수 변경·오래된 집계 ─────
update public.order_settings set min_public_count = 7;
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100) where name = '시험 불백식당'),
                     '최소 공개 건수를 7로 올리면 30분 5건·60분 6건도 비공개');
reset role;
update public.order_settings set min_public_count = 5;
update public.order_aggregates set refreshed_at = now() - interval '1 hour';
set role anon;
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100) where name = '시험 불백식당'),
                     '갱신이 오래된(15분 초과) 집계는 소비자에게 보이지 않음');
reset role;

-- ───── 테스트 데이터 삭제 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select pg_temp.check(public.admin_delete_test_orders() = 30, '테스트 주문만 삭제');
select pg_temp.check((select count(*) from public.orders) = 18, '실제 주문은 그대로');
reset role;

-- ───── 서버(service_role) 수집 ─────
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select pg_temp.check((public.ingest_orders('40000000-0000-0000-0000-0000000000a1', jsonb_build_array(
  pg_temp.ord('S1', 1, 'HALL', 9000, '[{"name":"돼지불백","quantity":1}]'))) ->> 'inserted')::int = 1,
  'Edge Function(service_role)으로 수집 가능');
reset role;
\echo ALL_STAGE5_TESTS_PASSED
