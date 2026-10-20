-- 8단계: 시범 서비스 준비 — 운영 설정·이용 통계·관리 작업 이력·데이터 점검·지역별 공개 범위
-- 기존 데이터는 지우지 않는다. 새 열은 모두 기본값이 있어 현재 동작을 바꾸지 않는다.

-- ───────── 운영 설정 (관리자가 바꾸는 서비스 스위치) ─────────
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  notice_message text check (length(notice_message) <= 200),   -- 소비자 화면 상단 점검·공지 (없으면 표시 안 함)
  live_orders_public boolean not null default true,              -- false면 소비자 화면에 주문 활발도를 보여주지 않음 (거리순 검색은 유지)
  collection_paused boolean not null default false,              -- true면 실제 주문 수집·외부 API 호출 중지
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- 지역별 공개 범위: 음식점 검색 / 실시간 인기매장 (사업자 상권 분석은 market_areas.business_visible)
alter table public.regions
  add column if not exists search_public boolean not null default true,
  add column if not exists live_public boolean not null default true;

-- 데이터 제공처가 알려준 '여기까지의 주문이 반영됨' 시각. 호출 성공 시각과 따로 본다
alter table public.order_connections
  add column if not exists provider_as_of timestamptz;

-- ───────── 이용 통계 (개인 위치·개인 식별정보 없이) ─────────
-- visitor_id: 기기에 저장한 임의 ID (이용자 수), session_id: 탭마다 새로 만든 임의 ID (세션 수)
-- area_id: 기기에서 가까운 시범 지역만 계산해 보낸 값. 좌표는 보내지도 저장하지도 않는다.
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  session_id uuid not null,
  event text not null check (event in ('visit', 'search', 'detail_view', 'find_route', 'install', 'gps_denied', 'gps_error', 'error')),
  mode text check (mode in ('walk', 'delivery', 'takeout')),
  area_id text check (area_id ~ '^[a-z0-9_]{1,40}$'),
  is_test boolean not null default false,
  detail text check (length(detail) <= 60)
);
create index if not exists usage_events_time_idx on public.usage_events (created_at);
create index if not exists usage_events_visitor_idx on public.usage_events (visitor_id, created_at);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;

