-- 점심뭐먹 6단계: 주문 활발도 기반 인기 음식점 자동 정렬
-- 5단계 주문 테이블을 그대로 쓰고, 필요한 열·인덱스·함수만 더한다.
--
-- 원칙
-- - 순위는 서버에서 계산하고 휴대폰에는 정렬된 결과와 공개 가능한 값만 보낸다.
-- - 순위는 주문 원본에서 바로 계산한다 (집계표는 계산 시점에 멈춰 있어 '최근 10분'이 금방 낡는다).
-- - 공개 허용 + 실제 + 최신 데이터만 주문량 순위에 넣는다. 나머지는 별도 그룹에서 거리순.
-- - 최소 공개 건수 미만은 순위 값 0으로 묶어 거리순 — 적은 주문끼리의 세부 순위를 드러내지 않는다.

-- ───────── 유효 주문: 취소·결제 실패·중복 의심·통합된 사본 제외 ─────────
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('paid', 'unpaid', 'refunded', 'partially_refunded', 'failed', 'unknown'));

alter table public.orders add column if not exists is_valid boolean generated always as (
  not is_cancelled and payment_status <> 'failed' and dedup_status <> 'possible_duplicate' and merged_into is null
) stored;

-- 매장·채널별 최근 유효 주문을 빠르게 세기 위한 부분 인덱스
create index if not exists orders_rank_idx
  on public.orders (restaurant_id, is_test, channel, ordered_at desc) where is_valid;

-- ───────── 설정 ─────────
alter table public.order_settings
  add column if not exists refresh_interval_seconds integer not null default 60,
  add column if not exists rank_primary_minutes integer not null default 10,
  add column if not exists rank_secondary_minutes integer not null default 30;
alter table public.order_settings drop constraint if exists order_settings_rank_check;
alter table public.order_settings add constraint order_settings_rank_check check (
  refresh_interval_seconds between 15 and 600
  and rank_primary_minutes between 5 and 60
  and rank_secondary_minutes between 10 and 180
  and rank_secondary_minutes > rank_primary_minutes);

-- 제공처 주기에 맞춘 연동별 갱신 허용시간 (비우면 설정값)
alter table public.order_connections
  add column if not exists freshness_minutes integer check (freshness_minutes between 1 and 1440);

-- ───────── 배달 정보: 확인된 값만 (관리자 입력) ─────────
alter table public.restaurants
  add column if not exists delivery_fee_krw integer check (delivery_fee_krw >= 0),
  add column if not exists delivery_eta_minutes integer check (delivery_eta_minutes between 1 and 240),
  add column if not exists baemin_order_url text check (baemin_order_url ~ '^https://'),
  add column if not exists coupangeats_order_url text check (coupangeats_order_url ~ '^https://');

