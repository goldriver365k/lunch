-- 7단계 상권 분석 DB 시험 (로컬 PostgreSQL + PostGIS 전용, 시험 DB 안에서만 데이터 생성)
-- 분석 함수 결과를 원본 주문에서 따로 계산한 값(검증용 계산)과 비교한다.
\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

-- 한국시간 (오늘 - k일) hh:mm
create or replace function pg_temp.kst(k int, hhmm text) returns timestamptz language sql as $$
  select ((public.kst_day(now()) - k)::timestamp + hhmm::time) at time zone 'Asia/Seoul'
$$;

-- 매장 s, k일 전 점심 주문 n건 (+ 점심시간 밖 1건). 금액 6,000~15,000원, 메뉴 1줄
create or replace function pg_temp.day_orders(prefix text, s int, k int, n int) returns jsonb language sql as $$
  select jsonb_agg(o) from (
    select jsonb_build_object(
      'external_order_id', prefix || '-' || s || '-' || k || '-' || j,
      'channel', case when j = 3 then 'PICKUP' else 'HALL' end,
      'ordered_at', pg_temp.kst(k, (time '11:05' + make_interval(mins => j * 37))::text),
      'total_amount', 6000 + 1500 * ((s * (j + 1) + k) % 7),
      'order_status', 'completed', 'payment_status', 'paid',
      'items', jsonb_build_array(jsonb_build_object(
        'name', case when s = 5 and j = 0 then '오늘의특선' else (array['돼지불백', '김치찌개', '제육볶음'])[1 + (j + k) % 3] end,
        'quantity', 1 + (j + s) % 2,
        'unit_price', (6000 + 1500 * ((s * (j + 1) + k) % 7)) / (1 + (j + s) % 2),
        'line_amount', 6000 + 1500 * ((s * (j + 1) + k) % 7)))) o
      from generate_series(0, n - 1) j
    union all
    select jsonb_build_object('external_order_id', prefix || '-' || s || '-' || k || '-late', 'channel', 'HALL',
      'ordered_at', pg_temp.kst(k, '15:10'), 'total_amount', 9000, 'order_status', 'completed', 'payment_status', 'paid',
      'items', jsonb_build_array(jsonb_build_object('name', '돼지불백', 'quantity', 1, 'unit_price', 9000)))
  ) x
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000b001', 'biz@example.com'),
  ('00000000-0000-0000-0000-00000000c001', 'user@example.com');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000a001');

-- 선릉역(37.5045, 127.049) 북쪽 / 역삼역 / 판교역
insert into public.restaurants (id, name, category, lat, lng, coord_status, business_status, is_public, dine_in, takeout, delivery, region_id)
select ('71000000-0000-0000-0000-0000000000' || v.k)::uuid, v.name, v.cat, v.lat + v.d / 111320.0, v.lng, 'valid', v.bs::public.business_status,
       true, 'yes', 'yes', 'yes', v.region
  from (values
    ('01', '선릉 한식1', '한식', 37.5045, 127.049, 50, 'open', 'seolleung_yeoksam'),
    ('02', '선릉 한식2', '한식', 37.5045, 127.049, 100, 'open', 'seolleung_yeoksam'),
    ('03', '선릉 한식3', '한식', 37.5045, 127.049, 150, 'open', 'seolleung_yeoksam'),
    ('04', '선릉 중식', '중식', 37.5045, 127.049, 200, 'open', 'seolleung_yeoksam'),
    ('05', '선릉 일식', '일식', 37.5045, 127.049, 250, 'open', 'seolleung_yeoksam'),
    ('06', '선릉 분식(분석 미허용)', '분식', 37.5045, 127.049, 300, 'open', 'seolleung_yeoksam'),
    ('07', '선릉 멀리', '한식', 37.5045, 127.049, 650, 'open', 'seolleung_yeoksam'),
    ('08', '선릉 폐업', '한식', 37.5045, 127.049, 120, 'closed', 'seolleung_yeoksam'),
    ('11', '역삼 백반', '한식', 37.500786, 127.036886, 50, 'open', 'seolleung_yeoksam'),
    ('21', '판교 국수', '아시안', 37.394762, 127.111137, 50, 'open', 'pangyo')
  ) as v(k, name, cat, lat, lng, d, bs, region);