-- 기록: 같은 기기에서 1분에 60건이 넘으면 버린다 (비정상 사용 방지). 180일 지난 기록은 가끔 지운다.
create or replace function public.log_usage(p_visitor uuid, p_session uuid, p_event text, p_mode text default null,
                                            p_area text default null, p_test boolean default false, p_detail text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_visitor is null or p_session is null then return false; end if;
  if (select count(*) from public.usage_events
       where visitor_id = p_visitor and created_at > now() - interval '1 minute') >= 60 then
    return false;
  end if;
  insert into public.usage_events (visitor_id, session_id, event, mode, area_id, is_test, detail)
  values (p_visitor, p_session, p_event, p_mode, nullif(p_area, ''), coalesce(p_test, false), left(p_detail, 60));
  if random() < 0.01 then
    delete from public.usage_events where created_at < now() - interval '180 days';
  end if;
  return true;
exception when check_violation then
  return false;  -- 알 수 없는 값은 조용히 버린다
end $$;

create or replace function public.admin_usage_overview(p_day date default null, p_include_test boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d date := coalesce(p_day, public.kst_day(now()));
  t0 timestamptz := (d::timestamp at time zone 'Asia/Seoul');
  t1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Seoul');
  r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  with e as (select * from public.usage_events where created_at >= t0 and created_at < t1 and (p_include_test or not is_test))
  select jsonb_build_object(
    'day', d,
    'visitors', (select count(distinct visitor_id) from e),
    'sessions', (select count(distinct session_id) from e),
    'searches', (select count(*) from e where event = 'search'),
    'searches_by_mode', (select coalesce(jsonb_object_agg(mode, n), '{}'::jsonb)
                           from (select mode, count(*) n from e where event = 'search' and mode is not null group by mode) x),
    'detail_views', (select count(*) from e where event = 'detail_view'),
    'find_route', (select count(*) from e where event = 'find_route'),
    'installs', (select count(*) from e where event = 'install'),
    'gps_denied', (select count(*) from e where event = 'gps_denied'),
    'gps_error', (select count(*) from e where event = 'gps_error'),
    'errors', (select count(*) from e where event = 'error'),
    'error_details', (select coalesce(jsonb_agg(jsonb_build_object('detail', detail, 'count', n) order by n desc), '[]'::jsonb)
                        from (select coalesce(detail, '(내용 없음)') detail, count(*) n from e where event = 'error' group by 1 limit 10) x),
    'by_area', (select coalesce(jsonb_agg(jsonb_build_object('area', area, 'visitors', v, 'searches', s) order by s desc, area), '[]'::jsonb)
                  from (select coalesce(area_id, 'unknown') area, count(distinct visitor_id) v, count(*) filter (where event = 'search') s
                          from e group by 1) x),
    'by_hour', (select jsonb_agg(jsonb_build_object('hour', h,
                  'searches', (select count(*) from e where event = 'search' and extract(hour from created_at at time zone 'Asia/Seoul') = h),
                  'visitors', (select count(distinct visitor_id) from e where extract(hour from created_at at time zone 'Asia/Seoul') = h)) order by h)
                  from generate_series(0, 23) h),
    'last7', (select jsonb_agg(jsonb_build_object('day', dd,
                'visitors', (select count(distinct visitor_id) from public.usage_events u
                              where u.created_at >= (dd::timestamp at time zone 'Asia/Seoul') and u.created_at < ((dd + 1)::timestamp at time zone 'Asia/Seoul')
                                and (p_include_test or not u.is_test)),
                'searches', (select count(*) from public.usage_events u
                              where u.event = 'search' and u.created_at >= (dd::timestamp at time zone 'Asia/Seoul')
                                and u.created_at < ((dd + 1)::timestamp at time zone 'Asia/Seoul') and (p_include_test or not u.is_test))) order by dd)
                from generate_series(d - 6, d, interval '1 day') g(x), lateral (select x::date dd) y)
  ) into r;
  return r;
end $$;

-- ───────── 서버·API 현황 ─────────
create or replace function public.admin_system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  month_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'checked_at', now(),
    'db_size_bytes', pg_database_size(current_database()),
    'tables', (select jsonb_agg(jsonb_build_object('table', t, 'bytes', pg_total_relation_size(('public.' || t)::regclass),
                                                    'rows', (select reltuples::bigint from pg_class where oid = ('public.' || t)::regclass))
                                order by pg_total_relation_size(('public.' || t)::regclass) desc)
                 from unnest(array['restaurants', 'menus', 'orders', 'order_items', 'usage_events', 'market_order_stats',
                                   'market_menu_stats', 'admin_audit_log']) t),
    'usage_24h', (select count(*) from public.usage_events where created_at > now() - interval '1 day'),
    'connections', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'status', status, 'count', n) order by provider, status), '[]'::jsonb)
                      from (select provider, status, count(*) n from public.order_connections where not is_test group by 1, 2) x),
    'api_calls_month', (select coalesce(sum(calls_this_month) filter (where calls_month = month_now), 0) from public.order_connections where not is_test),
    'api_cost_month_krw', (select coalesce(sum(calls_this_month * unit_cost_krw) filter (where calls_month = month_now), 0)
                             from public.order_connections where not is_test),
    'monthly_budget_krw', (select monthly_budget_krw from public.order_settings),
    'last_success_at', (select max(last_success_at) from public.order_connections where not is_test),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('restaurant', r.name, 'provider', c.provider, 'error', c.last_error,
                                                            'at', c.last_error_at) order by c.last_error_at desc), '[]'::jsonb)
                 from public.order_connections c join public.restaurants r on r.id = c.restaurant_id
                where not c.is_test and c.last_error is not null and c.last_error_at > now() - interval '7 days'),
    'settings', (select to_jsonb(s) - 'id' from public.app_settings s)
  );
end $$;