-- ───────── 5단계 집계 함수: 유효 주문 정의를 is_valid로 통일 ─────────
create or replace function public.refresh_order_aggregates(p_restaurant_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := now();
  kst_day timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  stale interval := make_interval(mins => (select stale_after_minutes from public.order_settings));
  n integer;
begin
  perform public.assert_admin_or_service();

  delete from public.order_aggregates a
   where p_restaurant_ids is null or a.restaurant_id = any (p_restaurant_ids);

  with targets as (
    select distinct o.restaurant_id from public.orders o
     where o.ordered_at >= kst_day - interval '1 day'
       and (p_restaurant_ids is null or o.restaurant_id = any (p_restaurant_ids))
  ),
  windows(window_key, window_start, window_end) as (
    values ('10m', now_ts - interval '10 minutes', now_ts),
           ('30m', now_ts - interval '30 minutes', now_ts),
           ('60m', now_ts - interval '60 minutes', now_ts),
           ('lunch', kst_day + interval '11 hours', least(now_ts, kst_day + interval '14 hours')),
           ('today', kst_day, now_ts)
  ),
  scoped as (
    select o.*, s.scope
      from public.orders o
      join public.order_connections c on c.id = o.connection_id
      cross join lateral (
        select unnest(case when o.is_test then array['test']
                           when c.public_allowed then array['internal', 'public']
                           else array['internal'] end) as scope
      ) s
     where o.restaurant_id in (select restaurant_id from targets)
       and o.ordered_at >= kst_day - interval '1 day'
  ),
  base as (
    select t.restaurant_id, sc.scope, w.window_key, w.window_start, w.window_end, ch.channel
      from targets t
      cross join windows w
      cross join (values ('HALL'), ('DELIVERY'), ('PICKUP'), ('UNKNOWN')) ch(channel)
      cross join (values ('public'), ('internal'), ('test')) sc(scope)
     where w.window_end > w.window_start
  ),
  agg as (
    select b.restaurant_id, b.scope, b.window_key, b.window_start, b.window_end, b.channel,
           count(o.id) filter (where o.valid) as order_count,
           coalesce(sum(o.total_amount) filter (where o.valid), 0) as gross_amount,
           coalesce(sum(o.net_amount) filter (where o.valid), 0) as net_amount,
           count(o.id) filter (where o.is_cancelled and o.dedup_status <> 'possible_duplicate' and o.merged_into is null) as cancelled_count
      from base b
      left join lateral (
        select x.id, x.total_amount, x.net_amount, x.is_cancelled, x.dedup_status, x.merged_into,
               x.is_valid as valid
          from scoped x
         where x.restaurant_id = b.restaurant_id and x.scope = b.scope and x.channel = b.channel
           and x.ordered_at >= b.window_start and x.ordered_at < b.window_end
      ) o on true
     group by 1, 2, 3, 4, 5, 6
  )
  insert into public.order_aggregates (
    restaurant_id, scope, window_key, channel, window_start, window_end, order_count, by_provider,
    menu_quantities, gross_amount, net_amount, cancelled_count, refreshed_at, data_status)
  select a.restaurant_id, a.scope, a.window_key, a.channel, a.window_start, a.window_end, a.order_count,
         coalesce((
           select jsonb_object_agg(p.provider, p.cnt) from (
             select x.provider, count(*) as cnt from scoped x
              where x.restaurant_id = a.restaurant_id and x.scope = a.scope and x.channel = a.channel
                and x.ordered_at >= a.window_start and x.ordered_at < a.window_end
                and x.is_valid
              group by x.provider) p), '{}'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object('menu_id', q.menu_id, 'name', q.name, 'quantity', q.qty)
                            order by q.qty desc, q.name)
             from (
               select i.menu_id, coalesce(m.name, i.external_menu_name) as name, sum(i.quantity) as qty
                 from scoped x
                 join public.order_items i on i.order_id = x.id
                 left join public.menus m on m.id = i.menu_id
                where x.restaurant_id = a.restaurant_id and x.scope = a.scope and x.channel = a.channel
                  and x.ordered_at >= a.window_start and x.ordered_at < a.window_end
                  and x.is_valid
                  and i.match_status <> 'ignored'
                  -- 공개 집계에는 내부 메뉴와 연결된 메뉴만 쓴다
                  and (a.scope <> 'public' or i.menu_id is not null)
                group by i.menu_id, coalesce(m.name, i.external_menu_name)
             ) q), '[]'::jsonb),
         a.gross_amount, a.net_amount, a.cancelled_count, now_ts,
         coalesce((
           -- 모든 연동이 오류면 'error'(소비자 비공개), 일부만 오류이거나 늦으면 'delayed'
           select case
                    when bool_and(c.status = 'error' or c.test_simulate_error) then 'error'
                    when bool_or(c.status = 'error' or c.test_simulate_error
                                 or (c.ingest_mode <> 'file' and (c.last_success_at is null or c.last_success_at < now_ts - stale))) then 'delayed'
                    else 'ok' end
             from public.order_connections c
            where c.restaurant_id = a.restaurant_id and c.is_test = (a.scope = 'test') and c.status <> 'paused'
         ), 'ok')
    from agg a
   where a.order_count > 0 or a.cancelled_count > 0;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_order_overview(p_test boolean default false)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  kst_day timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'connected_restaurants', (select count(distinct restaurant_id) from public.order_connections where is_test = p_test),
    'healthy_restaurants', (select count(distinct restaurant_id) from public.order_connections
                             where is_test = p_test and status = 'active' and (last_error_at is null or last_error_at < coalesce(last_success_at, '-infinity'))),
    'error_restaurants', (select count(distinct restaurant_id) from public.order_connections
                           where is_test = p_test and (status = 'error' or (last_error_at is not null and last_error_at >= coalesce(last_success_at, '-infinity')))),
    'preparing_connections', (select count(*) from public.order_connections where is_test = p_test and status in ('preparing', 'pending_approval')),
    'today', (select jsonb_build_object(
                'HALL', count(*) filter (where channel = 'HALL'),
                'DELIVERY', count(*) filter (where channel = 'DELIVERY'),
                'PICKUP', count(*) filter (where channel = 'PICKUP'),
                'UNKNOWN', count(*) filter (where channel = 'UNKNOWN'))
                from public.orders
               where is_test = p_test and ordered_at >= kst_day
                 and is_valid),
    'last_10m', (select count(*) from public.orders
                  where is_test = p_test and ordered_at >= now() - interval '10 minutes'
                    and is_valid),
    'needs_review', (select count(*) from public.orders where is_test = p_test and dedup_status = 'possible_duplicate'),
    'unmatched_items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id
                         where o.is_test = p_test and i.match_status = 'unmatched'),
    'last_collected_at', (select max(collected_at) from public.orders where is_test = p_test),
    'last_success_at', (select max(last_success_at) from public.order_connections where is_test = p_test)
  ) into r;
  return r;
