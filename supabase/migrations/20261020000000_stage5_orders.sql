-- 점심뭐먹 5단계: 주문 데이터 수집 (홀 POS · 배달의민족 · 쿠팡이츠 · 포장)
-- 4단계 스키마(restaurants·menus·is_admin)를 그대로 확장한다. 새 DB를 만들지 않는다.
--
-- 원칙
-- - 개인정보(이름·전화번호·상세주소·결제수단)는 저장할 열 자체가 없다.
-- - API 인증정보는 DB에 저장하지 않는다 (Edge Function 비밀값 이름만 credential_ref에 둔다).
-- - 소비자는 주문 원본(orders·order_items)을 읽을 수 없고, 최소 공개 건수 이상인 공개 허용 집계만 본다.
-- - 테스트 주문(is_test)은 실제 주문과 같은 표에 있어도 집계·공개 범위가 완전히 분리된다.
-- - 시각은 timestamptz(UTC)로 저장하고, 오늘·점심(11:00~14:00) 경계는 Asia/Seoul로 계산한다.

-- ───────────────────────── 설정 ─────────────────────────
create table if not exists public.order_settings (
  id boolean primary key default true check (id),
  min_public_count integer not null default 5 check (min_public_count >= 1),   -- 소비자 공개 최소 건수
  monthly_budget_krw integer not null default 0 check (monthly_budget_krw >= 0), -- 0 = 유료 호출 금지
  stale_after_minutes integer not null default 15 check (stale_after_minutes between 5 and 180),
  updated_at timestamptz not null default now()
);
insert into public.order_settings (id) values (true) on conflict (id) do nothing;
alter table public.order_settings enable row level security;

-- ───────────────────────── 연동 ─────────────────────────
create table if not exists public.order_connections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  provider text not null check (provider in ('pos', 'baemin', 'coupangeats', 'csv')),
  vendor text,                                  -- 예: 하이픈, OKPOS, 직접 CSV
  external_store_id text,                       -- 제공처의 매장 식별자
  ingest_mode text not null default 'file' check (ingest_mode in ('webhook', 'polling', 'file')),
  status text not null default 'preparing'
    check (status in ('preparing', 'pending_approval', 'active', 'paused', 'error')),
  store_consent boolean not null default false,         -- 매장 동의
  provider_permission boolean not null default false,   -- 데이터 제공업체 사용 허락
  public_allowed boolean not null default false,        -- 제3자(소비자) 공개·재사용 허용
  is_test boolean not null default false,
  test_simulate_error boolean not null default false,   -- 테스트 연동: API 오류 상황 시험
  credential_ref text,                                  -- 서버 비밀값 이름만 (값은 DB에 두지 않는다)
  unit_cost_krw numeric(10, 2) not null default 0 check (unit_cost_krw >= 0),  -- 호출 1회 예상 비용
  monthly_call_limit integer check (monthly_call_limit >= 0),
  calls_month text,                                     -- 'YYYY-MM' (한국시간)
  calls_this_month integer not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, provider, is_test),
  -- 실제 연동은 매장 동의와 제공업체 허락이 모두 있어야 활성화할 수 있다
  constraint active_needs_consent check (is_test or status <> 'active' or (store_consent and provider_permission))
);
create index if not exists order_connections_restaurant_idx on public.order_connections (restaurant_id);
alter table public.order_connections enable row level security;