-- ───────── 관리 작업 이력 ─────────
-- 문장 단위로 한 줄씩 남긴다 (CSV 대량 반영도 한 줄). 바뀐 값 자체는 저장하지 않는다 (민감정보 보호)
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                                   -- 작업한 계정 (서버 작업이면 null)
  table_name text not null,
  op text not null,
  row_count integer not null,
  sample_keys text[] not null default '{}'      -- 처음 몇 개 행의 식별자
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_read on public.admin_audit_log;
create policy admin_audit_log_read on public.admin_audit_log for select to authenticated using (public.is_admin());
revoke all on public.admin_audit_log from anon;
revoke insert, update, delete on public.admin_audit_log from authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function public.audit_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
  keys text[];
begin
  if tg_op = 'DELETE' then
    select count(*), (array_agg(coalesce(to_jsonb(o) ->> 'id', to_jsonb(o) ->> 'user_id', to_jsonb(o) ->> 'restaurant_id', '-')))[1:5]
      into n, keys from old_rows o;
  else
    select count(*), (array_agg(coalesce(to_jsonb(x) ->> 'id', to_jsonb(x) ->> 'user_id', to_jsonb(x) ->> 'restaurant_id', '-')))[1:5]
      into n, keys from new_rows x;
  end if;
  if n > 0 then
    insert into public.admin_audit_log (actor, table_name, op, row_count, sample_keys)
    values (auth.uid(), tg_table_name, tg_op, n, coalesce(keys, '{}'));
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['restaurants', 'menus', 'order_connections', 'order_settings', 'market_areas', 'market_settings',
                           'market_public_data', 'business_users', 'admin_users', 'app_settings', 'regions', 'menu_aliases'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit_ins', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit_upd', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit_del', t);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.audit_statement()', t || '_audit_ins', t);
    execute format('create trigger %I after update on public.%I referencing new table as new_rows for each statement execute function public.audit_statement()', t || '_audit_upd', t);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.audit_statement()', t || '_audit_del', t);
  end loop;
end $$;

-- ───────── 운영 설정 표 권한 ─────────
alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.app_settings from anon;
grant select, update on public.app_settings to authenticated;
-- 지역 공개 범위는 관리자만 바꾼다 (읽기는 4단계대로 공개)
drop policy if exists regions_admin_write on public.regions;
create policy regions_admin_write on public.regions for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (search_public, live_public, is_active) on public.regions to authenticated;

-- 수집 일시중지 중에는 실제 주문을 받지 않는다 (테스트 주문은 받음)
create or replace function public.orders_collection_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not new.is_test and (select collection_paused from public.app_settings) then
    raise exception '주문 수집이 일시중지된 상태예요' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists orders_collection_guard on public.orders;
create trigger orders_collection_guard before insert on public.orders
  for each row execute function public.orders_collection_guard();