end $$;

create or replace function public.admin_restaurant_order_stats(p_restaurant_id uuid, p_test boolean default false)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  kst_day timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  with valid as (
    select o.* from public.orders o
     where o.restaurant_id = p_restaurant_id and o.is_test = p_test and o.ordered_at >= kst_day
       and o.is_valid
  )
  select jsonb_build_object(
    'connections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'provider', c.provider, 'vendor', c.vendor, 'status', c.status, 'ingest_mode', c.ingest_mode,
        'public_allowed', c.public_allowed, 'last_success_at', c.last_success_at, 'last_error', c.last_error,
        'last_error_at', c.last_error_at) order by c.provider)
      from public.order_connections c where c.restaurant_id = p_restaurant_id and c.is_test = p_test), '[]'::jsonb),
    'today_by_channel', coalesce((select jsonb_object_agg(channel, jsonb_build_object('count', cnt, 'net_amount', net, 'gross_amount', gross))
        from (select channel, count(*) cnt, sum(net_amount) net, sum(total_amount) gross from valid group by channel) x), '{}'::jsonb),
    'today_by_provider', coalesce((select jsonb_object_agg(provider, cnt)
        from (select provider, count(*) cnt from valid group by provider) x), '{}'::jsonb),
    'windows', (select jsonb_object_agg(w.k, (
                    select jsonb_object_agg(ch.channel,
                             (select count(*) from valid v where v.channel = ch.channel
                                 and v.ordered_at >= w.since and v.ordered_at < w.until))
                      from (values ('HALL'), ('DELIVERY'), ('PICKUP')) ch(channel)))
                  from (values ('10m', now() - interval '10 minutes', now() + interval '1 minute'),
                               ('30m', now() - interval '30 minutes', now() + interval '1 minute'),
                               ('60m', now() - interval '60 minutes', now() + interval '1 minute'),
                               -- 오늘 점심 11:00~14:00 (한국시간)
                               ('lunch', kst_day + interval '11 hours', kst_day + interval '14 hours')) w(k, since, until)),
    'menu_quantities', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'name', name, 'quantity', qty, 'matched', matched)
        order by channel, qty desc)
        from (select v.channel, coalesce(m.name, i.external_menu_name) as name, sum(i.quantity) qty, bool_or(i.menu_id is not null) matched
                from valid v join public.order_items i on i.order_id = v.id left join public.menus m on m.id = i.menu_id
               where i.match_status <> 'ignored'
               group by v.channel, coalesce(m.name, i.external_menu_name)) x), '[]'::jsonb),
    'cancelled_today', (select count(*) from public.orders o where o.restaurant_id = p_restaurant_id and o.is_test = p_test
                          and o.ordered_at >= kst_day and o.is_cancelled),
    'refund_today', (select coalesce(sum(refund_amount), 0) from public.orders o where o.restaurant_id = p_restaurant_id
                       and o.is_test = p_test and o.ordered_at >= kst_day),
    'needs_review', (select count(*) from public.orders o where o.restaurant_id = p_restaurant_id and o.is_test = p_test
                       and o.dedup_status = 'possible_duplicate')
  ) into r;
  return r;