-- ───────────────────────── 주문 ─────────────────────────
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),               -- 내부 주문 ID
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  connection_id uuid not null references public.order_connections (id) on delete cascade,
  provider text not null check (provider in ('pos', 'baemin', 'coupangeats', 'csv')),  -- 데이터 제공처
  external_order_id text not null check (length(btrim(external_order_id)) > 0),
  link_key text,                                               -- POS↔배달앱 동일 주문 연결번호
  channel text not null check (channel in ('HALL', 'DELIVERY', 'PICKUP', 'UNKNOWN')),
  ordered_at timestamptz not null,
  paid_at timestamptz,
  total_amount integer not null check (total_amount >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  refund_amount integer not null default 0 check (refund_amount >= 0),
  net_amount integer generated always as (greatest(total_amount - discount_amount - refund_amount, 0)) stored,  -- 실제 집계금액
  order_status text not null default 'unknown'
    check (order_status in ('accepted', 'completed', 'cancelled', 'pending', 'unknown')),
  payment_status text not null default 'unknown'
    check (payment_status in ('paid', 'unpaid', 'refunded', 'partially_refunded', 'unknown')),
  is_cancelled boolean not null default false,
  dedup_status text not null default 'unique' check (dedup_status in ('unique', 'merged', 'possible_duplicate')),
  merged_into uuid references public.orders (id) on delete set null,   -- 통합된 경우 대표 주문
  duplicate_of uuid references public.orders (id) on delete set null,  -- 중복 의심 상대 주문
  is_test boolean not null default false,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, restaurant_id, external_order_id, is_test)
);
create index if not exists orders_restaurant_time_idx on public.orders (restaurant_id, is_test, ordered_at desc);
create index if not exists orders_link_idx on public.orders (restaurant_id, link_key) where link_key is not null;
create index if not exists orders_review_idx on public.orders (dedup_status) where dedup_status = 'possible_duplicate';
alter table public.orders enable row level security;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid references public.menus (id) on delete set null,       -- 내부 메뉴와 연결된 경우
  external_menu_name text not null check (length(btrim(external_menu_name)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price integer check (unit_price >= 0),
  line_amount integer check (line_amount >= 0),
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'ignored'))
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_unmatched_idx on public.order_items (restaurant_id) where match_status = 'unmatched';
alter table public.order_items enable row level security;

-- 외부 메뉴명 ↔ 내부 메뉴 연결 (관리자가 확인한 것). menu_id가 null이면 '집계 제외'
create table if not exists public.menu_aliases (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  external_name_norm text not null,
  menu_id uuid references public.menus (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, external_name_norm)
);
alter table public.menu_aliases enable row level security;

-- ───────────────────────── 매장별 주문 집계 ─────────────────────────
-- scope: public(공개 허용·실제) / internal(실제 전체, 관리자 분석용) / test(테스트 주문)
create table if not exists public.order_aggregates (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  scope text not null check (scope in ('public', 'internal', 'test')),
  window_key text not null check (window_key in ('10m', '30m', '60m', 'lunch', 'today')),
  channel text not null check (channel in ('HALL', 'DELIVERY', 'PICKUP', 'UNKNOWN')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  order_count integer not null,                   -- 유효 주문 건수 (취소·중복 의심·통합된 주문 제외)
  by_provider jsonb not null default '{}'::jsonb, -- 제공처별 유효 주문 건수
  menu_quantities jsonb not null default '[]'::jsonb,  -- [{menu_id, name, quantity}] 수량 많은 순
  gross_amount bigint not null default 0,         -- 총 주문금액
  net_amount bigint not null default 0,           -- 할인·취소·환불 반영금액
  cancelled_count integer not null default 0,
  refreshed_at timestamptz not null default now(),-- 데이터 갱신시각
  data_status text not null default 'ok' check (data_status in ('ok', 'delayed', 'error')),  -- 데이터 제공 상태
  primary key (restaurant_id, scope, window_key, channel)
);
alter table public.order_aggregates enable row level security;

-- ───────────────────────── 트리거 ─────────────────────────
drop trigger if exists order_connections_touch on public.order_connections;
create trigger order_connections_touch before update on public.order_connections
  for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ───────────────────────── RLS: 관리자만 ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['order_settings', 'order_connections', 'orders', 'order_items', 'menu_aliases', 'order_aggregates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ───────────────────────── 공통 함수 ─────────────────────────
create or replace function public.request_role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '')
$$;

-- 관리자 또는 서버(service_role, Edge Function)만
create or replace function public.assert_admin_or_service()
returns void language plpgsql stable
security definer set search_path = public, pg_temp as $$
begin
  -- 관리자, 서버(service_role JWT), 또는 DB 예약 작업(pg_cron: postgres 세션)
  if not (public.is_admin() or public.request_role() = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'admin or service only' using errcode = '42501';
  end if;
end $$;

create or replace function public.norm_menu_name(t text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '[\s()\[\]·,.\-_/]', '', 'g'))
$$;

-- 집계 다시 계산. 유효 주문 = 취소 아님 + 중복 의심 아님 + 다른 주문에 통합되지 않음
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
               (not x.is_cancelled and x.dedup_status <> 'possible_duplicate' and x.merged_into is null) as valid
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
                and not x.is_cancelled and x.dedup_status <> 'possible_duplicate' and x.merged_into is null
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
                  and not x.is_cancelled and x.dedup_status <> 'possible_duplicate' and x.merged_into is null
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

-- ───────────────────────── 주문 수집 (웹훅·API·CSV·테스트 공통) ─────────────────────────
-- p_orders: [{external_order_id, link_key?, channel, ordered_at, paid_at?, total_amount, discount_amount?,
--             refund_amount?, order_status?, payment_status?, is_cancelled?, items:[{name, quantity, unit_price?, line_amount?}]}]
-- 개인정보 필드가 들어와도 저장할 열이 없어 버려진다.
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
      total_amount, discount_amount, refund_amount, order_status, payment_status, is_cancelled, is_test)
    values (
      c.restaurant_id, c.id, c.provider, btrim(o ->> 'external_order_id'), v_link,
      coalesce(nullif(o ->> 'channel', ''), 'UNKNOWN'),
      (o ->> 'ordered_at')::timestamptz, nullif(o ->> 'paid_at', '')::timestamptz,
      (o ->> 'total_amount')::integer, coalesce((o ->> 'discount_amount')::integer, 0),
      coalesce((o ->> 'refund_amount')::integer, 0),
      coalesce(nullif(o ->> 'order_status', ''), 'unknown'), coalesce(nullif(o ->> 'payment_status', ''), 'unknown'),
      coalesce((o ->> 'is_cancelled')::boolean, false) or (o ->> 'order_status') = 'cancelled', c.is_test)
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