-- 데이터 제공처의 주문 기준시각 기록 (웹훅·조회 모듈이 서버에서 부른다)
create or replace function public.report_connection_as_of(p_connection_id uuid, p_as_of timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin_or_service();
  if p_as_of > now() + interval '5 minutes' then raise exception 'as_of is in the future'; end if;
  update public.order_connections set provider_as_of = greatest(coalesce(provider_as_of, p_as_of), p_as_of) where id = p_connection_id;
end $$;

-- ───────── 데이터 점검 (지역별 서비스 가능·메뉴정보·실시간 인기매장 준비 상태) ─────────
create or replace function public.admin_data_quality()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare stale integer := (select stale_after_minutes from public.order_settings);
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'region_id', g.id, 'region', g.name, 'search_public', g.search_public, 'live_public', g.live_public,
      'total', x.total, 'public', x.pub, 'open', x.open_n, 'not_open', x.not_open, 'coord_problem', x.coord_problem,
      'needs_review', x.needs_review, 'unverified', x.unverified, 'no_verified_date', x.no_date,
      'category_other', x.cat_other, 'channel_unknown', x.ch_unknown,
      'without_menu', x.without_menu, 'menu_ready', x.menu_ready, 'price_unverified', x.price_unverified,
      'possible_duplicates', x.dups, 'live_ready', x.live_ready,
      -- 서비스 상태: 검색 = 공개·좌표 정상 매장이 있음, 메뉴정보 = 가격이 확인된 메뉴가 있는 매장이 있음, 실시간 = 공개 허용·최신 연동 매장이 있음
      'search_ready', x.searchable > 0, 'searchable', x.searchable
    ) order by g.id), '[]'::jsonb)
      from public.regions g
      cross join lateral (
        select count(*) total,
               count(*) filter (where r.is_public) pub,
               count(*) filter (where r.business_status = 'open') open_n,
               count(*) filter (where r.business_status <> 'open') not_open,
               count(*) filter (where r.coord_status <> 'valid') coord_problem,
               count(*) filter (where r.verify_status = 'needs_review') needs_review,
               count(*) filter (where r.verify_status = 'unverified') unverified,
               count(*) filter (where r.is_public and r.last_verified_at is null) no_date,
               count(*) filter (where r.category = '기타') cat_other,
               count(*) filter (where r.is_public and (r.dine_in = 'unknown' or r.takeout = 'unknown' or r.delivery = 'unknown')) ch_unknown,
               count(*) filter (where r.is_public and not exists (select 1 from public.menus m where m.restaurant_id = r.id and m.is_public)) without_menu,
               count(*) filter (where r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
                                  and exists (select 1 from public.menus m where m.restaurant_id = r.id and m.is_public and m.is_available
                                                and coalesce(m.price_dine_in, m.price_delivery, m.price_takeout) is not null)) menu_ready,
               count(*) filter (where exists (select 1 from public.menus m where m.restaurant_id = r.id and m.is_public
                                                and coalesce(m.price_dine_in, m.price_delivery, m.price_takeout) is not null
                                                and m.price_verified_at is null)) price_unverified,
               count(*) filter (where r.is_public and exists (
                 select 1 from public.restaurants r2
                  where r2.id <> r.id and r2.is_public and public.norm_menu_name(r2.name) = public.norm_menu_name(r.name)
                    and st_dwithin(r2.geog, r.geog, 50))) dups,
               count(*) filter (where r.is_public and r.business_status = 'open' and r.coord_status = 'valid') searchable,
               count(*) filter (where r.is_public and exists (
                 select 1 from public.order_connections c where c.restaurant_id = r.id and not c.is_test and c.public_allowed
                    and c.status = 'active' and (c.ingest_mode = 'webhook' or c.last_success_at >= now() - make_interval(mins => coalesce(c.freshness_minutes, stale)))
               )) live_ready
          from public.restaurants r where r.region_id = g.id) x
  );
end $$;

-- 소비자 공개 설정: 새로고침 간격 + 공지 + 주문 활발도 표시 여부
create or replace function public.public_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'refresh_interval_seconds', (select refresh_interval_seconds from public.order_settings limit 1),
    'notice', (select notice_message from public.app_settings),
    'live_orders_public', (select live_orders_public from public.app_settings))
$$;

-- ───────── 6단계 함수 갱신: 제공처 기준시각·수집 일시중지 반영 ─────────
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
                         or c.last_success_at >= now() - make_interval(mins => coalesce(c.freshness_minutes, (select stale_after_minutes from st))))
                    -- 8단계: 제공처가 알려준 주문 기준시각도 최신이어야 한다 (호출 성공만으로는 최신이 아님)
                    and (c.provider_as_of is null
                         or c.provider_as_of >= now() - make_interval(mins => coalesce(c.freshness_minutes, (select stale_after_minutes from st))))
                    -- 수집 일시중지 중에는 실제 연동을 최신으로 보지 않는다
                    and (c.is_test or not (select collection_paused from public.app_settings)))
             as all_fresh,
           coalesce(least(min(c.last_success_at) filter (where c.ingest_mode <> 'webhook'), min(c.provider_as_of)), now()) as as_of
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

-- ───────── 6단계 함수 갱신: 실시간 표시 중지·지역별 공개 반영 ─────────
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
  -- 8단계: 관리자가 실시간 표시를 멈추면 집계를 아예 하지 않는다 (주문 집계에 문제가 있어도 거리순 검색은 유지)
  if v_scope <> 'test' and not (select live_orders_public from public.app_settings) then return; end if;
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
      on r.id = a.restaurant_id and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
    left join public.regions g on g.id = r.region_id
   -- 8단계: 관리자가 실시간 표시를 멈췄거나 그 지역의 실시간 인기매장을 공개하지 않으면 내보내지 않는다 (테스트 보기는 관리자만)
   where v_scope = 'test'
      or ((select live_orders_public from public.app_settings) and coalesce(g.live_public, true));