end $$;
-- ───────── 매장별 최근 주문 활발도 (내부용, 원본에서 바로 계산) ─────────
-- p_scope: 'public' = 실제·공개 허용 연동만 / 'internal' = 실제 전체 / 'test' = 테스트 연동
-- freshness: 관련 연동이 하나도 없으면 'none', 모두 정상·최신이면 'fresh', 아니면 'delayed'
--   (웹훅은 주문이 있을 때만 들어오므로 '활성·오류 없음'이면 최신으로 본다)
-- 홀 순위에는 POS·CSV 연동만, 배달·포장에는 모든 제공처 연동을 쓴다 (주문 채널로 다시 거른다).
create or replace function public.restaurant_order_activity(p_ids uuid[], p_channel text, p_scope text)
returns table (
  restaurant_id uuid, freshness text, as_of timestamptz,
  c_primary integer, c_secondary integer, c10 integer, c30 integer, c60 integer, c_lunch integer, c_today integer,
  by_provider jsonb, top_menus jsonb, menu_qty integer, last_order_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with st as (select * from public.order_settings limit 1),
  bounds as (
    select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as day,
           now() - make_interval(mins => (select rank_primary_minutes from st)) as p_since,
           now() - make_interval(mins => (select rank_secondary_minutes from st)) as s_since
  ),
  conns as (
    select c.* from public.order_connections c
     where c.restaurant_id = any (p_ids)
       and c.is_test = (p_scope = 'test')
       and (p_scope <> 'public' or c.public_allowed)
       and c.status in ('active', 'error')
       and (p_channel <> 'HALL' or c.provider in ('pos', 'csv'))
  ),
  fresh as (
    select c.restaurant_id,
           bool_and(c.status = 'active' and not c.test_simulate_error
                    and (c.ingest_mode = 'webhook'
                         or c.last_success_at >= now() - make_interval(mins => coalesce(c.freshness_minutes, (select stale_after_minutes from st)))))
             as all_fresh,
           coalesce(min(c.last_success_at) filter (where c.ingest_mode <> 'webhook'), now()) as as_of
      from conns c
     group by c.restaurant_id
  ),
  v as (
    select o.id, o.restaurant_id, o.provider, o.ordered_at
      from public.orders o
      join conns c on c.id = o.connection_id
     where o.is_valid and o.channel = p_channel
       and o.ordered_at >= least((select day from bounds), now() - interval '180 minutes')
  ),
  counts as (
    select v.restaurant_id,
           count(*) filter (where v.ordered_at >= (select p_since from bounds))::int as c_primary,
           count(*) filter (where v.ordered_at >= (select s_since from bounds))::int as c_secondary,
           count(*) filter (where v.ordered_at >= now() - interval '10 minutes')::int as c10,
           count(*) filter (where v.ordered_at >= now() - interval '30 minutes')::int as c30,
           count(*) filter (where v.ordered_at >= now() - interval '60 minutes')::int as c60,
           count(*) filter (where v.ordered_at >= (select day from bounds) + interval '11 hours'
                              and v.ordered_at < (select day from bounds) + interval '14 hours')::int as c_lunch,
           count(*) filter (where v.ordered_at >= (select day from bounds))::int as c_today,
           max(v.ordered_at) as last_order_at
      from v group by v.restaurant_id
  ),
  providers as (
    select x.restaurant_id, jsonb_object_agg(x.provider, x.n) as by_provider
      from (select v.restaurant_id, v.provider, count(*) as n from v
             where v.ordered_at >= now() - interval '60 minutes' group by 1, 2) x
     group by x.restaurant_id
  ),
  menus as (
    -- 오늘 이 채널에서 내부 메뉴와 연결된 메뉴의 판매 수량 순위
    select y.restaurant_id,
           jsonb_agg(jsonb_build_object('menu_id', y.menu_id, 'name', y.name, 'quantity', y.qty)
                     order by y.qty desc, y.name) filter (where y.rn <= 3) as top_menus,
           sum(y.qty)::int as menu_qty
      from (
        select v.restaurant_id, i.menu_id, m.name, sum(i.quantity)::int as qty,
               row_number() over (partition by v.restaurant_id order by sum(i.quantity) desc, m.name) as rn
          from v
          join public.order_items i on i.order_id = v.id and i.match_status = 'matched'
          join public.menus m on m.id = i.menu_id
         where v.ordered_at >= (select day from bounds)
         group by v.restaurant_id, i.menu_id, m.name
      ) y
     group by y.restaurant_id
  )
  select f.restaurant_id,
         case when f.all_fresh then 'fresh' else 'delayed' end,
         f.as_of,
         coalesce(k.c_primary, 0), coalesce(k.c_secondary, 0), coalesce(k.c10, 0), coalesce(k.c30, 0),
         coalesce(k.c60, 0), coalesce(k.c_lunch, 0), coalesce(k.c_today, 0),
         coalesce(p.by_provider, '{}'::jsonb), coalesce(m.top_menus, '[]'::jsonb), coalesce(m.menu_qty, 0),
         k.last_order_at
    from fresh f
    left join counts k on k.restaurant_id = f.restaurant_id
    left join providers p on p.restaurant_id = f.restaurant_id
    left join menus m on m.restaurant_id = f.restaurant_id
$$;

-- ───────── 소비자 공개용 활발도 (5단계 함수를 대체) ─────────
-- status: active(최근 주문 확인) / none_recent(최근 주문 없음) / delayed(데이터 갱신 지연)
--         연동이 없으면 행이 없다 → 화면에서 '주문정보 없음'
-- 최소 공개 건수 미만인 건수·순위 값은 내보내지 않는다.
create or replace function public.public_order_activity(p_ids uuid[], p_channel text, p_include_test boolean default false)
returns table (restaurant_id uuid, activity jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  st public.order_settings;
  v_scope text := case when p_include_test and public.is_admin() then 'test' else 'public' end;
begin
  select * into st from public.order_settings limit 1;
  return query
  select a.restaurant_id,
         jsonb_build_object(
           'scope', v_scope,
           'status', case when a.freshness <> 'fresh' then 'delayed'
                          when a.c_secondary > 0 then 'active' else 'none_recent' end,
           'as_of', a.as_of,
           'primary_minutes', st.rank_primary_minutes,
           'secondary_minutes', st.rank_secondary_minutes,
           'rank_primary', case when a.freshness = 'fresh' and a.c_primary >= st.min_public_count then a.c_primary else 0 end,
           'rank_secondary', case when a.freshness = 'fresh' and a.c_secondary >= st.min_public_count then a.c_secondary else 0 end,
           'windows', case when a.freshness = 'fresh' then jsonb_strip_nulls(jsonb_build_object(
                         '10m', case when a.c10 >= st.min_public_count then a.c10 end,
                         '30m', case when a.c30 >= st.min_public_count then a.c30 end,
                         '60m', case when a.c60 >= st.min_public_count then a.c60 end,
                         'lunch', case when a.c_lunch >= st.min_public_count then a.c_lunch end)) else '{}'::jsonb end,
           -- 제공처는 이름만 (건수 비공개)
           'providers', case when a.freshness = 'fresh' and a.c60 >= st.min_public_count
                             then (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(a.by_provider) k)
                             else '[]'::jsonb end,
           -- 인기메뉴: 판매 기록이 충분할 때만, 순서만 (수량 비공개)
           'top_menus', case when a.c_today >= st.min_public_count and a.menu_qty >= st.min_public_count
                             then (select coalesce(jsonb_agg(jsonb_build_object('menu_id', t ->> 'menu_id', 'name', t ->> 'name')), '[]'::jsonb)
                                     from jsonb_array_elements(a.top_menus) t)
                             else '[]'::jsonb end)
    from public.restaurant_order_activity(p_ids, p_channel, v_scope) a
    join public.restaurants r
      on r.id = a.restaurant_id and r.is_public and r.business_status = 'open' and r.coord_status = 'valid';
end $$;

-- 화면 새로고침 간격 (소비자 앱이 읽는 공개 설정)
create or replace function public.public_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('refresh_interval_seconds', refresh_interval_seconds) from public.order_settings limit 1
$$;

-- ───────── 검색 + 정렬 ─────────
-- p_sort 'popular': [공개·최신 데이터 매장] 순위값(1차 창) ↓, 순위값(2차 창) ↓, 거리 ↑  →  [나머지] 거리 ↑
-- p_sort 'distance': 거리 ↑
drop function if exists public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean);
-- 다시 실행할 때(8단계 이후) 반환 열이 달라진 같은 이름 함수도 지운다
drop function if exists public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean, text);
create or replace function public.search_restaurants(
  p_lat double precision,
  p_lng double precision,
  p_mode text,
  p_radius_m integer default 100,
  p_category text default null,
  p_keyword text default null,
  p_limit integer default 100,
  p_include_test boolean default false,
  p_sort text default 'popular'
)
returns table (
  id uuid,
  name text,
  category text,
  road_address text,
  lot_address text,
  lat double precision,
  lng double precision,
  distance_m integer,
  dine_in public.channel_status,
  delivery public.channel_status,
  takeout public.channel_status,
  delivery_radius_m integer,
  last_verified_at date,
  updated_at timestamptz,
  menus jsonb,
  activity jsonb,
  delivery_fee_krw integer,
  delivery_eta_minutes integer,
  baemin_order_url text,
  coupangeats_order_url text,
  rank_group integer
)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  origin extensions.geography;
  search_m integer;
  kw text := nullif(btrim(coalesce(p_keyword, '')), '');
  ch text := case p_mode when 'walk' then 'HALL' when 'takeout' then 'PICKUP' else 'DELIVERY' end;
