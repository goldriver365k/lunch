-- 6단계 인기 음식점 정렬 DB 시험 (로컬 PostgreSQL + PostGIS 전용, 시험 DB 안에서만 데이터 생성)
\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

-- n건의 주문 JSON: 접두사, 분 전(시작), 간격(분), 채널, 메뉴, 수량, 추가 필드
create or replace function pg_temp.orders(prefix text, n int, mins_ago numeric, step numeric, ch text,
                                          menu text default '돼지불백', qty int default 1, extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'external_order_id', prefix || '-' || g, 'channel', ch,
    'ordered_at', now() - make_interval(secs => ((mins_ago + (g - 1) * step) * 60)::double precision),
    'total_amount', 9000 * qty, 'order_status', 'completed', 'payment_status', 'paid',
    'items', jsonb_build_array(jsonb_build_object('name', menu, 'quantity', qty, 'unit_price', 9000))) || extra), '[]'::jsonb)
  from generate_series(1, n) g
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'admin@example.com');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000a001');

-- 선릉역(37.5045, 127.049)에서 북쪽으로 거리별 시험 매장
insert into public.restaurants (id, name, category, lat, lng, coord_status, business_status, is_public,
                                dine_in, takeout, delivery, delivery_radius_m, region_id)
select ('60000000-0000-0000-0000-0000000000' || v.k)::uuid, v.name, v.cat,
       37.5045 + v.d / 111320.0, 127.049, 'valid', 'open', true, 'yes', 'yes', 'yes', 2000, v.region
  from (values
    ('0a', '가 활발식당', '한식', 90, 'seolleung_yeoksam'),
    ('0b', '나 30분강자', '한식', 80, 'seolleung_yeoksam'),
    ('0c', '다 취소많음', '중식', 30, 'seolleung_yeoksam'),
    ('0d', '라 소량주문', '한식', 20, 'seolleung_yeoksam'),
    ('0e', '마 주문없음', '한식', 10, 'seolleung_yeoksam'),
    ('0f', '바 미연동', '한식', 5, 'seolleung_yeoksam'),
    ('10', '사 갱신지연', '한식', 15, 'seolleung_yeoksam'),
    ('11', '아 공개불허', '한식', 25, 'seolleung_yeoksam'),
    ('12', '자 멀리', '한식', 250, 'pangyo')
  ) as v(k, name, cat, d, region);

insert into public.menus (restaurant_id, name, is_signature, price_dine_in, price_delivery, price_takeout)
select r.id, m.name, m.sig, 9000, 10000, 8500
  from public.restaurants r cross join (values ('돼지불백', true), ('고추장불백', false), ('간장불백', false)) m(name, sig);

-- 연동: 실제·공개 허용·활성 (사는 주기 조회형으로 오래 수집 못 함, 아는 공개 불허)
insert into public.order_connections (id, restaurant_id, provider, ingest_mode, status, store_consent, provider_permission, public_allowed, is_test)
select ('70000000-0000-0000-0000-00000000' || v.k || v.p)::uuid, ('60000000-0000-0000-0000-0000000000' || v.k)::uuid,
       v.provider, v.mode, 'active', true, true, v.pub, false
  from (values
    ('0a', '01', 'pos', 'webhook', true), ('0b', '01', 'pos', 'webhook', true), ('0c', '01', 'pos', 'webhook', true),
    ('0d', '01', 'pos', 'webhook', true), ('0e', '01', 'pos', 'webhook', true), ('10', '01', 'pos', 'polling', true),
    ('11', '01', 'pos', 'webhook', false), ('12', '01', 'pos', 'webhook', true),
    ('0e', '02', 'baemin', 'webhook', true), ('0a', '02', 'baemin', 'webhook', true)
  ) as v(k, p, provider, mode, pub);

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);