-- 외부 API 호출 전에 호출량을 예약한다. 한도·예산을 넘으면 false + 연동 일시중지 (호출하지 않는다)
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

create or replace function public.record_connection_error(p_connection_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare rid uuid;
begin
  perform public.assert_admin_or_service();
  update public.order_connections
     set status = case when status = 'active' then 'error' else status end,
         last_attempt_at = now(), last_error = left(p_message, 500), last_error_at = now()
   where id = p_connection_id
  returning restaurant_id into rid;
  if rid is not null then perform public.refresh_order_aggregates(array[rid]); end if;
end $$;

-- ───────────────────────── 관리자 함수 ─────────────────────────
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
                 and not is_cancelled and dedup_status <> 'possible_duplicate' and merged_into is null),
    'last_10m', (select count(*) from public.orders
                  where is_test = p_test and ordered_at >= now() - interval '10 minutes'
                    and not is_cancelled and dedup_status <> 'possible_duplicate' and merged_into is null),
    'needs_review', (select count(*) from public.orders where is_test = p_test and dedup_status = 'possible_duplicate'),
    'unmatched_items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id
                         where o.is_test = p_test and i.match_status = 'unmatched'),
    'last_collected_at', (select max(collected_at) from public.orders where is_test = p_test),
    'last_success_at', (select max(last_success_at) from public.order_connections where is_test = p_test)
  ) into r;
  return r;
end $$;

-- 관리자: 매장별 주문 현황 (원본에서 바로 계산)
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
       and not o.is_cancelled and o.dedup_status <> 'possible_duplicate' and o.merged_into is null
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