begin
  if p_lat is null or p_lng is null or p_lat not between 33 and 38.7 or p_lng not between 124.5 and 132 then
    raise exception 'invalid origin' using errcode = '22023';
  end if;
  if p_mode not in ('walk', 'takeout', 'delivery') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_mode in ('walk', 'takeout') and p_radius_m not in (100, 200, 300) then
    raise exception 'radius must be 100, 200 or 300' using errcode = '22023';
  end if;
  if p_sort not in ('popular', 'distance') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  origin := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  search_m := case when p_mode = 'delivery' then 10000 else p_radius_m end;

  return query
  with found as (
    select r.id, r.name, r.category, r.road_address, r.lot_address, r.lat, r.lng,
           round(st_distance(r.geog, origin))::integer as distance_m,
           r.dine_in, r.delivery, r.takeout, r.delivery_radius_m, r.last_verified_at, r.updated_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id, 'name', m.name, 'is_signature', m.is_signature,
                      'price_dine_in', m.price_dine_in, 'price_delivery', m.price_delivery,
                      'price_takeout', m.price_takeout, 'price_verified_at', m.price_verified_at)
                    order by m.is_signature desc, m.sort_order, m.name)
               from public.menus m
              where m.restaurant_id = r.id and m.is_public and m.is_available
           ), '[]'::jsonb) as menus,
           r.delivery_fee_krw, r.delivery_eta_minutes, r.baemin_order_url, r.coupangeats_order_url
      from public.restaurants r
     where st_dwithin(r.geog, origin, search_m)
       and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
       and case p_mode
             when 'walk' then r.dine_in <> 'no'
             when 'takeout' then r.takeout <> 'no'
             else r.delivery = 'yes' and r.delivery_radius_m is not null
                  and st_dwithin(r.geog, origin, r.delivery_radius_m)
           end
       and (p_category is null or r.category = p_category)
       and (kw is null or r.name ilike '%' || kw || '%' or r.category ilike '%' || kw || '%'
            or exists (select 1 from public.menus m2
                        where m2.restaurant_id = r.id and m2.is_public and m2.name ilike '%' || kw || '%'))
     order by distance_m, r.name
     limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ),
  ranked as (
    select f.*, act.activity,
           case when act.activity ->> 'status' in ('active', 'none_recent') then 0 else 1 end as rank_group
      from found f
      left join public.public_order_activity((select array_agg(f2.id) from found f2), ch, p_include_test) act
        on act.restaurant_id = f.id
  )
  select x.id, x.name, x.category, x.road_address, x.lot_address, x.lat, x.lng, x.distance_m,
         x.dine_in, x.delivery, x.takeout, x.delivery_radius_m, x.last_verified_at, x.updated_at, x.menus,
         x.activity, x.delivery_fee_krw, x.delivery_eta_minutes, x.baemin_order_url, x.coupangeats_order_url,
         x.rank_group
    from ranked x
   order by case when p_sort = 'popular' then x.rank_group else 0 end,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_primary')::int end desc nulls last,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_secondary')::int end desc nulls last,
            -- 포장: 같은 순위 안에서는 포장 운영이 확인된 매장을 미확인보다 먼저
            case when p_sort = 'popular' and p_mode = 'takeout' and x.takeout <> 'yes' then 1 else 0 end,
            x.distance_m, x.name;