-- 가: 최근 10분 홀 8건 (돼지불백 2개씩 → 메뉴 16개) + 고추장불백 3건
select public.ingest_orders('70000000-0000-0000-0000-000000000a01', pg_temp.orders('A', 8, 1, 1, 'HALL', '돼지불백', 2)) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000a01', pg_temp.orders('A2', 3, 40, 1, 'HALL', '고추장불백')) is not null as ok \gset
-- 나: 10분 6건 + 10~30분 6건 (30분 12건)
select public.ingest_orders('70000000-0000-0000-0000-000000000b01', pg_temp.orders('B', 6, 1, 1, 'HALL')) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000b01', pg_temp.orders('B2', 6, 12, 2, 'HALL')) is not null as ok \gset
-- 다: 유효 6건 + 취소 5건 + 결제 실패 5건 (세면 16건이 되지만 유효는 6건) → 나보다 뒤
select public.ingest_orders('70000000-0000-0000-0000-000000000c01', pg_temp.orders('C', 6, 1, 1, 'HALL')) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000c01',
  pg_temp.orders('C-X', 5, 1, 1, 'HALL', '돼지불백', 1, '{"is_cancelled": true, "order_status": "cancelled"}')) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000c01',
  pg_temp.orders('C-F', 5, 1, 1, 'HALL', '돼지불백', 1, '{"payment_status": "failed"}')) is not null as ok \gset
-- 다: 같은 주문 재전송 → 늘지 않음
select public.ingest_orders('70000000-0000-0000-0000-000000000c01', pg_temp.orders('C', 6, 1, 1, 'HALL')) is not null as ok \gset
-- 라: 3건 (최소 공개 5건 미만)
select public.ingest_orders('70000000-0000-0000-0000-000000000d01', pg_temp.orders('D', 3, 1, 1, 'HALL')) is not null as ok \gset
-- 마: 홀 주문 없음, 배달 20건 (홀 순위에 섞이면 안 됨)
select public.ingest_orders('70000000-0000-0000-0000-000000000e02', pg_temp.orders('E', 20, 1, 0.4, 'DELIVERY', '고추장불백')) is not null as ok \gset
-- 가: 배달 6건 (배달 순위에서 마보다 뒤), 포장 POS 5건 + 배민 포장 5건 중 3건은 같은 주문(연결번호)
select public.ingest_orders('70000000-0000-0000-0000-000000000a02', pg_temp.orders('A-D', 6, 1, 1, 'DELIVERY', '고추장불백')) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000a02',
  (select jsonb_agg(o || jsonb_build_object('link_key', 'PK-' || (o ->> 'external_order_id')))
     from jsonb_array_elements(pg_temp.orders('A-P', 5, 2, 1, 'PICKUP', '간장불백')) o)) is not null as ok \gset
select public.ingest_orders('70000000-0000-0000-0000-000000000a01',
  (select jsonb_agg(o || jsonb_build_object('link_key', 'PK-A-P-' || g, 'external_order_id', 'POS-P-' || g))
     from jsonb_array_elements(pg_temp.orders('x', 3, 2, 1, 'PICKUP', '간장불백')) with ordinality t(o, g))) is not null as ok \gset
-- 사: 주문 10건이 있지만 주기 조회가 1시간 전에 멈춤 → 갱신 지연
select public.ingest_orders('70000000-0000-0000-0000-000000001001', pg_temp.orders('G', 10, 1, 0.5, 'HALL')) is not null as ok \gset
update public.order_connections set last_success_at = now() - interval '1 hour' where id = '70000000-0000-0000-0000-000000001001';
-- 아: 주문 30건이지만 소비자 공개 불허
select public.ingest_orders('70000000-0000-0000-0000-000000001101', pg_temp.orders('H', 30, 1, 0.2, 'HALL')) is not null as ok \gset
reset role;

