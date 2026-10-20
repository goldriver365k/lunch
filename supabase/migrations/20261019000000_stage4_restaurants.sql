-- 뭐먹 4단계: 실제 음식점 DB · 메뉴 · 관리자 · 공공데이터 가져오기
-- Supabase(무료 플랜) + PostGIS 기준. Supabase SQL Editor에서 그대로 실행하거나 `supabase db push`로 적용한다.

create extension if not exists postgis with schema extensions;

-- ───────────────────────── 타입 ─────────────────────────
do $$ begin
  create type public.channel_status as enum ('yes', 'no', 'unknown');          -- 확인됨 / 운영 안 함 / 미확인
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.business_status as enum ('open', 'suspended', 'closed', 'unknown');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.coord_status as enum ('valid', 'missing', 'invalid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.verify_status as enum ('unverified', 'verified', 'needs_review');
exception when duplicate_object then null; end $$;

-- ───────────────────────── 관리자 ─────────────────────────
-- 관리자 지정은 SQL Editor에서만 한다 (클라이언트 정책 없음):
--   insert into public.admin_users (user_id) select id from auth.users where email = '관리자 이메일';
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ───────────────────────── 지역 ─────────────────────────
create table if not exists public.regions (
  id text primary key,
  name text not null,
  is_active boolean not null default false   -- 1차 등록 지역 여부
);
insert into public.regions (id, name, is_active) values
  ('seolleung_yeoksam', '선릉역·역삼역 업무지구', true),
  ('pangyo', '판교역·제1판교테크노밸리', false),
  ('yeouido', '여의도역 업무지구', false)
on conflict (id) do nothing;
alter table public.regions enable row level security;

-- ───────────────────────── 음식점 ─────────────────────────
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),            -- 음식점 고유 ID (POS·배달 연동 키)
  license_no text unique,                                   -- 인허가 관리번호 (중복 판별 1순위)
  source_ref text,                                          -- 원본 식별번호 (개방자치단체코드 등)
  name text not null check (length(btrim(name)) > 0),
  category text not null default '기타',
  category_raw text,                                        -- 원본 업태구분명
  road_address text,
  lot_address text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geog extensions.geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
    end
  ) stored,
  coord_status public.coord_status not null default 'missing',
  business_status public.business_status not null default 'unknown',
  business_status_raw text,
  dine_in public.channel_status not null default 'unknown',
  delivery public.channel_status not null default 'unknown',
  takeout public.channel_status not null default 'unknown',
  delivery_radius_m integer check (delivery_radius_m between 1 and 10000),  -- 확인된 배달 가능 거리
  has_signature_menu boolean not null default false,        -- 대표메뉴 등록 여부 (트리거로 유지)
  source text not null default 'admin' check (source in ('public_data', 'admin')),
  source_name text,                                         -- 정보 출처 (예: 공공데이터포털 전국일반음식점표준데이터)
  source_collected_at date,                                 -- 수집일
  verify_status public.verify_status not null default 'unverified',
  last_verified_at date,                                    -- 최종 확인일
  is_public boolean not null default false,                 -- 앱 노출 여부
  admin_edited boolean not null default false,              -- 관리자가 고친 기본정보는 공공데이터 재업로드로 덮어쓰지 않는다
  region_id text references public.regions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists restaurants_geog_idx on public.restaurants using gist (geog);
create index if not exists restaurants_public_idx on public.restaurants (is_public, business_status, coord_status);
create index if not exists restaurants_region_idx on public.restaurants (region_id);
alter table public.restaurants enable row level security;

-- ───────────────────────── 메뉴 ─────────────────────────
create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),            -- 메뉴 고유 ID
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  is_signature boolean not null default false,
  price_dine_in integer check (price_dine_in > 0),          -- null = 가격정보 없음 (0원으로 쓰지 않는다)
  price_delivery integer check (price_delivery > 0),
  price_takeout integer check (price_takeout > 0),
  sort_order integer not null default 0,
  is_available boolean not null default true,               -- 판매 여부
  is_public boolean not null default true,                  -- 메뉴 공개 여부
  price_verified_at date,                                   -- 가격 최종 확인일
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menus_restaurant_idx on public.menus (restaurant_id, sort_order);
alter table public.menus enable row level security;

-- ───────────────────────── 공공데이터 가져오기 ─────────────────────────
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  region_id text not null references public.regions (id),
  source_name text not null,
  collected_at date not null,
  status text not null default 'staged' check (status in ('staged', 'committed', 'failed')),
  client_stats jsonb,                                       -- 미리보기 단계 집계 (폐업 제외·좌표 오류 등)
  result jsonb,                                             -- 저장 결과 집계
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
alter table public.import_batches enable row level security;

create table if not exists public.import_staging (
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  license_no text not null,
  source_ref text,
  name text not null,
  category text not null,
  category_raw text,
  road_address text,
  lot_address text,
  lat double precision,
  lng double precision,
  coord_status public.coord_status not null,
  business_status public.business_status not null,
  business_status_raw text,
  primary key (batch_id, license_no)
);
alter table public.import_staging enable row level security;

