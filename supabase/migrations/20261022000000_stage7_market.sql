-- 7단계: 사업자용 점심 상권 분석
-- 원본 주문(orders·order_items)은 그대로 두고, 상권 분석용 사전 집계표와 분석 함수만 더한다.
-- 사업자는 집계 결과만 받는다 (원본 주문·매장별 정보에 접근할 수 없음).

-- ───────── 주문 금액 기준 ─────────
-- 배달앱마다 주문총액에 배달비가 들어가기도 한다. 상권 분석 금액은 '메뉴 판매금액 기준 순결제금액'
-- (할인·환불 반영, 배달비 제외)으로 통일하고, 그렇게 맞출 수 없는 주문은 금액 분석에서 뺀다(건수에는 포함).
alter table public.orders
  add column if not exists delivery_fee integer check (delivery_fee >= 0);   -- 제공처가 알려준 배달비

alter table public.order_connections
  -- 이 연결의 주문총액이 무엇인지: menu_sales = 메뉴 판매금액(배달비 제외), paid_incl_delivery = 배달비 포함 결제금액
  add column if not exists amount_basis text not null default 'unknown'
    check (amount_basis in ('menu_sales', 'paid_incl_delivery', 'unknown')),
  -- 사업자 상권 분석(지역 집계)에 쓰는 것을 매장·제공업체가 허락했는지. 소비자 공개(public_allowed)와 별개
  add column if not exists analytics_allowed boolean not null default false;

-- ───────── 분석 분류 ─────────
alter table public.restaurants
  add column if not exists market_category text
    check (market_category in ('한식', '중식', '일식', '양식', '면류', '분식', '패스트푸드', '기타'));
alter table public.menus
  add column if not exists menu_group text check (length(btrim(menu_group)) between 1 and 40);  -- 관리자가 확인한 공통 메뉴 분류

create or replace function public.market_category(p_category text, p_override text)
returns text language sql immutable as $$
  select coalesce(p_override, case p_category
    when '한식' then '한식' when '중식' then '중식' when '일식' then '일식' when '양식' then '양식'
    when '분식' then '분식' when '패스트푸드' then '패스트푸드' else '기타' end)
$$;

-- ───────── 한국시간 날짜·30분 구간 ─────────
create or replace function public.kst_day(ts timestamptz)
returns date language sql immutable as $$ select (ts at time zone 'Asia/Seoul')::date $$;
create or replace function public.kst_slot(ts timestamptz)  -- 0 = 00:00~00:30 … 47 = 23:30~24:00
returns smallint language sql immutable as $$
  select (extract(hour from ts at time zone 'Asia/Seoul') * 2 + floor(extract(minute from ts at time zone 'Asia/Seoul') / 30))::smallint
$$;

-- 분석 금액 (메뉴 판매금액 기준 순결제금액). 비교할 수 없으면 null
create or replace function public.market_amount(p_channel text, p_basis text, p_net integer, p_fee integer)
returns integer language sql immutable as $$
  select case
    when p_basis = 'menu_sales' then p_net
    when p_channel in ('HALL', 'PICKUP') then p_net                         -- 홀·포장에는 배달비가 없다
    when p_channel = 'DELIVERY' and p_basis = 'paid_incl_delivery' and p_fee is not null then greatest(p_net - p_fee, 0)
    else null
  end
$$;

-- ───────── 분석지역(상권) ─────────
create or replace function public.is_ascending_positive(a integer[])
returns boolean language sql immutable as $$
  select cardinality(a) between 1 and 9
     and not exists (select 1 from unnest(a) with ordinality x(v, i) where v <= 0 or (i > 1 and v <= a[i - 1]))
$$;

create table if not exists public.market_areas (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  sido text not null check (length(btrim(sido)) > 0),            -- 시·도: 공공데이터 적용 범위 판단 (서울시 자료는 서울만)
  center_lat double precision not null check (center_lat between 33 and 38.7),
  center_lng double precision not null check (center_lng between 124.5 and 132),
  spatial_mode text not null default 'radius' check (spatial_mode in ('radius', 'boundary')),
  radius_m integer not null default 500 check (radius_m between 100 and 3000),
  boundary_geojson jsonb check (boundary_geojson is null or boundary_geojson ->> 'type' in ('Polygon', 'MultiPolygon')),
  boundary extensions.geography generated always as (
    case when boundary_geojson is null then null
         else extensions.st_setsrid(extensions.st_geomfromgeojson(boundary_geojson::text), 4326)::extensions.geography end
  ) stored,
  boundary_source text,                                           -- 경계 확인 출처 (예: 서울시 상권분석서비스 상권 코드)
  is_active boolean not null default true,
  business_visible boolean not null default true,                 -- 사업자 화면에 공개
  sort_order integer not null default 100,
  seoul_realtime_place text,                                      -- 서울시 실시간 상권현황 공식 장소명 (확인된 경우만)
  seoul_realtime_verified boolean not null default false,         -- 공식 제공 장소 목록에서 확인했는지
  note text,
  updated_at timestamptz not null default now(),
  constraint boundary_mode_needs_boundary check (spatial_mode <> 'boundary' or boundary_geojson is not null),
  constraint realtime_needs_place check (not seoul_realtime_verified or seoul_realtime_place is not null)
);

insert into public.market_areas (id, name, sido, center_lat, center_lng, sort_order) values
  ('seolleung', '선릉역 주변', '서울특별시', 37.5045, 127.049, 1),
  ('yeoksam', '역삼역 주변', '서울특별시', 37.500786, 127.036886, 2),
  ('pangyo', '판교역 주변', '경기도', 37.394762, 127.111137, 3),
  ('yeouido', '여의도역 주변', '서울특별시', 37.521667, 126.924167, 4)
on conflict (id) do nothing;

-- ───────── 분석 설정 ─────────
create table if not exists public.market_settings (
  id boolean primary key default true check (id),
  lunch_start_min integer not null default 660 check (lunch_start_min % 30 = 0 and lunch_start_min between 0 and 1410),
  lunch_end_min integer not null default 840 check (lunch_end_min % 30 = 0 and lunch_end_min between 30 and 1440),
  price_bands integer[] not null default '{7000,9000,12000,15000}' check (public.is_ascending_positive(price_bands)),
  min_stores integer not null default 5 check (min_stores >= 1),       -- 내부 품질 점검 기준 (통계적 대표성 기준 아님)
  min_orders integer not null default 100 check (min_orders >= 1),
  updated_at timestamptz not null default now(),
  constraint lunch_order check (lunch_end_min > lunch_start_min)
);
insert into public.market_settings (id) values (true) on conflict (id) do nothing;

-- ───────── 사업자 계정 (향후 유료 서비스 대비, 이번 단계는 결제 없음) ─────────
create table if not exists public.business_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_name text not null check (length(btrim(org_name)) between 1 and 60),
  plan text not null default 'pilot' check (plan in ('pilot', 'free', 'paid')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_business()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.business_users where user_id = auth.uid() and is_active);
$$;

create or replace function public.market_viewer_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_admin() then 'admin' when public.is_business() then 'business' end;
$$;