-- ───── 소비자: 도보(홀) 지금 주문 많은 순 ─────
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
create temp table w as select row_number() over () as ord, * from public.search_restaurants(37.5045, 127.049, 'walk', 100);
select pg_temp.check((select array_agg(name order by ord) from w where rank_group = 0)
                     = array['가 활발식당', '나 30분강자', '다 취소많음', '마 주문없음', '라 소량주문'],
                     '홀 순위: 10분 건수 ↓ → 30분 건수 ↓ → 거리 ↑ (취소·결제실패 제외, 소량·0건은 거리순)');
select pg_temp.check((select array_agg(name order by ord) from w where rank_group = 1)
                     = array['바 미연동', '사 갱신지연', '아 공개불허'], '데이터 없음·갱신 지연·공개 불허 매장은 별도 그룹에서 거리순');
select pg_temp.check((select max(ord) from w where rank_group = 0) < (select min(ord) from w where rank_group = 1), '주문 데이터 그룹이 먼저');
select pg_temp.check((select (activity ->> 'rank_primary')::int = 8 and (activity -> 'windows' ->> '10m')::int = 8 from w where name = '가 활발식당'),
                     '가: 최근 10분 홀 8건');
select pg_temp.check((select (activity ->> 'rank_primary')::int = 6 and (activity ->> 'rank_secondary')::int = 12 from w where name = '나 30분강자'),
                     '나: 10분 6건, 30분 12건 (같은 10분 건수의 다보다 앞)');
select pg_temp.check((select (activity ->> 'rank_primary')::int = 6 and (activity ->> 'rank_secondary')::int = 6 from w where name = '다 취소많음'),
                     '다: 취소 5·결제 실패 5·재전송은 유효 주문에서 제외 (6건)');
select pg_temp.check((select activity ->> 'status' = 'active' and (activity ->> 'rank_primary')::int = 0 and activity -> 'windows' = '{}'::jsonb
                        from w where name = '라 소량주문'), '라: 최근 주문 확인이지만 5건 미만 → 건수·순위값 비공개');
select pg_temp.check((select activity ->> 'status' = 'none_recent' from w where name = '마 주문없음'),
                     '마: 연동은 최신인데 홀 주문 0건 → ‘최근 주문 없음’ (배달 20건은 홀 순위에 안 들어감)');
select pg_temp.check((select activity is null from w where name = '바 미연동'), '바: 연동 없음 → 주문정보 없음 (0건 아님)');
select pg_temp.check((select activity ->> 'status' = 'delayed' and activity -> 'windows' = '{}'::jsonb and (activity ->> 'rank_primary')::int = 0
                        from w where name = '사 갱신지연'), '사: 15분 넘게 수집 못 한 데이터는 ‘갱신 지연’, 순위에 반영 안 함');
select pg_temp.check((select activity is null from w where name = '아 공개불허'), '아: 공개 불허 연동의 주문은 소비자 순위·화면에 없음');
select pg_temp.check((select activity -> 'top_menus' = ('[{"name": "돼지불백", "menu_id": "' ||
                              (select id from public.menus where name = '돼지불백' and restaurant_id = '60000000-0000-0000-0000-00000000000a') ||
                              '"}, {"name": "고추장불백", "menu_id": "' ||
                              (select id from public.menus where name = '고추장불백' and restaurant_id = '60000000-0000-0000-0000-00000000000a') || '"}]')::jsonb
                        from w where name = '가 활발식당'), '가: 홀 인기메뉴 순위 = 판매 수량 순 (돼지불백 16개 > 고추장불백 3개), 수량은 비공개');
select pg_temp.check((select activity -> 'top_menus' = '[]'::jsonb from w where name = '라 소량주문'), '판매기록이 부족하면 인기메뉴 순위 없음');
select pg_temp.check(not exists (select 1 from w where name = '자 멀리'), '반경 100m 밖 매장 제외');