-- ───────────────────────── 트리거 ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists restaurants_touch on public.restaurants;
create trigger restaurants_touch before update on public.restaurants
  for each row execute function public.touch_updated_at();
drop trigger if exists menus_touch on public.menus;
create trigger menus_touch before update on public.menus
  for each row execute function public.touch_updated_at();

create or replace function public.sync_has_signature_menu()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rid uuid := coalesce(new.restaurant_id, old.restaurant_id);
begin
  update public.restaurants r
     set has_signature_menu = exists (
       select 1 from public.menus m
        where m.restaurant_id = rid and m.is_signature and m.is_public and m.is_available)
   where r.id = rid;
  if tg_op = 'UPDATE' and old.restaurant_id <> new.restaurant_id then
    update public.restaurants r
       set has_signature_menu = exists (
         select 1 from public.menus m
          where m.restaurant_id = old.restaurant_id and m.is_signature and m.is_public and m.is_available)
     where r.id = old.restaurant_id;
  end if;
  return null;
end $$;

drop trigger if exists menus_sync_signature on public.menus;
create trigger menus_sync_signature after insert or update or delete on public.menus
  for each row execute function public.sync_has_signature_menu();

-- ───────────────────────── RLS 정책 ─────────────────────────
-- 일반 이용자: 공개·영업중·좌표 정상 매장과 그 공개 메뉴만 읽기. 쓰기 불가.
-- 관리자: 모든 데이터 읽기·쓰기 (서버에서 is_admin()으로 검증).
drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants for select to anon, authenticated
  using (is_public and business_status = 'open' and coord_status = 'valid');
drop policy if exists restaurants_admin_all on public.restaurants;
create policy restaurants_admin_all on public.restaurants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists menus_public_read on public.menus;
create policy menus_public_read on public.menus for select to anon, authenticated
  using (is_public and exists (
    select 1 from public.restaurants r
     where r.id = restaurant_id and r.is_public and r.business_status = 'open' and r.coord_status = 'valid'));
drop policy if exists menus_admin_all on public.menus;
create policy menus_admin_all on public.menus for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists regions_read on public.regions;
create policy regions_read on public.regions for select to anon, authenticated using (true);

drop policy if exists import_batches_admin on public.import_batches;
create policy import_batches_admin on public.import_batches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists import_staging_admin on public.import_staging;
create policy import_staging_admin on public.import_staging for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.restaurants, public.menus, public.regions to anon, authenticated;
grant insert, update, delete on public.restaurants, public.menus to authenticated;
grant select, insert, update, delete on public.import_batches, public.import_staging to authenticated;
revoke all on public.admin_users from anon, authenticated;

-- ───────────────────────── 위치 검색 (서버 반경 검색) ─────────────────────────
-- 도보 식사·포장: 100/200/300m 중 하나만 허용. 배달: 매장의 확인된 배달 가능 거리 안에 배달 주소가 있는 매장만.
-- SECURITY INVOKER라서 RLS가 그대로 적용된다 (공개 매장만 나온다).
create or replace function public.search_restaurants(
  p_lat double precision,
  p_lng double precision,
  p_mode text,
  p_radius_m integer default 100,
  p_category text default null,
  p_keyword text default null,
  p_limit integer default 100
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
  menus jsonb
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
   where st_dwithin(r.geog, origin, search_m)                           -- 공간 인덱스 사용
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
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

grant execute on function public.search_restaurants(double precision, double precision, text, integer, text, text, integer)
  to anon, authenticated;

-- ───────────────────────── 관리자 함수 ─────────────────────────
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', count(*),
    'public', count(*) filter (where is_public and business_status = 'open' and coord_status = 'valid'),
    'with_menu', count(*) filter (where exists (select 1 from public.menus m where m.restaurant_id = r.id)),
    'without_menu', count(*) filter (where not exists (select 1 from public.menus m where m.restaurant_id = r.id)),
    'coord_problem', count(*) filter (where coord_status <> 'valid'),
    'closed_or_suspended', count(*) filter (where business_status in ('closed', 'suspended')),
    'last_updated_at', greatest(max(r.updated_at), (select max(m.updated_at) from public.menus m)),
    'last_import_at', (select max(committed_at) from public.import_batches where status = 'committed'),
    'by_region', coalesce((
      select jsonb_agg(jsonb_build_object('region_id', g.id, 'name', g.name, 'count',
               (select count(*) from public.restaurants x where x.region_id = g.id)) order by g.id)
        from public.regions g), '[]'::jsonb)
  ) into result
  from public.restaurants r;
  return result;
end $$;