end $$;

-- ───────── 검색: 지역 공개 범위 + 정보 확인 상태 ─────────
drop function if exists public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean, text);
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
  rank_group integer,
  verify_status public.verify_status
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
           r.delivery_fee_krw, r.delivery_eta_minutes, r.baemin_order_url, r.coupangeats_order_url, r.verify_status
      from public.restaurants r
      left join public.regions g on g.id = r.region_id
     where st_dwithin(r.geog, origin, search_m)
       and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
       -- 8단계: 아직 공개하지 않은 지역은 관리자만 검색 (시범 공개 범위)
       and (coalesce(g.search_public, true) or public.is_admin())
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
         x.rank_group, x.verify_status
    from ranked x
   order by case when p_sort = 'popular' then x.rank_group else 0 end,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_primary')::int end desc nulls last,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_secondary')::int end desc nulls last,
            -- 포장: 같은 순위 안에서는 포장 운영이 확인된 매장을 미확인보다 먼저
            case when p_sort = 'popular' and p_mode = 'takeout' and x.takeout <> 'yes' then 1 else 0 end,
            x.distance_m, x.name;
end $$;

-- ───────── 5단계 함수 갱신: 수집 일시중지면 외부 API 호출 예약을 거절 ─────────
create or replace function public.reserve_api_calls(p_connection_id uuid, p_calls integer default 1)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.order_connections;
  month_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  used integer;
  budget integer := (select monthly_budget_krw from public.order_settings);
  month_cost numeric;
begin
  perform public.assert_admin_or_service();
  select * into c from public.order_connections where id = p_connection_id for update;
  if not found or c.is_test or c.status <> 'active' then return false; end if;
  -- 8단계: 관리자가 수집을 일시중지하면 외부 API를 부르지 않는다
  if (select collection_paused from public.app_settings) then return false; end if;
  used := case when c.calls_month = month_now then c.calls_this_month else 0 end;
  select coalesce(sum(case when x.calls_month = month_now then x.calls_this_month else 0 end * x.unit_cost_krw), 0)
    into month_cost from public.order_connections x where not x.is_test;
  if (c.monthly_call_limit is not null and used + p_calls > c.monthly_call_limit)
     or (c.unit_cost_krw > 0 and month_cost + c.unit_cost_krw * p_calls > budget) then
    update public.order_connections
       set status = 'paused', last_error = '요금·호출 한도 초과로 추가 호출을 중지했어요', last_error_at = now()
     where id = c.id;
    return false;
  end if;
  update public.order_connections
     set calls_month = month_now, calls_this_month = used + p_calls, last_attempt_at = now()
   where id = c.id;
  return true;
end $$;

-- ───────── 권한 ─────────
revoke execute on function public.restaurant_order_activity(uuid[], text, text) from public, anon, authenticated;
grant execute on function public.public_order_activity(uuid[], text, boolean) to anon, authenticated;
grant execute on function public.public_app_settings() to anon, authenticated;
grant execute on function public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean, text)
  to anon, authenticated;
revoke execute on function public.log_usage(uuid, uuid, text, text, text, boolean, text) from public;
grant execute on function public.log_usage(uuid, uuid, text, text, text, boolean, text) to anon, authenticated;
revoke execute on function public.admin_usage_overview(date, boolean) from public, anon;
grant execute on function public.admin_usage_overview(date, boolean) to authenticated;
revoke execute on function public.admin_system_status() from public, anon;
grant execute on function public.admin_system_status() to authenticated;
revoke execute on function public.admin_data_quality() from public, anon;
grant execute on function public.admin_data_quality() to authenticated;
revoke execute on function public.report_connection_as_of(uuid, timestamptz) from public, anon;
grant execute on function public.report_connection_as_of(uuid, timestamptz) to authenticated;
revoke execute on function public.reserve_api_calls(uuid, integer) from public, anon;
grant execute on function public.reserve_api_calls(uuid, integer) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.restaurant_order_activity(uuid[], text, text) to service_role;
    grant execute on function public.report_connection_as_of(uuid, timestamptz) to service_role;
    grant execute on function public.reserve_api_calls(uuid, integer) to service_role;
  end if;
end $$;