-- ───────── 공공 상권 자료 (자체 주문 자료와 분리) ─────────
create table if not exists public.market_public_data (
  id uuid primary key default gen_random_uuid(),
  area_id text not null references public.market_areas (id) on delete cascade,
  source text not null check (source in ('seoul_golmok', 'seoul_realtime', 'gyeonggi', 'seongnam', 'other_public')),
  dataset text not null check (length(btrim(dataset)) > 0),        -- 자료명
  metric text not null check (length(btrim(metric)) > 0),          -- 항목 (예: 업종별 점포 수, 추정매출)
  category text,                                                   -- 업종 등
  value numeric,
  unit text,
  period_label text not null check (length(btrim(period_label)) > 0),  -- 기준 시점 (예: 2026년 2분기)
  base_date date,
  source_updated_at date,                                          -- 원 자료 최종 갱신일
  source_url text check (source_url is null or source_url ~ '^https://'),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists market_public_data_area_idx on public.market_public_data (area_id);

-- 서울시 자료는 서울 지역에만, 실시간 상권현황은 공식 장소로 확인된 지역에만, 경기 자료는 경기 지역에만
create or replace function public.market_public_data_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare a public.market_areas;
begin
  select * into a from public.market_areas where id = new.area_id;
  if new.source in ('seoul_golmok', 'seoul_realtime') and a.sido <> '서울특별시' then
    raise exception '서울시 자료는 서울 지역에만 등록할 수 있어요 (%: %)', a.name, a.sido using errcode = '23514';
  end if;
  if new.source = 'seoul_realtime' and not a.seoul_realtime_verified then
    raise exception '서울시 실시간 상권현황 공식 제공 장소로 확인되지 않은 지역이에요 (%)', a.name using errcode = '23514';
  end if;
  if new.source in ('gyeonggi', 'seongnam') and a.sido <> '경기도' then
    raise exception '경기도·성남시 자료는 경기 지역에만 등록할 수 있어요 (%)', a.name using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists market_public_data_guard on public.market_public_data;
create trigger market_public_data_guard before insert or update on public.market_public_data
  for each row execute function public.market_public_data_guard();

-- ───────── 사전 집계 ─────────
-- 연결(제공처)·날짜·30분 구간·채널별 유효 주문 집계. amounts = 금액 기준이 확인된 주문의 분석 금액(정렬, 중앙값·가격대용)
create table if not exists public.market_order_stats (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  connection_id uuid not null references public.order_connections (id) on delete cascade,
  is_test boolean not null,
  day date not null,
  slot smallint not null check (slot between 0 and 47),
  channel text not null,
  order_count integer not null,
  amount_count integer not null,
  amount_sum bigint not null,
  amounts integer[] not null,
  refreshed_at timestamptz not null default now(),
  primary key (connection_id, day, slot, channel)
);
create index if not exists market_order_stats_day_idx on public.market_order_stats (day, restaurant_id);

-- 메뉴별 판매 수량 (내부 메뉴 연결된 것은 menu_id, 아니면 원래 메뉴명). 단가별로 나눠 판매단가 분포를 구한다
create table if not exists public.market_menu_stats (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  connection_id uuid not null references public.order_connections (id) on delete cascade,
  is_test boolean not null,
  day date not null,
  slot smallint not null,
  channel text not null,
  menu_id uuid references public.menus (id) on delete set null,
  item_name text,                    -- 내부 메뉴와 연결되지 않은 경우의 메뉴명 (관리자만 봄)
  unit_price integer,
  quantity integer not null,
  line_amount_sum bigint not null
);
create index if not exists market_menu_stats_day_idx on public.market_menu_stats (day, restaurant_id);

-- 주문 자료를 받은 날 (주문 0건인 날과 자료가 없는 날을 구분한다)
create table if not exists public.market_collection_days (
  connection_id uuid not null references public.order_connections (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  is_test boolean not null,
  day date not null,
  primary key (connection_id, day)
);
create index if not exists market_collection_days_day_idx on public.market_collection_days (day);

-- 다시 계산할 (매장, 날짜)
create table if not exists public.market_dirty (
  restaurant_id uuid not null,
  day date not null,
  primary key (restaurant_id, day)
);

alter table public.market_areas enable row level security;
alter table public.market_settings enable row level security;
alter table public.business_users enable row level security;
alter table public.market_public_data enable row level security;
alter table public.market_order_stats enable row level security;
alter table public.market_menu_stats enable row level security;
alter table public.market_collection_days enable row level security;
alter table public.market_dirty enable row level security;

-- 관리자 전용 테이블 (사업자는 아래 분석 함수로 집계만 받는다)
do $$
declare t text;
begin
  foreach t in array array['market_areas', 'market_settings', 'business_users', 'market_public_data'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['market_order_stats', 'market_menu_stats', 'market_collection_days', 'market_dirty'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ───────── 변경 감지 → 해당 날짜만 다시 계산 ─────────
create or replace function public.market_mark_order()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    insert into public.market_dirty values (old.restaurant_id, public.kst_day(old.ordered_at)) on conflict do nothing;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.market_dirty values (new.restaurant_id, public.kst_day(new.ordered_at)) on conflict do nothing;
    insert into public.market_collection_days (connection_id, restaurant_id, is_test, day)
    values (new.connection_id, new.restaurant_id, new.is_test, public.kst_day(new.ordered_at)) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists orders_market_mark on public.orders;
create trigger orders_market_mark after insert or update or delete on public.orders
  for each row execute function public.market_mark_order();

create or replace function public.market_mark_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order uuid;
begin
  v_order := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  insert into public.market_dirty
  select o.restaurant_id, public.kst_day(o.ordered_at) from public.orders o where o.id = v_order
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists order_items_market_mark on public.order_items;
create trigger order_items_market_mark after insert or update or delete on public.order_items
  for each row execute function public.market_mark_item();

create or replace function public.market_mark_connection()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 주문 0건이어도 정상 수집했으면 그날은 '자료 있음'
  if new.last_success_at is not null and new.last_success_at is distinct from old.last_success_at then
    insert into public.market_collection_days (connection_id, restaurant_id, is_test, day)
    values (new.id, new.restaurant_id, new.is_test, public.kst_day(new.last_success_at)) on conflict do nothing;
  end if;
  if new.amount_basis is distinct from old.amount_basis then
    insert into public.market_dirty
    select distinct o.restaurant_id, public.kst_day(o.ordered_at) from public.orders o where o.connection_id = new.id
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists order_connections_market_mark on public.order_connections;
create trigger order_connections_market_mark after update on public.order_connections
  for each row execute function public.market_mark_connection();

-- 표시된 날짜만 다시 집계. 유효 주문 = 5·6단계 규칙(is_valid) + 전액 환불 제외
create or replace function public.refresh_market_stats()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r_ids uuid[];
  d_days date[];
  n integer;
begin
  with d as (delete from public.market_dirty returning restaurant_id, day)
  select array_agg(restaurant_id), array_agg(day) into r_ids, d_days from d;
  if r_ids is null then return 0; end if;

  delete from public.market_order_stats s using unnest(r_ids, d_days) k(rid, day)
   where s.restaurant_id = k.rid and s.day = k.day;
  delete from public.market_menu_stats s using unnest(r_ids, d_days) k(rid, day)
   where s.restaurant_id = k.rid and s.day = k.day;

  create temp table if not exists _mk_valid (id uuid, restaurant_id uuid, connection_id uuid, is_test boolean,
                                            day date, slot smallint, channel text, amt integer) on commit drop;
  truncate _mk_valid;
  insert into _mk_valid
  select o.id, o.restaurant_id, o.connection_id, o.is_test, public.kst_day(o.ordered_at), public.kst_slot(o.ordered_at), o.channel,
         public.market_amount(o.channel, c.amount_basis, o.net_amount, o.delivery_fee)
    from unnest(r_ids, d_days) k(rid, day)
    join public.orders o
      on o.restaurant_id = k.rid
     and o.ordered_at >= (k.day::timestamp at time zone 'Asia/Seoul')
     and o.ordered_at < ((k.day + 1)::timestamp at time zone 'Asia/Seoul')
    join public.order_connections c on c.id = o.connection_id
   where o.is_valid
     and o.payment_status <> 'refunded'
     and not (o.refund_amount > 0 and o.net_amount = 0);

  insert into public.market_order_stats (restaurant_id, connection_id, is_test, day, slot, channel,
                                         order_count, amount_count, amount_sum, amounts)
  select v.restaurant_id, v.connection_id, v.is_test, v.day, v.slot, v.channel,
         count(*), count(v.amt), coalesce(sum(v.amt), 0),
         coalesce(array_agg(v.amt order by v.amt) filter (where v.amt is not null), '{}')
    from _mk_valid v
   group by 1, 2, 3, 4, 5, 6;
  get diagnostics n = row_count;

  insert into public.market_menu_stats (restaurant_id, connection_id, is_test, day, slot, channel, menu_id, item_name,
                                        unit_price, quantity, line_amount_sum)
  select v.restaurant_id, v.connection_id, v.is_test, v.day, v.slot, v.channel, i.menu_id,
         case when i.menu_id is null then btrim(i.external_menu_name) end,
         coalesce(i.unit_price, i.line_amount / i.quantity),
         sum(i.quantity), coalesce(sum(i.line_amount), 0)
    from _mk_valid v
    join public.order_items i on i.order_id = v.id
   where i.match_status <> 'ignored'
   group by 1, 2, 3, 4, 5, 6, 7, 8, 9;
  return n;
end $$;

-- 기간 전체 다시 계산 (집계 규칙·금액 기준을 바꿨을 때)
create or replace function public.admin_rebuild_market_stats(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'invalid range'; end if;
  insert into public.market_dirty
  select distinct o.restaurant_id, public.kst_day(o.ordered_at) from public.orders o
   where o.ordered_at >= (p_from::timestamp at time zone 'Asia/Seoul') and o.ordered_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  on conflict do nothing;
  -- 주문이 모두 지워진 날도 비우도록 기존 집계 날짜도 포함
  insert into public.market_dirty
  select distinct s.restaurant_id, s.day from public.market_order_stats s where s.day between p_from and p_to
  on conflict do nothing;
  return public.refresh_market_stats();
end $$;

-- ───────── 상권 분석 ─────────
-- p_period: today(오늘, 진행 중) / 7d·30d·90d(어제까지 완료된 날)
-- 범위: test = 테스트 주문(관리자만) / internal = 실제 전체(관리자) / business = 실제 + 매장·제공업체가 분석 사용을 허락한 연결만
create or replace function public.market_analysis(p_area_id text, p_period text default '7d', p_test boolean default false,
                                                  p_as_business boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin boolean := public.is_admin();
  v_scope text;
  a public.market_areas;
  st public.market_settings;
  stale integer := (select stale_after_minutes from public.order_settings);
  v_today date := public.kst_day(now());
  v_now_min integer := (extract(hour from now() at time zone 'Asia/Seoul') * 60 + extract(minute from now() at time zone 'Asia/Seoul'))::integer;
  v_cut smallint;      -- 오늘 비교: 이 구간 전까지 (완료된 30분 구간)
  v_cmp smallint;      -- 기간 비교에 쓰는 구간 상한
  v_from date; v_to date; v_pfrom date; v_pto date;
  sf smallint; sl smallint;
  n_days integer;
  v_compare_label text;
  -- 결과 조각
  j_cov jsonb; j_tot jsonb; j_ch jsonb; j_bands jsonb; j_unit jsonb; j_cat jsonb; j_menu jsonb; j_hour jsonb; j_half jsonb;
  j_dow jsonb; j_today jsonb; j_pub jsonb; j_rel jsonb; j_area jsonb;
  c_orders bigint; c_amt_orders bigint; c_stores integer; c_store_days integer; p_store_days integer; p_orders bigint;
  warnings text[] := '{}'; reasons text[] := '{}'; v_status text;
  top_cat_share numeric; top_cat text;
begin
  if p_test and not v_admin then raise exception 'admin only' using errcode = '42501'; end if;
  if not v_admin and not public.is_business() then raise exception 'business or admin only' using errcode = '42501'; end if;
  v_scope := case when p_test then 'test' when v_admin and not p_as_business then 'internal' else 'business' end;
  select * into a from public.market_areas where id = p_area_id and is_active;
  if not found then raise exception 'area not found' using errcode = 'P0002'; end if;
  if not v_admin and not a.business_visible then raise exception 'area not open' using errcode = '42501'; end if;
  select * into st from public.market_settings;
  sf := (st.lunch_start_min / 30)::smallint;
  sl := (st.lunch_end_min / 30)::smallint;
  v_cut := (v_now_min / 30)::smallint;

  if p_period = 'today' then
    v_from := v_today; v_to := v_today; v_pfrom := v_today - 7; v_pto := v_today - 7;
    v_cmp := v_cut;
    v_compare_label := format('지난주 같은 요일 %s까지 대비', lpad((v_cut / 2)::text, 2, '0') || ':' || case when v_cut % 2 = 0 then '00' else '30' end);
  elsif p_period in ('7d', '30d', '90d') then
    n_days := case p_period when '7d' then 7 when '30d' then 30 else 90 end;
    v_from := v_today - n_days; v_to := v_today - 1; v_pfrom := v_today - 2 * n_days; v_pto := v_today - n_days - 1;
    v_cmp := 48;
    v_compare_label := case p_period when '7d' then '전주(직전 7일) 대비' when '30d' then '직전 30일 대비' else '직전 3개월 대비' end;
  else
    raise exception 'invalid period' using errcode = '22023';
  end if;

  perform public.refresh_market_stats();

  drop table if exists _mk_r, _mk_c, _mk_f, _mk_m, _mk_cd;
  -- 상권 안 음식점 (반경 또는 확인된 경계)
  create temp table _mk_r on commit drop as
  select r.id, r.name, public.market_category(r.category, r.market_category) as cat, r.business_status
    from public.restaurants r
   where case when a.spatial_mode = 'boundary' then st_covers(a.boundary, r.geog)
              else st_dwithin(r.geog, st_setsrid(st_makepoint(a.center_lng, a.center_lat), 4326)::geography, a.radius_m) end;
  -- 범위에 맞는 연결
  create temp table _mk_c on commit drop as
  select c.id, c.restaurant_id, c.provider, c.status, c.ingest_mode, c.last_success_at, c.last_error, c.freshness_minutes,
         c.store_consent, c.provider_permission
    from public.order_connections c join _mk_r r on r.id = c.restaurant_id
   where c.is_test = (v_scope = 'test')
     and (v_scope <> 'business' or (c.analytics_allowed and c.store_consent and c.provider_permission));
  create temp table _mk_f on commit drop as
  select s.restaurant_id, s.connection_id, c.provider, s.day, s.slot, s.channel, s.order_count, s.amount_count, s.amount_sum,
         s.amounts, s.refreshed_at, r.cat
    from public.market_order_stats s join _mk_c c on c.id = s.connection_id join _mk_r r on r.id = s.restaurant_id
   where s.day between least(v_pfrom, v_today - 7) and v_today and s.slot >= sf and s.slot < sl;
  create temp table _mk_m on commit drop as
  select s.restaurant_id, s.day, s.slot, s.channel, s.quantity, s.line_amount_sum, s.unit_price,
         case when s.menu_id is null then null else coalesce(m.menu_group, regexp_replace(btrim(m.name), '\s+', ' ', 'g')) end as mkey,
         (m.menu_group is not null) as grouped
    from public.market_menu_stats s join _mk_c c on c.id = s.connection_id
    left join public.menus m on m.id = s.menu_id
   where s.day between least(v_pfrom, v_today - 7) and v_today and s.slot >= sf and s.slot < sl;
  create temp table _mk_cd on commit drop as
  select d.restaurant_id, d.day from public.market_collection_days d join _mk_c c on c.id = d.connection_id
   where d.day between least(v_pfrom, v_today - 7) and v_today
   group by 1, 2;

  select coalesce(sum(order_count), 0), coalesce(sum(amount_count), 0) into c_orders, c_amt_orders
    from _mk_f where day between v_from and v_to;
  select count(distinct restaurant_id), count(*) into c_stores, c_store_days from _mk_cd where day between v_from and v_to;
  select count(*) into p_store_days from _mk_cd where day between v_pfrom and v_pto;
  select coalesce(sum(order_count), 0) into p_orders from _mk_f where day between v_pfrom and v_pto and slot < v_cmp;

  -- 상권
  j_area := jsonb_build_object(
    'id', a.id, 'name', a.name, 'sido', a.sido, 'spatial_mode', a.spatial_mode, 'radius_m', a.radius_m,
    'boundary_source', a.boundary_source,
    'area_km2', case when a.spatial_mode = 'boundary' then round((st_area(a.boundary) / 1e6)::numeric, 3)
                     else round((pi() * a.radius_m ^ 2 / 1e6)::numeric, 3) end,
    'label', case when a.spatial_mode = 'boundary' then '확인된 상권 경계' || coalesce(' (' || a.boundary_source || ')', '')
                  else format('기준점 반경 %sm', a.radius_m) end);

  -- 수집률
  select jsonb_build_object(
    'registered', (select count(*) from _mk_r),
    'operating', (select count(*) from _mk_r where business_status = 'open'),
    'consented', (select count(distinct restaurant_id) from _mk_c where store_consent and provider_permission),
    'collecting_recent', (select count(distinct restaurant_id) from _mk_c where status = 'active' and last_success_at >= now() - interval '1 day'),
    'providing_stores', c_stores,
    'store_days', c_store_days,
    'data_days', (select count(distinct day) from _mk_cd where day between v_from and v_to),
    'period_days', v_to - v_from + 1,
    'last_collected_at', (select max(last_success_at) from _mk_c),
    'delayed_stores', (select count(distinct restaurant_id) from _mk_c x
                        where (x.status = 'error')
                           or (x.status = 'active' and x.ingest_mode <> 'webhook'
                               and (x.last_success_at is null or x.last_success_at < now() - make_interval(mins => coalesce(x.freshness_minutes, stale))))),
    'rate', round(c_stores::numeric / nullif((select count(*) from _mk_r where business_status = 'open'), 0), 3),
    'rate_label', '영업 중으로 확인된 음식점 중 분석 기간에 주문 자료를 제공한 매장 비율',
    'delayed_list', case when v_scope = 'business' then null else (
        select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'provider', x.provider, 'status', x.status,
                                                     'last_success_at', x.last_success_at, 'last_error', x.last_error)
                                  order by r.name), '[]'::jsonb)
          from _mk_c x join _mk_r r on r.id = x.restaurant_id
         where x.status = 'error'
            or (x.status = 'active' and x.ingest_mode <> 'webhook'
                and (x.last_success_at is null or x.last_success_at < now() - make_interval(mins => coalesce(x.freshness_minutes, stale))))) end,
    'unmatched_items', case when v_scope = 'business' then null else (
        select count(*) from public.order_items i join public.orders o on o.id = i.order_id join _mk_c x on x.id = o.connection_id
         where i.match_status = 'unmatched' and o.ordered_at >= (v_from::timestamp at time zone 'Asia/Seoul')) end,
    'needs_review', case when v_scope = 'business' then null else (
        select count(*) from public.orders o join _mk_c x on x.id = o.connection_id
         where o.dedup_status = 'possible_duplicate' and o.ordered_at >= (v_from::timestamp at time zone 'Asia/Seoul')) end
  ) into j_cov;

  -- 전체 금액
  select jsonb_build_object(
    'orders', c_orders,
    'amount_orders', c_amt_orders,
    'amount_sum', coalesce(sum(f.amount_sum), 0),
    'avg', round(sum(f.amount_sum)::numeric / nullif(c_amt_orders, 0)),
    'median', (select round(percentile_cont(0.5) within group (order by x)::numeric)
                 from _mk_f f2, unnest(f2.amounts) x where f2.day between v_from and v_to),
    'excluded_amount_orders', c_orders - c_amt_orders,
    'unknown_channel_orders', coalesce(sum(f.order_count) filter (where f.channel = 'UNKNOWN'), 0),
    'orders_per_store_day', round(c_orders::numeric / nullif(c_store_days, 0), 2),
    'orders_change_pct', (
      select round(((cur.o / cur.sd) / (p_orders::numeric / nullif(p_store_days, 0)) - 1) * 100, 1)
        from (select sum(order_count)::numeric as o,
                     nullif((select count(*) from _mk_cd where day between v_from and v_to), 0)::numeric as sd
                from _mk_f where day between v_from and v_to and slot < v_cmp) cur
       where p_store_days > 0 and p_orders > 0 and cur.sd is not null),
    'avg_change_pct', (
      select round((cur.av / prv.av - 1) * 100, 1)
        from (select sum(amount_sum)::numeric / nullif(sum(amount_count), 0) av from _mk_f
               where day between v_from and v_to and slot < v_cmp) cur,
             (select sum(amount_sum)::numeric / nullif(sum(amount_count), 0) av from _mk_f
               where day between v_pfrom and v_pto and slot < v_cmp) prv
       where prv.av > 0 and cur.av is not null)
  ) into j_tot
    from _mk_f f where f.day between v_from and v_to;

  -- 채널 (홀·배달·포장 각각 독립)
  select jsonb_agg(jsonb_build_object(
    'channel', ch,
    'orders', x.o,
    'share', round(x.o::numeric / nullif((select sum(order_count) from _mk_f where day between v_from and v_to and channel <> 'UNKNOWN'), 0), 3),
    'stores', x.stores,
    'amount_orders', x.ao,
    'amount_sum', x.asum,
    'avg', round(x.asum::numeric / nullif(x.ao, 0)),
    'median', (select round(percentile_cont(0.5) within group (order by v)::numeric)
                 from _mk_f f2, unnest(f2.amounts) v where f2.day between v_from and v_to and f2.channel = ch),
    'orders_change_pct', (
      select round(((cur.o / cur.sd) / (prv.o / prv.sd) - 1) * 100, 1)
        from (select sum(order_count)::numeric o, nullif(c_store_days, 0)::numeric sd from _mk_f
               where day between v_from and v_to and slot < v_cmp and channel = ch) cur,
             (select sum(order_count)::numeric o, nullif(p_store_days, 0)::numeric sd from _mk_f
               where day between v_pfrom and v_pto and slot < v_cmp and channel = ch) prv
       where prv.o > 0 and prv.sd > 0 and cur.sd > 0),
    'avg_change_pct', (
      select round((cur.av / prv.av - 1) * 100, 1)
        from (select sum(amount_sum)::numeric / nullif(sum(amount_count), 0) av from _mk_f
               where day between v_from and v_to and slot < v_cmp and channel = ch) cur,
             (select sum(amount_sum)::numeric / nullif(sum(amount_count), 0) av from _mk_f
               where day between v_pfrom and v_pto and slot < v_cmp and channel = ch) prv
       where prv.av > 0 and cur.av is not null),
    'peak_slot', (select slot from _mk_f where day between v_from and v_to and channel = ch
                   group by slot having sum(order_count) > 0 order by sum(order_count) desc, slot limit 1),
    'top_menus', (select coalesce(jsonb_agg(jsonb_build_object('name', t.mkey, 'quantity', t.q) order by t.q desc, t.mkey), '[]'::jsonb)
                    from (select mkey, sum(quantity) q from _mk_m where day between v_from and v_to and channel = ch and mkey is not null
                           group by mkey order by q desc, mkey limit 3) t),
    'providers', (select coalesce(jsonb_object_agg(p.provider, p.o), '{}'::jsonb)
                    from (select provider, sum(order_count) o from _mk_f where day between v_from and v_to and channel = ch
                           group by provider) p)
  ) order by ord) into j_ch
  from (values ('HALL', 1), ('DELIVERY', 2), ('PICKUP', 3)) chs(ch, ord)
  cross join lateral (
    select coalesce(sum(order_count), 0) o, coalesce(sum(amount_count), 0) ao, coalesce(sum(amount_sum), 0) asum,
           count(distinct restaurant_id) filter (where order_count > 0) stores
      from _mk_f where day between v_from and v_to and channel = chs.ch) x;

  -- 가격대별 주문 (주문 1건의 분석 금액 기준)
  with b as (
    select i, case when i = 1 then 0 else st.price_bands[i - 1] + 1 end as lo,
           case when i <= cardinality(st.price_bands) then st.price_bands[i] end as hi
      from generate_series(1, cardinality(st.price_bands) + 1) i),
  cur as (select f.channel, x from _mk_f f, unnest(f.amounts) x where f.day between v_from and v_to),
  cmpc as (select x from _mk_f f, unnest(f.amounts) x where f.day between v_from and v_to and f.slot < v_cmp),
  prv as (select x from _mk_f f, unnest(f.amounts) x where f.day between v_pfrom and v_pto and f.slot < v_cmp),
  tot as (select (select count(*) from cur) n, (select count(*) from cmpc) nc, (select count(*) from prv) np)
  select jsonb_agg(jsonb_build_object(
    'lo', b.lo, 'hi', b.hi,
    'orders', (select count(*) from cur where x >= b.lo and (b.hi is null or x <= b.hi)),
    'pct', round((select count(*) from cur where x >= b.lo and (b.hi is null or x <= b.hi))::numeric / nullif(tot.n, 0), 3),
    'change_pp', case when tot.np > 0 and tot.nc > 0 then round(100 * (
                   (select count(*) from cmpc where x >= b.lo and (b.hi is null or x <= b.hi))::numeric / tot.nc
                 - (select count(*) from prv where x >= b.lo and (b.hi is null or x <= b.hi))::numeric / tot.np), 1) end,
    'by_channel', (select jsonb_object_agg(c.ch, jsonb_build_object(
                     'orders', (select count(*) from cur where channel = c.ch and x >= b.lo and (b.hi is null or x <= b.hi)),
                     'pct', round((select count(*) from cur where channel = c.ch and x >= b.lo and (b.hi is null or x <= b.hi))::numeric
                                  / nullif((select count(*) from cur where channel = c.ch), 0), 3)))
                     from unnest(array['HALL', 'DELIVERY', 'PICKUP']) c(ch))
  ) order by b.i) into j_bands
  from b, tot;

  -- 메뉴 판매단가 분포 (메뉴 1개 단가, 수량 기준) — 단가 자료가 있을 때만
  with b as (
    select i, case when i = 1 then 0 else st.price_bands[i - 1] + 1 end as lo,
           case when i <= cardinality(st.price_bands) then st.price_bands[i] end as hi
      from generate_series(1, cardinality(st.price_bands) + 1) i),
  u as (select unit_price, quantity from _mk_m where day between v_from and v_to and unit_price is not null),
  t as (select coalesce(sum(quantity), 0) q from u)
  select case when t.q = 0 then null else jsonb_build_object('quantity', t.q, 'bands', jsonb_agg(jsonb_build_object(
      'lo', b.lo, 'hi', b.hi,
      'quantity', (select coalesce(sum(quantity), 0) from u where unit_price >= b.lo and (b.hi is null or unit_price <= b.hi)),
      'pct', round((select coalesce(sum(quantity), 0) from u where unit_price >= b.lo and (b.hi is null or unit_price <= b.hi))::numeric / nullif(t.q, 0), 3)
    ) order by b.i)) end into j_unit
  from b, t group by t.q;

  -- 음식 종류 (주문 자료가 있는 매장만, 제공 매장 수와 함께)
  select coalesce(jsonb_agg(jsonb_build_object(
    'category', x.cat, 'orders', x.o,
    'pct', round(x.o::numeric / nullif(c_orders, 0), 3),
    'stores', x.stores,
    'avg', round(x.asum::numeric / nullif(x.ao, 0)),
    'by_channel', x.by_ch
  ) order by x.o desc, x.cat), '[]'::jsonb) into j_cat
  from (
    select r.cat,
           coalesce((select sum(order_count) from _mk_f f where f.cat = r.cat and f.day between v_from and v_to), 0) o,
           coalesce((select sum(amount_count) from _mk_f f where f.cat = r.cat and f.day between v_from and v_to), 0) ao,
           coalesce((select sum(amount_sum) from _mk_f f where f.cat = r.cat and f.day between v_from and v_to), 0) asum,
           count(distinct cd.restaurant_id) stores,
           (select coalesce(jsonb_object_agg(f.channel, f.o), '{}'::jsonb)
              from (select channel, sum(order_count) o from _mk_f f where f.cat = r.cat and f.day between v_from and v_to group by channel) f) by_ch
      from _mk_cd cd join _mk_r r on r.id = cd.restaurant_id
     where cd.day between v_from and v_to
     group by r.cat) x;

  -- 인기메뉴 (판매 수량. 같은 메뉴명 또는 관리자가 확인한 공통 분류만 묶는다)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(t order by (t ->> 'quantity')::int desc, t ->> 'name') from (
      select jsonb_build_object(
        'name', m.mkey, 'grouped', bool_or(m.grouped),
        'quantity', sum(m.quantity),
        'amount_sum', sum(m.line_amount_sum),
        'avg_unit_price', round(sum(m.line_amount_sum)::numeric / nullif(sum(m.quantity) filter (where m.line_amount_sum > 0), 0)),
        'stores', count(distinct m.restaurant_id),
        'by_channel', (select jsonb_object_agg(z.channel, z.q) from (
                         select channel, sum(quantity) q from _mk_m z where z.mkey = m.mkey and z.day between v_from and v_to group by channel) z),
        'peak_slot', (select z.slot from _mk_m z where z.mkey = m.mkey and z.day between v_from and v_to
                       group by z.slot order by sum(z.quantity) desc, z.slot limit 1),
        'change_pct', (select round(((sum(z.quantity) filter (where z.day between v_from and v_to))::numeric / nullif(c_store_days, 0)
                                     / ((sum(z.quantity) filter (where z.day between v_pfrom and v_pto))::numeric / nullif(p_store_days, 0)) - 1) * 100, 1)
                         from _mk_m z where z.mkey = m.mkey and z.slot < v_cmp and p_store_days > 0
                        having sum(z.quantity) filter (where z.day between v_pfrom and v_pto) > 0)
      ) t
        from _mk_m m where m.day between v_from and v_to and m.mkey is not null
       group by m.mkey order by sum(m.quantity) desc, m.mkey limit 10) s), '[]'::jsonb),
    'unclassified_quantity', (select coalesce(sum(quantity), 0) from _mk_m where day between v_from and v_to and mkey is null),
    'total_quantity', (select coalesce(sum(quantity), 0) from _mk_m where day between v_from and v_to)
  ) into j_menu;

  -- 시간대 (30분 구간 → 1시간 구간)
  select jsonb_agg(jsonb_build_object(
    'slot', s, 'orders', x.o, 'amount_sum', x.asum, 'avg', round(x.asum::numeric / nullif(x.ao, 0)),
    'channels', x.ch,
    'top_menu', (select mkey from _mk_m where day between v_from and v_to and slot = s and mkey is not null
                  group by mkey order by sum(quantity) desc, mkey limit 1)
  ) order by s) into j_half
  from generate_series(sf, sl - 1) s
  cross join lateral (
    select coalesce(sum(order_count), 0) o, coalesce(sum(amount_count), 0) ao, coalesce(sum(amount_sum), 0) asum,
           coalesce((select jsonb_object_agg(channel, o) from (select channel, sum(order_count) o from _mk_f
                      where day between v_from and v_to and slot = s group by channel) q), '{}'::jsonb) ch
      from _mk_f where day between v_from and v_to and slot = s) x;

  select jsonb_agg(jsonb_build_object(
    'from_slot', greatest(h * 2, sf), 'to_slot', least(h * 2 + 2, sl),
    'orders', x.o, 'amount_sum', x.asum, 'avg', round(x.asum::numeric / nullif(x.ao, 0)),
    'channels', x.ch,
    'top_menu', (select mkey from _mk_m where day between v_from and v_to and slot / 2 = h and mkey is not null
                  group by mkey order by sum(quantity) desc, mkey limit 1)
  ) order by h) into j_hour
  from generate_series(sf / 2, (sl - 1) / 2) h
  cross join lateral (
    select coalesce(sum(order_count), 0) o, coalesce(sum(amount_count), 0) ao, coalesce(sum(amount_sum), 0) asum,
           coalesce((select jsonb_object_agg(channel, o) from (select channel, sum(order_count) o from _mk_f
                      where day between v_from and v_to and slot / 2 = h group by channel) q), '{}'::jsonb) ch
      from _mk_f where day between v_from and v_to and slot / 2 = h) x;

  -- 요일 (자료가 있는 날만 평균에 넣는다 — 미수집일은 0건이 아님)
  if p_period <> 'today' then
    select jsonb_agg(jsonb_build_object(
      'dow', d, 'observed_days', x.days, 'orders', x.o,
      'avg_orders', round(x.o::numeric / nullif(x.days, 0), 1),
      'avg', round(x.asum::numeric / nullif(x.ao, 0)),
      'channels', x.ch,
      'top_menu', (select mkey from _mk_m where day between v_from and v_to and extract(isodow from day) = d and mkey is not null
                    group by mkey order by sum(quantity) desc, mkey limit 1)
    ) order by d) into j_dow
    from generate_series(1, 7) d
    cross join lateral (
      select (select count(distinct day) from _mk_cd where day between v_from and v_to and extract(isodow from day) = d) days,
             coalesce(sum(order_count), 0) o, coalesce(sum(amount_count), 0) ao, coalesce(sum(amount_sum), 0) asum,
             coalesce((select jsonb_object_agg(channel, o) from (select channel, sum(order_count) o from _mk_f
                        where day between v_from and v_to and extract(isodow from day) = d group by channel) q), '{}'::jsonb) ch
        from _mk_f where day between v_from and v_to and extract(isodow from day) = d) x;
  end if;

  -- 오늘 vs 지난주 같은 요일 (같은 시각까지, 완료된 30분 구간만)
  select jsonb_build_object(
    'cutoff_slot', v_cut,
    'today_observed', exists (select 1 from _mk_cd where day = v_today),
    'last_week_observed', exists (select 1 from _mk_cd where day = v_today - 7),
    'today_orders', coalesce(sum(order_count) filter (where day = v_today), 0),
    'last_week_orders', coalesce(sum(order_count) filter (where day = v_today - 7), 0),
    'today_stores', (select count(distinct restaurant_id) from _mk_cd where day = v_today),
    'last_week_stores', (select count(distinct restaurant_id) from _mk_cd where day = v_today - 7),
    'today_avg', round((sum(amount_sum) filter (where day = v_today))::numeric / nullif(sum(amount_count) filter (where day = v_today), 0)),
    'last_week_avg', round((sum(amount_sum) filter (where day = v_today - 7))::numeric
                           / nullif(sum(amount_count) filter (where day = v_today - 7), 0))
  ) into j_today
  from _mk_f where day in (v_today, v_today - 7) and slot < v_cut;

  -- 공공 상권 자료 (자체 주문 자료와 합산하지 않음)
  select coalesce(jsonb_agg(jsonb_build_object(
    'source', p.source, 'dataset', p.dataset, 'metric', p.metric, 'category', p.category, 'value', p.value, 'unit', p.unit,
    'period_label', p.period_label, 'base_date', p.base_date, 'source_updated_at', p.source_updated_at,
    'source_url', p.source_url, 'note', p.note
  ) order by p.source, p.metric, p.category), '[]'::jsonb) into j_pub
  from public.market_public_data p where p.area_id = a.id;

  -- 신뢰상태
  if c_orders = 0 then
    v_status := 'none';
    reasons := reasons || '분석 기간에 확인된 유효 주문이 없어요'::text;
  else
    if c_stores < st.min_stores then
      reasons := reasons || format('데이터 제공 매장 %s곳 (기준 %s곳 이상)', c_stores, st.min_stores);
    end if;
    if c_orders < st.min_orders then
      reasons := reasons || format('유효 주문 %s건 (기준 %s건 이상)', c_orders, st.min_orders);
    end if;
    v_status := case when cardinality(reasons) > 0 then 'insufficient' else 'ok' end;
  end if;
  select r.cat, count(*)::numeric / nullif(c_stores, 0) into top_cat, top_cat_share
    from (select distinct restaurant_id from _mk_cd where day between v_from and v_to) d join _mk_r r on r.id = d.restaurant_id
   group by r.cat order by count(*) desc limit 1;
  if c_stores >= 2 and top_cat_share >= 0.6 then
    warnings := warnings || format('데이터 제공 매장의 %s%%가 %s — 업종 편향 가능성', round(top_cat_share * 100), top_cat);
  end if;
  if c_orders > 0 then
    if not exists (select 1 from _mk_f where day between v_from and v_to and channel = 'DELIVERY' and order_count > 0) then
      warnings := warnings || '배달 주문 자료가 없어요 — 채널 구성은 데이터 제공 범위의 영향을 받아요'::text;
    end if;
    if c_orders > c_amt_orders then
      warnings := warnings || format('금액 기준(배달비 포함 여부)을 확인할 수 없는 주문 %s건은 금액 분석에서 뺐어요', c_orders - c_amt_orders);
    end if;
    if (select count(*) from _mk_cd cd where cd.day between v_from and v_to
          and not exists (select 1 from _mk_f f where f.restaurant_id = cd.restaurant_id and f.day = cd.day)) > 0 then
      warnings := warnings || format('자료는 받았지만 점심시간 주문이 0건인 매장·날짜 %s건 — 누락 여부 확인 필요',
        (select count(*) from _mk_cd cd where cd.day between v_from and v_to
           and not exists (select 1 from _mk_f f where f.restaurant_id = cd.restaurant_id and f.day = cd.day)));
    end if;
  end if;
  j_rel := jsonb_build_object('status', v_status, 'reasons', to_jsonb(reasons), 'warnings', to_jsonb(warnings),
                              'min_stores', st.min_stores, 'min_orders', st.min_orders);

  return jsonb_build_object(
    'area', j_area,
    'scope', v_scope,
    'period', jsonb_build_object('key', p_period, 'from', v_from, 'to', v_to, 'live', p_period = 'today',
                                 'now_slot', v_cut, 'compare_label', v_compare_label, 'prev_from', v_pfrom, 'prev_to', v_pto),
    'lunch', jsonb_build_object('start_min', st.lunch_start_min, 'end_min', st.lunch_end_min),
    'price_bounds', to_jsonb(st.price_bands),
    'as_of', (select max(last_success_at) from _mk_c),
    'refreshed_at', (select max(refreshed_at) from _mk_f),
    'coverage', j_cov,
    'reliability', j_rel,
    'totals', j_tot,
    'channels', j_ch,
    'price_bands', j_bands,
    'menu_unit_prices', j_unit,
    'categories', j_cat,
    'menus', j_menu,
    'slots_half', j_half,
    'slots_hour', j_hour,
    'weekdays', j_dow,
    'today_vs_last_week', j_today,
    'public_data', j_pub
  );