-- 같은 이름(공백·대소문자 무시)이 30m 안에 있거나 같은 도로명주소에 있으면 중복 의심
create or replace function public.admin_find_duplicates()
returns table (a_id uuid, a_name text, b_id uuid, b_name text, distance_m integer, reason text)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select a.id, a.name, b.id, b.name,
         round(st_distance(a.geog, b.geog))::integer,
         case when a.road_address is not null and a.road_address = b.road_address then '같은 주소·같은 이름'
              else '30m 안 같은 이름' end
    from public.restaurants a
    join public.restaurants b
      on a.id < b.id
     and lower(regexp_replace(a.name, '\s', '', 'g')) = lower(regexp_replace(b.name, '\s', '', 'g'))
     and ((a.road_address is not null and a.road_address = b.road_address)
          or st_dwithin(a.geog, b.geog, 30))
   order by a.name
   limit 200;
end $$;

-- 스테이징된 공공데이터를 한 트랜잭션으로 반영한다. 실패하면 전부 되돌려져 기존 데이터가 손상되지 않는다.
-- 메뉴·가격·공개 여부·운영 여부·관리자가 고친 기본정보는 건드리지 않는다.
create or replace function public.admin_commit_import(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  b public.import_batches;
  n_inserted integer := 0;
  n_updated integer := 0;
  n_unchanged integer := 0;
  n_closed_skipped integer := 0;
  n_staged integer := 0;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'batch not found'; end if;
  if b.status <> 'staged' then raise exception 'batch already %', b.status; end if;

  select count(*) into n_staged from public.import_staging where batch_id = p_batch_id;

  -- 기존 매장 갱신 (값이 바뀐 경우만)
  with upd as (
    update public.restaurants r
       set name = case when r.admin_edited then r.name else s.name end,
           category = case when r.admin_edited then r.category else s.category end,
           category_raw = s.category_raw,
           road_address = case when r.admin_edited then r.road_address else s.road_address end,
           lot_address = case when r.admin_edited then r.lot_address else s.lot_address end,
           lat = case when r.admin_edited then r.lat else s.lat end,
           lng = case when r.admin_edited then r.lng else s.lng end,
           coord_status = case when r.admin_edited then r.coord_status else s.coord_status end,
           business_status = s.business_status,
           business_status_raw = s.business_status_raw,
           source_ref = s.source_ref,
           source_name = b.source_name,
           source_collected_at = b.collected_at,
           region_id = coalesce(r.region_id, b.region_id)
      from public.import_staging s
     where s.batch_id = p_batch_id and r.license_no = s.license_no
       and (r.business_status is distinct from s.business_status
            or (not r.admin_edited and (
                 r.name is distinct from s.name or r.category is distinct from s.category
                 or r.road_address is distinct from s.road_address or r.lot_address is distinct from s.lot_address
                 or r.lat is distinct from s.lat or r.lng is distinct from s.lng
                 or r.coord_status is distinct from s.coord_status)))
    returning 1
  )
  select count(*) into n_updated from upd;

  -- 신규 매장: 영업 중인 것만 등록. 좌표가 없거나 잘못된 매장은 등록하되 비공개로 분류한다.
  with ins as (
    insert into public.restaurants (
      license_no, source_ref, name, category, category_raw, road_address, lot_address, lat, lng,
      coord_status, business_status, business_status_raw, source, source_name, source_collected_at,
      is_public, region_id)
    select s.license_no, s.source_ref, s.name, s.category, s.category_raw, s.road_address, s.lot_address,
           s.lat, s.lng, s.coord_status, s.business_status, s.business_status_raw, 'public_data',
           b.source_name, b.collected_at, s.coord_status = 'valid', b.region_id
      from public.import_staging s
     where s.batch_id = p_batch_id
       and s.business_status = 'open'
       and not exists (select 1 from public.restaurants r where r.license_no = s.license_no)
    on conflict (license_no) do nothing
    returning 1
  )
  select count(*) into n_inserted from ins;

  select count(*) into n_closed_skipped
    from public.import_staging s
   where s.batch_id = p_batch_id and s.business_status <> 'open'
     and not exists (select 1 from public.restaurants r where r.license_no = s.license_no);

  n_unchanged := n_staged - n_inserted - n_updated - n_closed_skipped;

  v_result := jsonb_build_object(
    'staged', n_staged, 'inserted', n_inserted, 'updated', n_updated,
    'unchanged', n_unchanged, 'closed_skipped', n_closed_skipped,
    'success', n_inserted + n_updated);

  update public.import_batches set status = 'committed', result = v_result, committed_at = now()
   where id = p_batch_id;
  delete from public.import_staging where batch_id = p_batch_id;   -- 원본 행은 보관하지 않는다
  return v_result;
end $$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_find_duplicates() to authenticated;
grant execute on function public.admin_commit_import(uuid) to authenticated;
revoke execute on function public.admin_dashboard_stats() from anon;
revoke execute on function public.admin_find_duplicates() from anon;
revoke execute on function public.admin_commit_import(uuid) from anon;