create temp table wd as select row_number() over () as ord, * from public.search_restaurants(37.5045, 127.049, 'walk', 100, null, null, 100, false, 'distance');
select pg_temp.check((select array_agg(name order by ord) from wd)
                     = array['바 미연동', '마 주문없음', '사 갱신지연', '라 소량주문', '아 공개불허', '다 취소많음', '나 30분강자', '가 활발식당'],
                     '거리순으로 바꾸면 주문량과 무관하게 거리 ↑');
select pg_temp.check((select array_agg(name order by ord) from (select row_number() over () ord, * from
                        public.search_restaurants(37.5045, 127.049, 'walk', 100, '중식')) x) = array['다 취소많음'], '음식 종류 필터와 함께 동작');
select pg_temp.check((select count(*) from public.search_restaurants(37.5045, 127.049, 'walk', 300)) = 9, '300m에서는 자 멀리(250m)까지 포함');

-- ───── 배달·포장은 각각 독립 순위 ─────
select pg_temp.check((select array_agg(name order by ord) from (select row_number() over () ord, * from
                        public.search_restaurants(37.5045, 127.049, 'delivery', 100)) x where rank_group = 0 and ord <= 2) = array['마 주문없음', '가 활발식당'],
                     '배달 순위: 마(배달 20건) > 가(배달 6건) — 홀 주문은 배달 순위에 안 들어감');
select pg_temp.check((select activity -> 'providers' = '["baemin"]'::jsonb from public.search_restaurants(37.5045, 127.049, 'delivery', 100)
                       where name = '마 주문없음'), '배달 제공처 구분: 이름만 공개');
select pg_temp.check((select (activity -> 'windows' ->> '10m')::int from public.search_restaurants(37.5045, 127.049, 'takeout', 100)
                       where name = '가 활발식당') = 5, '포장: 배민 포장 5건 + POS 사본 3건(연결번호) → 5건 (중복 제거)');
select pg_temp.check((select activity -> 'top_menus' -> 0 ->> 'name' from public.search_restaurants(37.5045, 127.049, 'takeout', 100)
                       where name = '가 활발식당') = '간장불백', '포장 인기메뉴는 포장 주문만으로 (간장불백)');
select pg_temp.check((select activity -> 'top_menus' -> 0 ->> 'name' from public.search_restaurants(37.5045, 127.049, 'delivery', 100)
                       where name = '가 활발식당') = '고추장불백', '배달 인기메뉴는 배달 주문만으로 (고추장불백)');

select pg_temp.check((public.public_app_settings() ->> 'refresh_interval_seconds')::int = 60, '화면 새로고침 기본 60초');
do $$ begin
  perform * from public.restaurant_order_activity(array['60000000-0000-0000-0000-00000000000a'::uuid], 'HALL', 'internal');
  raise exception 'FAIL: anon이 내부 집계 함수 실행';
exception when insufficient_privilege then raise notice 'ok  anon: 정확한 건수를 주는 내부 집계 함수 실행 불가';
end $$;
reset role;

-- 포장: 같은 그룹 안에서는 포장 운영 확인 매장이 미확인보다 먼저 (바 미연동 5m를 미확인으로)
update public.restaurants set takeout = 'unknown' where name = '바 미연동';
set role anon;
select pg_temp.check((select (array_agg(name))[count(*)] from public.search_restaurants(37.5045, 127.049, 'takeout', 100)) = '바 미연동',
                     '포장: 포장 운영 미확인 매장은 가장 가까워도 같은 그룹의 확인 매장 뒤로');
select pg_temp.check((select array_agg(name) from public.search_restaurants(37.5045, 127.049, 'takeout', 100, null, null, 100, false, 'distance'))[1] = '바 미연동',
                     '거리순은 순수하게 거리 순서');
reset role;
update public.restaurants set takeout = 'yes' where name = '바 미연동';