-- 중복 의심 주문 판정: 'separate' = 별개 주문(집계 포함), 'duplicate' = 같은 주문(대표 주문에 통합)
create or replace function public.admin_resolve_duplicate(p_order_id uuid, p_action text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id and dedup_status = 'possible_duplicate';
  if not found then raise exception 'not a possible duplicate'; end if;
  if p_action = 'separate' then
    update public.orders set dedup_status = 'unique', duplicate_of = null where id = o.id;
  elsif p_action = 'duplicate' then
    update public.orders set dedup_status = 'merged', merged_into = o.duplicate_of where id = o.id;
  else
    raise exception 'unknown action';
  end if;
  perform public.refresh_order_aggregates(array[o.restaurant_id]);
end $$;

-- 외부 메뉴명을 내부 메뉴에 연결 (p_menu_id null = 집계 제외)
create or replace function public.admin_map_menu(p_restaurant_id uuid, p_external_name text, p_menu_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_menu_id is not null and not exists (select 1 from public.menus where id = p_menu_id and restaurant_id = p_restaurant_id) then
    raise exception '다른 매장의 메뉴에는 연결할 수 없어요';
  end if;
  insert into public.menu_aliases (restaurant_id, external_name_norm, menu_id)
  values (p_restaurant_id, public.norm_menu_name(p_external_name), p_menu_id)
  on conflict (restaurant_id, external_name_norm) do update set menu_id = excluded.menu_id;
  update public.order_items
     set menu_id = p_menu_id, match_status = case when p_menu_id is null then 'ignored' else 'matched' end
   where restaurant_id = p_restaurant_id and public.norm_menu_name(external_menu_name) = public.norm_menu_name(p_external_name);
  get diagnostics n = row_count;
  perform public.refresh_order_aggregates(array[p_restaurant_id]);
  return n;
end $$;

create or replace function public.admin_delete_test_orders()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  delete from public.orders where is_test;
  get diagnostics n = row_count;
  delete from public.order_aggregates where scope = 'test';
  return n;
end $$;

-- ───────────────────────── 소비자 공개 집계 ─────────────────────────
-- 공개 허용(실제) 집계만, 최근 갱신, 최소 공개 건수 이상인 창만 돌려준다.
-- p_include_test는 관리자에게만 테스트 집계를 보여준다 (테스트 위치 화면 확인용).
create or replace function public.public_order_activity(p_ids uuid[], p_channel text, p_include_test boolean default false)
returns table (restaurant_id uuid, activity jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  min_n integer := (select min_public_count from public.order_settings);
  stale interval := make_interval(mins => (select stale_after_minutes from public.order_settings));
  v_scope text := case when p_include_test and public.is_admin() then 'test' else 'public' end;
begin
  return query
  select a.restaurant_id,
         jsonb_build_object(
           'scope', v_scope,
           'as_of', max(a.refreshed_at),
           'windows', jsonb_object_agg(a.window_key, a.order_count),
           'by_provider', (select b.by_provider from public.order_aggregates b
                            where b.restaurant_id = a.restaurant_id and b.scope = v_scope and b.channel = p_channel
                              and b.window_key = '60m' and b.order_count >= min_n),
           'top_menu', (select b.menu_quantities -> 0 from public.order_aggregates b
                         where b.restaurant_id = a.restaurant_id and b.scope = v_scope and b.channel = p_channel
                           and b.window_key = 'today' and b.order_count >= min_n
                           and jsonb_array_length(b.menu_quantities) > 0
                           and (b.menu_quantities -> 0 ->> 'menu_id') is not null))
    from public.order_aggregates a
    join public.restaurants r
      on r.id = a.restaurant_id and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'
   where a.restaurant_id = any (p_ids)
     and a.scope = v_scope
     and a.channel = p_channel
     and a.window_key in ('10m', '30m', '60m', 'lunch')
     and a.order_count >= min_n
     and a.data_status <> 'error'
     and a.refreshed_at >= now() - stale
   group by a.restaurant_id;
end $$;

-- 4단계 검색 함수에 주문 활발도(activity)를 더한다. 정렬은 바꾸지 않는다 (6단계).
drop function if exists public.search_restaurants(double precision, double precision, text, integer, text, text, integer);
create or replace function public.search_restaurants(
  p_lat double precision,
  p_lng double precision,
  p_mode text,
  p_radius_m integer default 100,
  p_category text default null,
  p_keyword text default null,
  p_limit integer default 100,
  p_include_test boolean default false
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
  activity jsonb
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
           ), '[]'::jsonb) as menus
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
  )
  select f.*, act.activity
    from found f
    left join public.public_order_activity((select array_agg(f2.id) from found f2), ch, p_include_test) act
      on act.restaurant_id = f.id
   order by f.distance_m, f.name;
end $$;

grant execute on function public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean)
  to anon, authenticated;
grant execute on function public.public_order_activity(uuid[], text, boolean) to anon, authenticated;

-- 함수 실행 권한: 기본 PUBLIC 권한을 거두고 필요한 역할에만 준다 (함수 안에서도 다시 검사한다)
do $$
declare f text;
begin
  foreach f in array array[
    'public.ingest_orders(uuid, jsonb)', 'public.reserve_api_calls(uuid, integer)',
    'public.record_connection_error(uuid, text)', 'public.refresh_order_aggregates(uuid[])',
    'public.admin_order_overview(boolean)', 'public.admin_restaurant_order_stats(uuid, boolean)',
    'public.admin_resolve_duplicate(uuid, text)', 'public.admin_map_menu(uuid, text, uuid)',
    'public.admin_delete_test_orders()', 'public.assert_admin_or_service()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