insert into public.menus (restaurant_id, name, is_signature, price_dine_in, price_delivery, price_takeout)
select r.id, m.name, m.sig, 9000, 10000, 8500
  from public.restaurants r cross join (values ('돼지불백', true), ('김치찌개', false), ('제육볶음', false)) m(name, sig);

insert into public.order_connections (id, restaurant_id, provider, ingest_mode, status, store_consent, provider_permission,
                                      public_allowed, analytics_allowed, amount_basis, is_test)
select ('72000000-0000-0000-0000-00000000' || v.k || v.p)::uuid, ('71000000-0000-0000-0000-0000000000' || v.k)::uuid,
       v.provider, 'webhook', 'active', true, true, false, v.analytics, v.basis, v.test
  from (values
    ('01', '01', 'pos', true, 'menu_sales', false), ('02', '01', 'pos', true, 'menu_sales', false),
    ('03', '01', 'pos', true, 'menu_sales', false), ('04', '01', 'pos', true, 'menu_sales', false),
    ('05', '01', 'pos', true, 'menu_sales', false), ('06', '01', 'pos', false, 'menu_sales', false),
    ('07', '01', 'pos', true, 'menu_sales', false),
    ('01', '02', 'baemin', true, 'paid_incl_delivery', false),
    ('02', '03', 'coupangeats', true, 'unknown', false),
    ('11', '01', 'pos', true, 'menu_sales', false),
    ('01', '09', 'pos', false, 'unknown', true)
  ) as v(k, p, provider, analytics, basis, test);

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);

-- 최근 7일(1~7일 전): 4일 전은 어느 매장도 자료 없음, 한식3은 2일 전 자료 없음 / 직전 7일(8~14일 전): 하루 2건
do $$
declare s int; k int; conn uuid;
begin
  foreach s in array array[1, 2, 3, 4, 5, 6, 7, 11] loop
    conn := ('72000000-0000-0000-0000-00000000' || lpad(s::text, 2, '0') || '01')::uuid;
    for k in 1..14 loop
      continue when k = 4 or (s = 3 and k = 2);
      perform public.ingest_orders(conn, pg_temp.day_orders('P', s, k, case when k <= 7 then 3 + (s + k) % 3 else 2 end));
    end loop;
  end loop;