-- ───── 테스트 데이터 분리 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
insert into public.order_connections (id, restaurant_id, provider, ingest_mode, status, store_consent, provider_permission, is_test)
values ('70000000-0000-0000-0000-00000000ff01', '60000000-0000-0000-0000-00000000000f', 'pos', 'webhook', 'active', true, true, true);
select public.ingest_orders('70000000-0000-0000-0000-00000000ff01', pg_temp.orders('T', 40, 1, 0.2, 'HALL')) is not null as ok \gset
select pg_temp.check((select array_agg(name order by ord) from (select row_number() over () ord, * from
                        public.search_restaurants(37.5045, 127.049, 'walk', 100, null, null, 100, true)) x where rank_group = 0)
                     = array['바 미연동'], '관리자 테스트 모드: 테스트 주문으로만 순위 (바 40건)');
select pg_temp.check((select activity ->> 'scope' = 'test' from public.search_restaurants(37.5045, 127.049, 'walk', 100, null, null, 100, true)
                       where name = '바 미연동'), '테스트 순위 결과에는 테스트 데이터 표시');
reset role;
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check((select activity is null from public.search_restaurants(37.5045, 127.049, 'walk', 100, null, null, 100, true)
                       where name = '바 미연동'), '일반 이용자는 테스트를 요청해도 실제 순위만 (바 = 주문정보 없음)');
reset role;

-- ───── 관리자 지역별 인기 음식점 ─────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
create temp table ap as select row_number() over () ord, * from public.admin_popular_restaurants('seolleung_yeoksam', 'HALL', false);
select pg_temp.check((select array_agg(name order by ord) from ap where freshness = 'fresh')
                     = array['아 공개불허', '가 활발식당', '나 30분강자', '다 취소많음', '라 소량주문', '마 주문없음'],
                     '관리자: 실제 전체(공개 불허 포함) 정확한 건수로 순위');
select pg_temp.check((select c10 = 30 and not public_rank_allowed from ap where name = '아 공개불허'), '관리자: 공개 불허 매장은 소비자 순위 미반영 표시');
select pg_temp.check((select c10 = 3 and public_rank_allowed from ap where name = '라 소량주문'), '관리자는 최소 공개 건수 미만도 정확히 봄');
select pg_temp.check((select freshness from ap where name = '바 미연동') = 'none' and (select freshness from ap where name = '사 갱신지연') = 'delayed',
                     '관리자: 주문정보 없음·갱신 지연 구분');
select pg_temp.check((select top_menus -> 0 ->> 'name' = '돼지불백' and (top_menus -> 0 ->> 'quantity')::int = 16 from ap where name = '가 활발식당'),
                     '관리자: 매장 인기메뉴와 판매 수량');
select pg_temp.check(not exists (select 1 from ap where name = '자 멀리'), '관리자: 지역별(판교 매장은 선릉·역삼 목록에 없음)');
select pg_temp.check((select c10 from public.admin_popular_restaurants('seolleung_yeoksam', 'HALL', true) where name = '바 미연동') = 40,
                     '관리자 테스트 보기: 테스트 주문으로 순위 검증');
select pg_temp.check((select name from public.admin_popular_restaurants('seolleung_yeoksam', 'DELIVERY', false) limit 1) = '마 주문없음',
                     '관리자 배달 인기순위 1위 = 마');

-- ───── 설정 ─────
update public.order_settings set rank_primary_minutes = 5, refresh_interval_seconds = 30;
select pg_temp.check((select (activity ->> 'primary_minutes')::int = 5 from public.search_restaurants(37.5045, 127.049, 'walk', 100)
                       where name = '가 활발식당'), '관리자가 바꾼 집계시간(1차 5분)이 순위에 반영');
do $$ begin
  update public.order_settings set rank_primary_minutes = 40, rank_secondary_minutes = 30;
  raise exception 'FAIL: 1차 창이 2차 창보다 길게 저장됨';
exception when check_violation then raise notice 'ok  1차 집계시간은 2차보다 짧아야 함';
end $$;
reset role;
\echo ALL_STAGE6_TESTS_PASSED
