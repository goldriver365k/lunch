-- 네이버 매장 링크: 상세화면 "네이버에서 메뉴 보기" 버튼이 여는 주소 (관리자가 입력)
-- 네이버 지도 앱 → 공유 → 링크 복사 (https://naver.me/...) 또는 https://map.naver.com/... 주소만 받는다.
-- 메뉴·가격은 네이버 정보이며 점심뭐먹이 확인한 값이 아니다. 다시 실행해도 안전하다.

alter table public.restaurants add column if not exists naver_place_url text;
alter table public.restaurants drop constraint if exists restaurants_naver_place_url_check;
alter table public.restaurants add constraint restaurants_naver_place_url_check
  check (naver_place_url is null or naver_place_url ~ '^https://(naver\.me|([a-z0-9-]+\.)*naver\.com)/');

-- ───────── 검색 결과에 네이버 매장 링크 포함 (반환 열이 바뀌어 다시 만든다) ─────────
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
  verify_status public.verify_status,
  naver_place_url text
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
           r.delivery_fee_krw, r.delivery_eta_minutes, r.baemin_order_url, r.coupangeats_order_url, r.verify_status,
           r.naver_place_url
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
         x.rank_group, x.verify_status, x.naver_place_url
    from ranked x
   order by case when p_sort = 'popular' then x.rank_group else 0 end,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_primary')::int end desc nulls last,
            case when p_sort = 'popular' and x.rank_group = 0 then (x.activity ->> 'rank_secondary')::int end desc nulls last,
            -- 포장: 같은 순위 안에서는 포장 운영이 확인된 매장을 미확인보다 먼저
            case when p_sort = 'popular' and p_mode = 'takeout' and x.takeout <> 'yes' then 1 else 0 end,
            x.distance_m, x.name;
end $$;

grant execute on function public.search_restaurants(double precision, double precision, text, integer, text, text, integer, boolean, text)
  to anon, authenticated;