end $$;
-- 제외되어야 하는 주문 (1일 전 한식1): 취소, 결제 실패, 전액 환불 / 부분 환불은 순결제금액으로 포함
select public.ingest_orders('72000000-0000-0000-0000-000000000101', jsonb_build_array(
  jsonb_build_object('external_order_id', 'XC', 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:00'), 'total_amount', 50000, 'order_status', 'cancelled'),
  jsonb_build_object('external_order_id', 'XF', 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:01'), 'total_amount', 50000, 'payment_status', 'failed'),
  jsonb_build_object('external_order_id', 'XR', 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:02'), 'total_amount', 50000,
                     'payment_status', 'refunded', 'refund_amount', 50000),
  jsonb_build_object('external_order_id', 'PR', 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:03'), 'total_amount', 10000,
                     'payment_status', 'partially_refunded', 'refund_amount', 2000,
                     'items', jsonb_build_array(jsonb_build_object('name', '돼지불백', 'quantity', 1, 'unit_price', 10000)))
)) is not null as ok \gset
-- 배민(배달비 포함 결제금액 15,000 = 메뉴 12,000 + 배달비 3,000): 1~7일 전 하루 2건
select public.ingest_orders('72000000-0000-0000-0000-000000000102', (
  select jsonb_agg(jsonb_build_object('external_order_id', 'BD-' || k || '-' || t, 'channel', 'DELIVERY',
           'ordered_at', pg_temp.kst(k, t), 'total_amount', 15000, 'delivery_fee', 3000, 'order_status', 'completed', 'payment_status', 'paid',
           'items', jsonb_build_array(jsonb_build_object('name', '제육볶음', 'quantity', 1, 'unit_price', 12000))))
    from generate_series(1, 7) k, unnest(array['11:30', '12:30']) t where k <> 4)) is not null as ok \gset
-- 같은 배달 주문이 POS에도 연결번호 없이 들어옴 → 중복 가능성(집계 제외)
select public.ingest_orders('72000000-0000-0000-0000-000000000101', jsonb_build_array(
  jsonb_build_object('external_order_id', 'POS-BD', 'channel', 'DELIVERY', 'ordered_at', pg_temp.kst(1, '11:31'), 'total_amount', 15000)
)) is not null as ok \gset
-- 쿠팡이츠(금액 기준 미확인): 건수에는 포함, 금액 분석에서는 제외
select public.ingest_orders('72000000-0000-0000-0000-000000000203', (
  select jsonb_agg(jsonb_build_object('external_order_id', 'CE-' || k, 'channel', 'DELIVERY', 'ordered_at', pg_temp.kst(k, '12:10'),
           'total_amount', 13000, 'order_status', 'completed', 'payment_status', 'paid'))
    from generate_series(1, 7) k where k <> 4)) is not null as ok \gset
-- 테스트 주문 (실제 통계에 들어가면 안 됨)
select public.ingest_orders('72000000-0000-0000-0000-000000000109', (
  select jsonb_agg(jsonb_build_object('external_order_id', 'T-' || g, 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:15'),
           'total_amount', 99000, 'order_status', 'completed', 'payment_status', 'paid'))
    from generate_series(1, 50) g)) is not null as ok \gset
reset role;

-- ───── 검증용 계산 (원본 주문에서 직접) ─────
create temp table exp as
select o.*, c.amount_basis, c.analytics_allowed, r.category,
       (o.ordered_at at time zone 'Asia/Seoul') as lt,
       case when o.channel = 'DELIVERY' then
              case c.amount_basis when 'menu_sales' then o.net_amount
                                  when 'paid_incl_delivery' then o.net_amount - o.delivery_fee end
            else o.net_amount end as amt
  from public.orders o join public.order_connections c on c.id = o.connection_id join public.restaurants r on r.id = o.restaurant_id
 where not o.is_test and not o.is_cancelled and o.payment_status not in ('failed', 'refunded')
   and o.dedup_status <> 'possible_duplicate' and o.merged_into is null
   and extensions.st_dwithin(r.geog, extensions.st_setsrid(extensions.st_makepoint(127.049, 37.5045), 4326)::extensions.geography, 500)
   and (o.ordered_at at time zone 'Asia/Seoul')::time >= '11:00' and (o.ordered_at at time zone 'Asia/Seoul')::time < '14:00';
create temp table exp7 as select * from exp where lt::date between public.kst_day(now()) - 7 and public.kst_day(now()) - 1;
create temp table expb as select * from exp7 where analytics_allowed;   -- 사업자 범위
grant select on exp, exp7, expb to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
create temp table rb as select public.market_analysis('seolleung', '7d', false, true) as j;   -- 관리자가 사업자 화면으로 보기
create temp table ri as select public.market_analysis('seolleung', '7d', false, false) as j;  -- 관리자 내부

select pg_temp.check((select count(*) from public.market_area_list() where id in ('seolleung', 'yeoksam', 'pangyo', 'yeouido')) = 4, '분석지역 4곳(선릉·역삼·판교·여의도) 선택 가능');
select pg_temp.check((select j ->> 'scope' from rb) = 'business' and (select j ->> 'scope' from ri) = 'internal', '사업자/내부 범위 구분');
select pg_temp.check((select j -> 'area' ->> 'label' from rb) = '기준점 반경 500m', '상권 범위 표시: 기준점 반경 500m');

-- 유효 주문·평균·중앙값
select pg_temp.check((select (j -> 'totals' ->> 'orders')::int from rb) = (select count(*) from expb),
                     format('유효 주문 건수 = 검증 계산 (%s건)', (select count(*) from expb)));
select pg_temp.check((select (j -> 'totals' ->> 'orders')::int from ri) = (select count(*) from exp7), '내부 범위는 분석 미허용 매장 포함');
select pg_temp.check((select (j -> 'totals' ->> 'amount_orders')::int from rb) = (select count(amt) from expb), '금액 분석 대상 건수');
select pg_temp.check((select (j -> 'totals' ->> 'amount_sum')::bigint from rb) = (select sum(amt) from expb), '분석 금액 합계');
select pg_temp.check((select (j -> 'totals' ->> 'avg')::int from rb) = (select round(avg(amt)) from expb),
                     format('평균 주문금액 = 검증 계산 (%s원)', (select round(avg(amt)) from expb)));
select pg_temp.check((select (j -> 'totals' ->> 'median')::int from rb)
                     = (select round(percentile_cont(0.5) within group (order by amt)::numeric) from expb where amt is not null), '주문금액 중앙값');
select pg_temp.check((select (j -> 'totals' ->> 'excluded_amount_orders')::int from rb) = 6, '금액 기준 미확인(쿠팡이츠) 6건은 금액 분석 제외');
select pg_temp.check(not exists (select 1 from expb where external_order_id in ('XC', 'XF', 'XR', 'POS-BD')), '검증 계산도 취소·실패·환불·중복 제외');
select pg_temp.check((select count(*) from expb where external_order_id = 'PR' and amt = 8000) = 1, '부분 환불은 순결제금액(8,000원)으로');

-- 채널 분리
select pg_temp.check((select (c ->> 'orders')::int from rb, jsonb_array_elements(j -> 'channels') c where c ->> 'channel' = 'HALL')
                     = (select count(*) from expb where channel = 'HALL'), '홀 유효 주문 따로');
select pg_temp.check((select (c ->> 'orders')::int from rb, jsonb_array_elements(j -> 'channels') c where c ->> 'channel' = 'PICKUP')
                     = (select count(*) from expb where channel = 'PICKUP'), '포장 유효 주문 따로');
select pg_temp.check((select (c ->> 'orders')::int = 18 and (c ->> 'avg')::int = 12000 and c -> 'providers' = '{"baemin": 12, "coupangeats": 6}'::jsonb
                        from rb, jsonb_array_elements(j -> 'channels') c where c ->> 'channel' = 'DELIVERY'),
                     '배달 18건(배민 12·쿠팡이츠 6), 배달 평균 12,000원 = 배달비 제외 메뉴 판매금액');
select pg_temp.check((select (c ->> 'avg')::int from rb, jsonb_array_elements(j -> 'channels') c where c ->> 'channel' = 'HALL')
                     = (select round(avg(amt)) from expb where channel = 'HALL'), '홀 평균 주문금액 따로 계산');
select pg_temp.check((select round(sum((c ->> 'share')::numeric), 2) from rb, jsonb_array_elements(j -> 'channels') c) = 1.00, '채널 비중 합 = 1');

-- 가격대
select pg_temp.check((select sum((b ->> 'orders')::int) from rb, jsonb_array_elements(j -> 'price_bands') b)
                     = (select (j -> 'totals' ->> 'amount_orders')::int from rb), '가격대별 건수 합 = 금액 분석 대상 건수');
select pg_temp.check((select round(sum((b ->> 'pct')::numeric), 2) from rb, jsonb_array_elements(j -> 'price_bands') b) = 1.00, '가격대 비율 합 = 100%');
select pg_temp.check((select array_agg((b ->> 'orders')::int order by o) from rb, jsonb_array_elements(j -> 'price_bands') with ordinality x(b, o))
                     = (select array[count(*) filter (where amt <= 7000), count(*) filter (where amt between 7001 and 9000),
                                     count(*) filter (where amt between 9001 and 12000), count(*) filter (where amt between 12001 and 15000),
                                     count(*) filter (where amt > 15000)]::int[] from expb where amt is not null),
                     '가격대 경계(7,000 / 9,000 / 12,000 / 15,000원 이하 포함) 검증 계산과 일치');
select pg_temp.check((select (j -> 'menu_unit_prices' ->> 'quantity')::int from rb)
                     = (select sum(i.quantity) from expb e join public.order_items i on i.order_id = e.id where i.unit_price is not null),
                     '메뉴 판매단가 분포는 주문금액과 따로 (메뉴 수량 기준)');
select pg_temp.check((select (b ->> 'quantity')::int from rb, jsonb_array_elements(j -> 'menu_unit_prices' -> 'bands') b where (b ->> 'hi')::int = 7000)
                     = (select sum(i.quantity) from expb e join public.order_items i on i.order_id = e.id where i.unit_price <= 7000),
                     '2인분 주문(예: 15,000원)은 메뉴 단가(7,500원)로 따로 분류');

-- 시간대
select pg_temp.check((select sum((s ->> 'orders')::int) from rb, jsonb_array_elements(j -> 'slots_half') s) = (select count(*) from expb),
                     '30분 구간 합 = 전체 (점심시간 밖 주문 제외)');
select pg_temp.check((select array_agg((h ->> 'orders')::int order by (h ->> 'from_slot')::int) from rb, jsonb_array_elements(j -> 'slots_hour') h)
                     = (select array[count(*) filter (where extract(hour from lt) = 11), count(*) filter (where extract(hour from lt) = 12),
                                     count(*) filter (where extract(hour from lt) = 13)]::int[] from expb),
                     '11·12·13시 주문 건수 검증 계산과 일치');

-- 요일 (미수집일은 0건이 아님)
select pg_temp.check((select (d ->> 'observed_days')::int = 0 and d ->> 'avg_orders' is null
                        from rb, jsonb_array_elements(j -> 'weekdays') d
                       where (d ->> 'dow')::int = extract(isodow from public.kst_day(now()) - 4)),
                     '자료가 없는 날(4일 전)은 0건으로 평균하지 않음 (평균 없음)');
select pg_temp.check((select (d ->> 'orders')::int = (select count(*) from expb where lt::date = public.kst_day(now()) - 1)
                         and (d ->> 'observed_days')::int = 1
                        from rb, jsonb_array_elements(j -> 'weekdays') d
                       where (d ->> 'dow')::int = extract(isodow from public.kst_day(now()) - 1)), '요일별 주문 건수');
select pg_temp.check((select sum((d ->> 'orders')::int) from rb, jsonb_array_elements(j -> 'weekdays') d) = (select count(*) from expb), '요일 합 = 전체');

-- 인기메뉴·음식 종류
select pg_temp.check((select j -> 'menus' -> 'items' -> 0 ->> 'name' from rb)
                     = (select m.name from expb e join public.order_items i on i.order_id = e.id join public.menus m on m.id = i.menu_id
                         group by m.name order by sum(i.quantity) desc, m.name limit 1), '지역 인기메뉴 1위 = 검증 계산');
select pg_temp.check((select (j -> 'menus' -> 'items' -> 0 ->> 'quantity')::int from rb)
                     = (select sum(i.quantity) from expb e join public.order_items i on i.order_id = e.id join public.menus m on m.id = i.menu_id
                         group by m.name order by sum(i.quantity) desc, m.name limit 1), '인기메뉴 판매 수량');
select pg_temp.check((select (j -> 'menus' ->> 'unclassified_quantity')::int from rb)
                     = (select sum(i.quantity) from expb e join public.order_items i on i.order_id = e.id where i.menu_id is null),
                     '내부 메뉴와 연결되지 않은 메뉴는 ‘분류 미확인’');
select pg_temp.check((select (c ->> 'orders')::int = (select count(*) from expb where category = '한식') and (c ->> 'stores')::int = 3
                        from rb, jsonb_array_elements(j -> 'categories') c where c ->> 'category' = '한식'), '음식 종류별 주문·제공 매장 수');
select pg_temp.check(not exists (select 1 from rb, jsonb_array_elements(j -> 'categories') c where c ->> 'category' = '분식'),
                     '분석 사용 미허용 매장(분식)은 사업자 화면에 없음');

-- 수집률·신뢰도
select pg_temp.check((select (j -> 'coverage' ->> 'registered')::int = 7 and (j -> 'coverage' ->> 'operating')::int = 6
                         and (j -> 'coverage' ->> 'providing_stores')::int = 5 and (j -> 'coverage' ->> 'data_days')::int = 6 from rb),
                     '수집률: 등록 7 · 영업 확인 6 · 제공 5 · 자료 있는 날 6/7 (반경 밖 매장 제외)');
select pg_temp.check((select (j -> 'coverage' ->> 'rate')::numeric = 0.833 from rb), '제공 비율 = 제공 매장 ÷ 영업 확인 매장');
select pg_temp.check((select j -> 'reliability' ->> 'status' from rb) = 'ok', '선릉: 내부 기준(5곳·100건) 충족');
select pg_temp.check((select j -> 'reliability' -> 'warnings' ->> 0 like '%한식 — 업종 편향 가능성' from rb), '업종 편중 경고');
select pg_temp.check((select j -> 'coverage' -> 'delayed_list' = 'null'::jsonb and j -> 'coverage' -> 'needs_review' = 'null'::jsonb from rb)
                     and (select jsonb_typeof(j -> 'coverage' -> 'delayed_list') = 'array' from ri), '관리자 전용 지표는 사업자 범위에서 빠짐');
select pg_temp.check((select j -> 'reliability' ->> 'status' from (select public.market_analysis('yeoksam', '7d', false, true) j) x) = 'insufficient',
                     '역삼(1곳): 표본 부족');
select pg_temp.check((select j -> 'reliability' ->> 'status' = 'none' and (j -> 'totals' ->> 'orders')::int = 0 and j -> 'totals' -> 'avg' = 'null'::jsonb
                        from (select public.market_analysis('yeouido', '7d', false, true) j) x), '여의도: 데이터 없음 → 가상 수치 없음');

-- 테스트 데이터 분리
select pg_temp.check((select (j -> 'totals' ->> 'orders')::int from (select public.market_analysis('seolleung', '7d', true) j) x) = 50
                     and (select j ->> 'scope' from (select public.market_analysis('seolleung', '7d', true) j) x) = 'test',
                     '테스트 범위는 테스트 주문만 (50건)');
select pg_temp.check((select count(*) from expb where amt = 99000) = 0 and (select (j -> 'totals' ->> 'amount_sum')::bigint from ri) < 99000 * 50,
                     '테스트 주문은 실제 통계에 없음');

-- 기간 비교·오늘 비교
select pg_temp.check((select (j -> 'totals' ->> 'orders_change_pct') is not null from rb), '직전 기간 대비 변화율 계산');
create temp table rt as select public.market_analysis('seolleung', 'today', false, true) as j;
select pg_temp.check((select (j -> 'today_vs_last_week' ->> 'last_week_orders')::int from rt)
                     = (select count(*) from exp where analytics_allowed and lt::date = public.kst_day(now()) - 7
                          and public.kst_slot(ordered_at) < (select (j -> 'period' ->> 'now_slot')::int from rt)),
                     '지난주 같은 요일은 오늘과 같은 시각까지만 비교');

-- 지역 비교: 같은 기간·같은 공간 단위
create temp table cmp as select public.market_compare(array['seolleung', 'yeoksam', 'pangyo', 'yeouido'], '7d', false, true) j;
select pg_temp.check((select (j ->> 'comparable')::boolean and jsonb_array_length(j -> 'areas') = 4 from cmp)
                     and (select count(distinct a -> 'period' ->> 'from') = 1 from cmp, jsonb_array_elements(j -> 'areas') a),
                     '4개 지역 같은 기간·같은 반경으로 비교');
reset role;
update public.market_areas set radius_m = 1000 where id = 'yeoksam';
set role authenticated;
select pg_temp.check(not (select (public.market_compare(array['seolleung', 'yeoksam'], '7d', false, true) ->> 'comparable')::boolean),
                     '반경이 다르면 직접 비교 불가 표시');
reset role;
update public.market_areas set radius_m = 500 where id = 'yeoksam';

-- 공공데이터: 판교에 서울시 자료 등록 불가
set role authenticated;
insert into public.market_public_data (area_id, source, dataset, metric, category, value, unit, period_label)
values ('seolleung', 'seoul_golmok', '서울시 상권분석서비스', '업종별 점포 수', '한식음식점', 120, '개', '2026년 2분기');
select pg_temp.check((select jsonb_array_length(public.market_analysis('seolleung', '7d', false, true) -> 'public_data')) = 1,
                     '공공데이터는 자체 주문 자료와 따로 표시');
do $$ begin
  insert into public.market_public_data (area_id, source, dataset, metric, period_label) values ('pangyo', 'seoul_golmok', 'x', 'y', '2026년 2분기');
  raise exception 'FAIL: 판교에 서울시 자료 등록됨';
exception when check_violation then raise notice 'ok  판교에는 서울시 상권분석서비스 자료를 등록할 수 없음';
end $$;
do $$ begin
  insert into public.market_public_data (area_id, source, dataset, metric, period_label) values ('yeouido', 'seoul_realtime', 'x', 'y', '실시간');
  raise exception 'FAIL: 확인 안 된 장소에 실시간 상권 자료 등록됨';
exception when check_violation then raise notice 'ok  공식 장소로 확인되지 않은 지역에는 서울시 실시간 상권 자료 불가';
end $$;

-- 변경 반영: 금액 기준을 확인하면 다시 집계 / 취소되면 빠짐
reset role;
update public.order_connections set amount_basis = 'menu_sales' where id = '72000000-0000-0000-0000-000000000203';
set role authenticated;
select pg_temp.check((select (public.market_analysis('seolleung', '7d', false, true) -> 'totals' ->> 'excluded_amount_orders')::int) = 0,
                     '연결의 금액 기준을 바꾸면 해당 날짜만 다시 집계');
select public.ingest_orders('72000000-0000-0000-0000-000000000101', jsonb_build_array(
  jsonb_build_object('external_order_id', 'PR', 'channel', 'HALL', 'ordered_at', pg_temp.kst(1, '12:03'), 'total_amount', 10000, 'order_status', 'cancelled')
)) is not null as ok \gset
select pg_temp.check((select (public.market_analysis('seolleung', '7d', false, true) -> 'totals' ->> 'orders')::int)
                     = (select count(*) from expb) - 1, '나중에 취소된 주문은 다시 집계에서 빠짐');

-- ───── 사업자 권한 ─────
reset role;
insert into public.business_users (user_id, org_name) values ('00000000-0000-0000-0000-00000000b001', '시험 창업컨설팅');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated"}', false);
select pg_temp.check(public.market_viewer_role() = 'business', '사업자 역할은 서버에서 확인');
select pg_temp.check((select j ->> 'scope' from (select public.market_analysis('seolleung', '7d') j) x) = 'business', '사업자는 항상 사업자 범위');
select pg_temp.check((select count(*) from public.orders) = 0 and (select count(*) from public.order_items) = 0
                     and (select count(*) from public.order_connections) = 0, '사업자는 원본 주문·연결 정보를 읽을 수 없음 (RLS)');
do $$ begin
  perform count(*) from public.market_order_stats;
  raise exception 'FAIL: 사업자가 매장별 집계표를 읽음';
exception when insufficient_privilege then raise notice 'ok  사업자는 매장별 사전 집계표에 접근 불가';
end $$;
do $$ begin
  perform public.market_analysis('seolleung', '7d', true);
  raise exception 'FAIL: 사업자가 테스트 데이터 조회';
exception when insufficient_privilege then raise notice 'ok  사업자는 테스트 데이터를 볼 수 없음';
end $$;
do $$ begin
  insert into public.market_settings (id) values (true);
  raise exception 'FAIL: 사업자가 설정 변경';
exception when insufficient_privilege or unique_violation then raise notice 'ok  사업자는 분석 설정을 바꿀 수 없음';
end $$;
select pg_temp.check((select count(*) from public.market_settings) = 0, '사업자에게 설정 표는 보이지 않음');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', false);
do $$ begin
  perform public.market_analysis('seolleung', '7d');
  raise exception 'FAIL: 일반 회원이 상권 분석 조회';
exception when insufficient_privilege then raise notice 'ok  일반 회원은 상권 분석 불가';
end $$;
reset role;
set role anon;
do $$ begin
  perform public.market_analysis('seolleung', '7d');
  raise exception 'FAIL: 비로그인 상권 분석 조회';
exception when insufficient_privilege then raise notice 'ok  비로그인은 상권 분석 함수 실행 불가';
end $$;
reset role;

-- 설정: 점심 분석시간·가격 구간
update public.market_settings set lunch_start_min = 690, lunch_end_min = 810, price_bands = '{8000,10000}';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', false);
select pg_temp.check((select jsonb_array_length(j -> 'price_bands') = 3 and jsonb_array_length(j -> 'slots_half') = 4
                        from (select public.market_analysis('seolleung', '7d') j) x), '관리자 설정(11:30~13:30, 가격 구간 3개) 반영');
reset role;
do $$ begin
  update public.market_settings set price_bands = '{9000,8000}';
  raise exception 'FAIL: 가격 구간 순서 오류 저장';
exception when check_violation then raise notice 'ok  가격 구간은 오름차순만';
end $$;
\echo ALL_STAGE7_TESTS_PASSED
