import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, ChannelStatus, GeoPoint, MenuItem, Mode, OrderActivity, Radius, RestaurantResult } from '../../types';
import { CATEGORIES } from '../constants';

/** search_restaurants RPC가 돌려주는 행 */
export interface DbSearchRow {
  id: string;
  name: string;
  category: string;
  road_address: string | null;
  lot_address: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  dine_in: ChannelStatus;
  delivery: ChannelStatus;
  takeout: ChannelStatus;
  delivery_radius_m: number | null;
  last_verified_at: string | null;
  updated_at: string;
  menus: {
    id: string;
    name: string;
    is_signature: boolean;
    price_dine_in: number | null;
    price_delivery: number | null;
    price_takeout: number | null;
    price_verified_at: string | null;
  }[];
  /** 주문 활발도 — 연동이 없으면 null */
  activity?: {
    scope: 'public' | 'test';
    status: OrderActivity['status'];
    as_of: string;
    primary_minutes: number;
    secondary_minutes: number;
    rank_primary: number;
    rank_secondary: number;
    windows: OrderActivity['windows'];
    providers: OrderActivity['providers'];
    top_menus: { menu_id: string; name: string }[];
  } | null;
  delivery_fee_krw?: number | null;
  delivery_eta_minutes?: number | null;
  baemin_order_url?: string | null;
  coupangeats_order_url?: string | null;
  rank_group?: number;
}

function mapActivity(a: DbSearchRow['activity']): OrderActivity | null {
  if (!a) return null;
  return {
    scope: a.scope,
    status: a.status,
    asOf: a.as_of,
    primaryMinutes: a.primary_minutes,
    secondaryMinutes: a.secondary_minutes,
    windows: a.windows ?? {},
    providers: a.providers ?? [],
    topMenus: (a.top_menus ?? []).map((m) => ({ menuId: m.menu_id, name: m.name })),
  };
}

function toCategory(raw: string): Category {
  return (CATEGORIES as string[]).includes(raw) ? (raw as Category) : '기타';
}

/** https 링크만 쓴다 (DB에서도 막지만 한 번 더) */
function safeUrl(u: string | null | undefined): string | undefined {
  return u && /^https:\/\//.test(u) ? u : undefined;
}

export function mapDbRow(row: DbSearchRow): RestaurantResult {
  const channelStatus: Record<Mode, ChannelStatus> = {
    walk: row.dine_in,
    delivery: row.delivery,
    takeout: row.takeout,
  };
  const menus: MenuItem[] = row.menus.map((m) => ({
    id: m.id,
    name: m.name,
    signature: m.is_signature,
    prices: { walk: m.price_dine_in, delivery: m.price_delivery, takeout: m.price_takeout },
  }));
  return {
    id: row.id,
    name: row.name,
    category: toCategory(row.category),
    address: row.road_address ?? row.lot_address ?? '주소 정보 없음',
    location: { lat: row.lat, lng: row.lng },
    // DB 좌표는 공공데이터 원본 좌표를 변환·검사했거나 관리자가 확인한 값만 공개된다
    coordVerified: true,
    recentOrders: {}, // 실시간 주문정보 없음 (0건으로 취급하지 않는다)
    channelStatus,
    menus,
    modes: (Object.keys(channelStatus) as Mode[]).filter((m) => channelStatus[m] !== 'no'),
    deliveryRadiusM: row.delivery_radius_m ?? undefined,
    dataSource: { kind: 'db', realtime: false, updatedAt: row.updated_at },
    lastVerifiedAt: row.last_verified_at,
    activity: mapActivity(row.activity),
    // 확인된 값만 (없으면 표시하지 않는다 — 임의로 만들지 않음)
    deliveryFee: row.delivery_fee_krw ?? undefined,
    deliveryMinutes: row.delivery_eta_minutes ?? undefined,
    orderLinks: { baemin: safeUrl(row.baemin_order_url), coupangeats: safeUrl(row.coupangeats_order_url) },
    rankGroup: row.rank_group,
    distanceM: row.distance_m,
  };
}

export interface DbSearchParams {
  origin: GeoPoint;
  mode: Mode;
  radius: Radius;
  category: Category | null;
  keyword: string;
  /** 관리자 테스트 모드: 테스트 주문 집계를 보여준다 (서버에서 관리자일 때만 적용) */
  includeTest?: boolean;
  /** 서버 정렬: 지금 주문 많은 순(popular) / 거리순(distance) */
  sort?: 'popular' | 'distance';
}

/** 서버(PostGIS)에서 반경 검색 — 전체 음식점을 내려받지 않는다 */
export async function searchRestaurantsDb(client: SupabaseClient, p: DbSearchParams): Promise<RestaurantResult[]> {
  const { data, error } = await client.rpc('search_restaurants', {
    p_lat: p.origin.lat,
    p_lng: p.origin.lng,
    p_mode: p.mode,
    p_radius_m: p.radius,
    p_category: p.category,
    p_keyword: p.keyword.trim() || null,
    ...(p.includeTest ? { p_include_test: true } : {}),
    p_sort: p.sort ?? 'popular',
  });
  if (error) throw error;
  return (data as DbSearchRow[]).map(mapDbRow);
}

/** 화면 새로고침 간격(초) — 관리자 설정, 실패하면 60초 */
export async function fetchRefreshIntervalSeconds(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('public_app_settings');
  const n = Number((data as { refresh_interval_seconds?: number } | null)?.refresh_interval_seconds);
  return !error && Number.isFinite(n) && n >= 15 ? n : 60;
}

/** 서버에서 관리자 여부 확인 (admin_users + 로그인 세션) */
export async function checkIsAdmin(client: SupabaseClient): Promise<boolean> {
  const { data: session } = await client.auth.getSession();
  if (!session.session) return false;
  const { data, error } = await client.rpc('is_admin');
  return !error && data === true;
}