end $$;

-- 지역 비교: 같은 기간·같은 방식으로 계산한 요약. 공간 단위가 다르면 comparable = false
create or replace function public.market_compare(p_area_ids text[], p_period text default '7d', p_test boolean default false,
                                                 p_as_business boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  aid text;
  r jsonb;
  out jsonb := '[]'::jsonb;
  units text[] := '{}';
begin
  if cardinality(p_area_ids) > 8 then raise exception 'too many areas'; end if;
  foreach aid in array p_area_ids loop
    r := public.market_analysis(aid, p_period, p_test, p_as_business);
    units := units || (r -> 'area' ->> 'label');
    out := out || jsonb_build_object(
      'area', r -> 'area', 'scope', r -> 'scope', 'period', r -> 'period', 'as_of', r -> 'as_of',
      'coverage', r -> 'coverage', 'reliability', r -> 'reliability', 'totals', r -> 'totals',
      'channels', (select jsonb_agg(jsonb_build_object('channel', c ->> 'channel', 'orders', c -> 'orders', 'share', c -> 'share',
                                                       'avg', c -> 'avg')) from jsonb_array_elements(r -> 'channels') c),
      'top_category', r -> 'categories' -> 0 ->> 'category',
      'top_menu', r -> 'menus' -> 'items' -> 0 ->> 'name',
      'peak_hour', (select h from jsonb_array_elements(r -> 'slots_hour') h
                     where (h ->> 'orders')::int > 0 order by (h ->> 'orders')::int desc limit 1)
    );
  end loop;
  return jsonb_build_object(
    'comparable', (select count(distinct u) from unnest(units) u) <= 1,
    'units', to_jsonb(units),
    'areas', out);
end $$;

-- 사업자·관리자가 고를 수 있는 지역
create or replace function public.market_area_list()
returns table (id text, name text, sido text, spatial_mode text, radius_m integer, business_visible boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.name, a.sido, a.spatial_mode, a.radius_m, a.business_visible
    from public.market_areas a
   where a.is_active and (public.is_admin() or (public.is_business() and a.business_visible))
   order by a.sort_order, a.name;
$$;

-- 관리자: 사업자 계정 지정 (이메일로)
create or replace function public.admin_set_business_user(p_email text, p_org_name text, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception '가입된 계정이 없어요: %', p_email using errcode = 'P0002'; end if;
  insert into public.business_users (user_id, org_name, is_active) values (v_id, btrim(p_org_name), p_active)
  on conflict (user_id) do update set org_name = excluded.org_name, is_active = excluded.is_active;
  return v_id;
end $$;

create or replace function public.admin_list_business_users()
returns table (user_id uuid, email text, org_name text, plan text, is_active boolean, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.user_id, u.email::text, b.org_name, b.plan, b.is_active, b.created_at
    from public.business_users b join auth.users u on u.id = b.user_id
   where public.is_admin()
   order by b.created_at;
$$;

-- ───────── 주문 수집: 배달비(delivery_fee)도 저장 (5단계 함수와 같음. 이 열 추가 + 주문상태가 없을 때 취소 여부가 null이 되던 문제 수정) ─────────
create or replace function public.ingest_orders(p_connection_id uuid, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.order_connections;
  o jsonb;
  it jsonb;
  v_id uuid;
  v_inserted boolean;
  v_link text;
  v_other public.orders;
  v_menu uuid;
  v_alias_found boolean;
  v_matched text;
  n_in integer := 0; n_up integer := 0; n_merged integer := 0; n_review integer := 0; n_items integer := 0; n_unmatched integer := 0;
begin
  perform public.assert_admin_or_service();
  select * into c from public.order_connections where id = p_connection_id for update;
  if not found then raise exception 'connection not found'; end if;
  if c.is_test then
    if c.status = 'paused' then raise exception 'connection paused'; end if;
    if c.test_simulate_error then
      update public.order_connections
         set status = 'error', last_attempt_at = now(), last_error = '테스트: API 연결 오류(시뮬레이션)', last_error_at = now()
       where id = c.id;
      perform public.refresh_order_aggregates(array[c.restaurant_id]);  -- 오류 상태를 집계에 바로 반영
      return jsonb_build_object('ok', false, 'error', 'simulated_error');
    end if;
  elsif c.status <> 'active' then
    raise exception '연동이 활성 상태가 아니에요 (현재: %)', c.status using errcode = '42501';
  end if;
  if jsonb_typeof(p_orders) <> 'array' then raise exception 'p_orders must be an array'; end if;

  for o in select * from jsonb_array_elements(p_orders) loop
    v_link := nullif(btrim(o ->> 'link_key'), '');
    insert into public.orders as t (
      restaurant_id, connection_id, provider, external_order_id, link_key, channel, ordered_at, paid_at,
      total_amount, discount_amount, refund_amount, order_status, payment_status, is_cancelled, is_test, delivery_fee)
    values (
      c.restaurant_id, c.id, c.provider, btrim(o ->> 'external_order_id'), v_link,
      coalesce(nullif(o ->> 'channel', ''), 'UNKNOWN'),
      (o ->> 'ordered_at')::timestamptz, nullif(o ->> 'paid_at', '')::timestamptz,
      (o ->> 'total_amount')::integer, coalesce((o ->> 'discount_amount')::integer, 0),
      coalesce((o ->> 'refund_amount')::integer, 0),
      coalesce(nullif(o ->> 'order_status', ''), 'unknown'), coalesce(nullif(o ->> 'payment_status', ''), 'unknown'),
      coalesce((o ->> 'is_cancelled')::boolean, false) or coalesce(o ->> 'order_status' = 'cancelled', false), c.is_test,
      nullif(o ->> 'delivery_fee', '')::integer)
    on conflict (provider, restaurant_id, external_order_id, is_test) do update
       set link_key = coalesce(excluded.link_key, t.link_key),
           channel = excluded.channel,
           ordered_at = excluded.ordered_at,
           paid_at = excluded.paid_at,
           total_amount = excluded.total_amount,
           discount_amount = excluded.discount_amount,
           refund_amount = excluded.refund_amount,
           order_status = excluded.order_status,
           payment_status = excluded.payment_status,
           is_cancelled = excluded.is_cancelled,
           delivery_fee = excluded.delivery_fee,
           collected_at = now()
    returning t.id, (t.xmax = 0) into v_id, v_inserted;

    if v_inserted then n_in := n_in + 1; else n_up := n_up + 1; end if;

    -- 메뉴: 같은 주문을 다시 받으면 통째로 교체 (수량이 두 번 쌓이지 않게)
    delete from public.order_items where order_id = v_id;
    for it in select * from jsonb_array_elements(coalesce(o -> 'items', '[]'::jsonb)) loop
      select a.menu_id, true into v_menu, v_alias_found
        from public.menu_aliases a
       where a.restaurant_id = c.restaurant_id and a.external_name_norm = public.norm_menu_name(it ->> 'name');
      if v_alias_found then
        v_matched := case when v_menu is null then 'ignored' else 'matched' end;
      else
        select m.id into v_menu from public.menus m
         where m.restaurant_id = c.restaurant_id and public.norm_menu_name(m.name) = public.norm_menu_name(it ->> 'name')
         order by m.is_signature desc limit 1;
        v_matched := case when v_menu is null then 'unmatched' else 'matched' end;
      end if;
      insert into public.order_items (order_id, restaurant_id, menu_id, external_menu_name, quantity, unit_price, line_amount, match_status)
      values (v_id, c.restaurant_id, v_menu, btrim(it ->> 'name'), (it ->> 'quantity')::integer,
              (it ->> 'unit_price')::integer,
              coalesce((it ->> 'line_amount')::integer, (it ->> 'unit_price')::integer * (it ->> 'quantity')::integer),
              v_matched);
      n_items := n_items + 1;
      if v_matched = 'unmatched' then n_unmatched := n_unmatched + 1; end if;
      v_menu := null; v_alias_found := false;
    end loop;

    -- 중복 판별은 처음 들어온 주문에만 한다 (관리자 판정을 덮어쓰지 않음)
    if v_inserted then
      v_other := null;
      if v_link is not null then
        -- 연결번호가 같은 다른 제공처 주문이 있으면 하나로 통합 (먼저 들어온 쪽이 대표)
        select * into v_other from public.orders x
         where x.restaurant_id = c.restaurant_id and x.is_test = c.is_test and x.link_key = v_link
           and x.provider <> c.provider and x.id <> v_id and x.merged_into is null
         order by x.collected_at limit 1;
        if found then
          update public.orders set dedup_status = 'merged', merged_into = v_other.id where id = v_id;
          n_merged := n_merged + 1;
        end if;
      end if;
      if v_other.id is null then
        -- 연결번호가 없으면 POS(또는 POS 파일)와 배달앱 사이에서 같은 채널·같은 금액·3분 이내 주문을
        -- '중복 가능성 확인 필요'로 분류한다 (합산하지 않음). 배민과 쿠팡이츠 주문끼리는 같은 주문일 수 없다.
        select * into v_other from public.orders x
         where x.restaurant_id = c.restaurant_id and x.is_test = c.is_test and x.provider <> c.provider
           and ((c.provider in ('pos', 'csv')) <> (x.provider in ('pos', 'csv')))
           and (x.channel = coalesce(nullif(o ->> 'channel', ''), 'UNKNOWN') or x.channel = 'UNKNOWN'
                or coalesce(nullif(o ->> 'channel', ''), 'UNKNOWN') = 'UNKNOWN')
           and x.id <> v_id and x.merged_into is null and x.dedup_status = 'unique'
           and x.total_amount = (o ->> 'total_amount')::integer
           and abs(extract(epoch from (x.ordered_at - (o ->> 'ordered_at')::timestamptz))) <= 180
           and (v_link is null or x.link_key is null)
         order by abs(extract(epoch from (x.ordered_at - (o ->> 'ordered_at')::timestamptz))) limit 1;
        if found then
          update public.orders set dedup_status = 'possible_duplicate', duplicate_of = v_other.id where id = v_id;
          n_review := n_review + 1;
        end if;
      end if;
    end if;
  end loop;

  update public.order_connections
     set last_attempt_at = now(), last_success_at = now(),
         status = case when status = 'error' then (case when is_test then 'active' else status end) else status end
   where id = c.id;
  perform public.refresh_order_aggregates(array[c.restaurant_id]);

  return jsonb_build_object('ok', true, 'inserted', n_in, 'updated', n_up, 'merged', n_merged,
                            'needs_review', n_review, 'items', n_items, 'unmatched_items', n_unmatched);
end $$;

-- ───────── 권한 ─────────
revoke execute on function public.refresh_market_stats() from public, anon, authenticated;
revoke execute on function public.market_analysis(text, text, boolean, boolean) from public, anon;
revoke execute on function public.market_compare(text[], text, boolean, boolean) from public, anon;
revoke execute on function public.admin_rebuild_market_stats(date, date) from public, anon;
revoke execute on function public.admin_set_business_user(text, text, boolean) from public, anon;
revoke execute on function public.admin_list_business_users() from public, anon;
revoke execute on function public.market_area_list() from public, anon;
grant execute on function public.market_analysis(text, text, boolean, boolean) to authenticated;
grant execute on function public.market_compare(text[], text, boolean, boolean) to authenticated;
grant execute on function public.admin_rebuild_market_stats(date, date) to authenticated;
grant execute on function public.admin_set_business_user(text, text, boolean) to authenticated;
grant execute on function public.admin_list_business_users() to authenticated;
grant execute on function public.market_area_list() to authenticated;
grant execute on function public.is_business() to authenticated;
grant execute on function public.market_viewer_role() to authenticated;

-- 이미 쌓인 주문을 처음 한 번 집계
insert into public.market_dirty
select distinct o.restaurant_id, public.kst_day(o.ordered_at) from public.orders o
on conflict do nothing;
insert into public.market_collection_days (connection_id, restaurant_id, is_test, day)
select distinct o.connection_id, o.restaurant_id, o.is_test, public.kst_day(o.ordered_at) from public.orders o
on conflict do nothing;
select public.refresh_market_stats();