end $$;

-- ───────── 관리자: 지역별 인기 음식점 ─────────
-- 관리자는 정확한 건수를 본다 (최소 공개 건수 미적용). p_region_id null = 전체 지역
create or replace function public.admin_popular_restaurants(p_region_id text, p_channel text, p_test boolean default false)
returns table (
  restaurant_id uuid, name text, region_id text, is_public boolean, freshness text, as_of timestamptz,
  c_primary integer, c_secondary integer, c10 integer, c30 integer, c60 integer, c_lunch integer, c_today integer,
  by_provider jsonb, top_menus jsonb, last_order_at timestamptz, connections jsonb, public_rank_allowed boolean
)
language plpgsql
stable
security definer  -- 내부 집계 함수를 쓰므로 소유자 권한, 대신 맨 앞에서 관리자 확인
set search_path = public, pg_temp
as $$
declare ids uuid[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_channel not in ('HALL', 'DELIVERY', 'PICKUP') then raise exception 'invalid channel'; end if;
  select array_agg(r.id) into ids from public.restaurants r where p_region_id is null or r.region_id = p_region_id;
  return query
  select r.id, r.name, r.region_id, r.is_public,
         coalesce(a.freshness, 'none'), a.as_of,
         coalesce(a.c_primary, 0), coalesce(a.c_secondary, 0), coalesce(a.c10, 0), coalesce(a.c30, 0),
         coalesce(a.c60, 0), coalesce(a.c_lunch, 0), coalesce(a.c_today, 0),
         coalesce(a.by_provider, '{}'::jsonb), coalesce(a.top_menus, '[]'::jsonb), a.last_order_at,
         coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider, 'status', c.status,
                                                       'public_allowed', c.public_allowed, 'last_success_at', c.last_success_at)
                                    order by c.provider)
                     from public.order_connections c where c.restaurant_id = r.id and c.is_test = p_test), '[]'::jsonb),
         -- 소비자 순위에 반영될 수 있는지: 실제·공개 허용 연동이 최신이고 매장이 공개 중
         (not p_test and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
          and exists (select 1 from public.restaurant_order_activity(array[r.id], p_channel, 'public') pa where pa.freshness = 'fresh'))
    from public.restaurants r
    left join public.restaurant_order_activity(ids, p_channel, case when p_test then 'test' else 'internal' end) a
      on a.restaurant_id = r.id
   where r.id = any (ids)
   order by case when a.freshness = 'fresh' then 0 when a.freshness = 'delayed' then 1 else 2 end,
            coalesce(a.c_primary, 0) desc, coalesce(a.c_secondary, 0) desc, r.name;
end $$;

-- ───────── 권한 ─────────
revoke execute on function public.restaurant_order_activity(uuid[], text, text) from public, anon, authenticated;
grant execute on function public.public_order_activity(uuid[], text, boolean) to anon, authenticated;
grant execute on function public.public_app_settings() to anon, authenticated;
grant execute on function public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean, text)
  to anon, authenticated;
revoke execute on function public.admin_popular_restaurants(text, text, boolean) from public, anon;
grant execute on function public.admin_popular_restaurants(text, text, boolean) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.restaurant_order_activity(uuid[], text, text) to service_role;
  end if;
end $$;
