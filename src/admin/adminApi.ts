import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelStatus } from '../types';
import { isValidRoutePoint } from '../lib/mapLinks';
import type { BusinessStatus, CoordStatus, ExistingRow, PlannedRow } from '../lib/publicData/importPlan';
import type { RegionId } from '../lib/publicData/regions';

/**
 * 관리자 화면의 DB 작업. 권한 검사는 모두 서버(RLS·is_admin)에서 한다 —
 * 여기서 막지 않아도 관리자가 아니면 DB가 거부한다.
 */

export type VerifyStatus = 'unverified' | 'verified' | 'needs_review';

export interface AdminRestaurant {
  id: string;
  license_no: string | null;
  source_ref: string | null;
  name: string;
  category: string;
  category_raw: string | null;
  road_address: string | null;
  lot_address: string | null;
  lat: number | null;
  lng: number | null;
  coord_status: CoordStatus;
  business_status: BusinessStatus;
  business_status_raw: string | null;
  dine_in: ChannelStatus;
  delivery: ChannelStatus;
  takeout: ChannelStatus;
  delivery_radius_m: number | null;
  /** 확인된 배달비(원) — 없으면 소비자 화면에 표시하지 않음 */
  delivery_fee_krw: number | null;
  /** 확인된 배달 예상시간(분) */
  delivery_eta_minutes: number | null;
  /** 승인된 배달앱 주문 링크 (https만) */
  baemin_order_url: string | null;
  coupangeats_order_url: string | null;
  naver_place_url: string | null;
  /** 상권 분석용 음식 종류 (없으면 음식 종류에서 자동 분류) */
  market_category: string | null;
  has_signature_menu: boolean;
  source: 'public_data' | 'admin';
  source_name: string | null;
  source_collected_at: string | null;
  verify_status: VerifyStatus;
  last_verified_at: string | null;
  is_public: boolean;
  admin_edited: boolean;
  region_id: RegionId | null;
  updated_at: string;
}

export type RestaurantEditable = Pick<
  AdminRestaurant,
  | 'name'
  | 'category'
  | 'road_address'
  | 'lot_address'
  | 'lat'
  | 'lng'
  | 'business_status'
  | 'dine_in'
  | 'delivery'
  | 'takeout'
  | 'delivery_radius_m'
  | 'delivery_fee_krw'
  | 'delivery_eta_minutes'
  | 'baemin_order_url'
  | 'coupangeats_order_url'
  | 'naver_place_url'
  | 'market_category'
  | 'verify_status'
  | 'last_verified_at'
  | 'is_public'
  | 'region_id'
>;

export interface AdminMenu {
  id: string;
  restaurant_id: string;
  name: string;
  is_signature: boolean;
  price_dine_in: number | null;
  price_delivery: number | null;
  price_takeout: number | null;
  sort_order: number;
  is_available: boolean;
  is_public: boolean;
  price_verified_at: string | null;
  /** 상권 분석에서 다른 매장 메뉴와 묶을 공통 분류 (관리자가 확인한 경우만) */
  menu_group: string | null;
}

export type MenuEditable = Omit<AdminMenu, 'id' | 'restaurant_id'>;

export interface DashboardStats {
  total: number;
  public: number;
  with_menu: number;
  without_menu: number;
  coord_problem: number;
  closed_or_suspended: number;
  last_updated_at: string | null;
  last_import_at: string | null;
  by_region: { region_id: string; name: string; count: number }[];
}

export type RestaurantFilter = 'all' | 'public' | 'hidden' | 'coord' | 'nomenu' | 'closed';

export const PAGE_SIZE = 30;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 가격 입력: 비우면 null(가격정보 없음). 0 이하·소수는 허용하지 않는다. */
export function parsePrice(text: string): number | null | 'invalid' {
  const t = text.replace(/[,원\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

/** 좌표 상태 — 둘 다 비면 누락, 하나만 있거나 국내 범위 밖이면 오류 */
export function coordStatusOf(lat: number | null, lng: number | null): CoordStatus {
  if (lat === null && lng === null) return 'missing';
  if (lat === null || lng === null) return 'invalid';
  return isValidRoutePoint({ lat, lng }) ? 'valid' : 'invalid';
}

/** PostgREST or() 필터에 넣을 수 있게 검색어의 특수문자를 지운다 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()*%\\:"]/g, ' ').trim();
}

export async function fetchDashboard(client: SupabaseClient): Promise<DashboardStats> {
  return check(await client.rpc('admin_dashboard_stats')) as DashboardStats;
}

export async function listRestaurants(
  client: SupabaseClient,
  opts: { q: string; filter: RestaurantFilter; page: number },
): Promise<{ rows: AdminRestaurant[]; total: number }> {
  let query = client.from('restaurants').select('*', { count: 'exact' });
  const q = sanitizeSearch(opts.q);
  if (q) {
    query = query.or(
      ['name', 'road_address', 'lot_address', 'license_no'].map((c) => `${c}.ilike.*${q}*`).join(','),
    );
  }
  switch (opts.filter) {
    case 'public':
      query = query.eq('is_public', true).eq('business_status', 'open').eq('coord_status', 'valid');
      break;
    case 'hidden':
      query = query.eq('is_public', false);
      break;
    case 'coord':
      query = query.neq('coord_status', 'valid');
      break;
    case 'nomenu':
      query = query.eq('has_signature_menu', false);
      break;
    case 'closed':
      query = query.in('business_status', ['closed', 'suspended']);
      break;
  }
  const from = opts.page * PAGE_SIZE;
  const res = await query.order('name').range(from, from + PAGE_SIZE - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as AdminRestaurant[], total: res.count ?? 0 };
}

/** 등록(id 없음) 또는 수정. 좌표 상태는 위도·경도로 다시 계산한다. */
export async function saveRestaurant(
  client: SupabaseClient,
  id: string | null,
  values: RestaurantEditable,
): Promise<AdminRestaurant> {
  const row = { ...values, coord_status: coordStatusOf(values.lat, values.lng) };
  if (id) {
    // 관리자가 고친 기본정보는 공공데이터 재업로드로 덮어쓰지 않게 표시한다
    return check(
      await client.from('restaurants').update({ ...row, admin_edited: true }).eq('id', id).select().single(),
    ) as AdminRestaurant;
  }
  return check(
    await client.from('restaurants').insert({ ...row, source: 'admin', source_name: '관리자 등록' }).select().single(),
  ) as AdminRestaurant;
}

export async function setRestaurantPublic(client: SupabaseClient, id: string, isPublic: boolean): Promise<void> {
  check(await client.from('restaurants').update({ is_public: isPublic }).eq('id', id));
}

export async function listMenus(client: SupabaseClient, restaurantId: string): Promise<AdminMenu[]> {
  return check(
    await client.from('menus').select('*').eq('restaurant_id', restaurantId).order('is_signature', { ascending: false }).order('sort_order'),
  ) as AdminMenu[];
}

export async function saveMenu(
  client: SupabaseClient,
  restaurantId: string,
  id: string | null,
  values: MenuEditable,
): Promise<AdminMenu> {
  if (id) {
    return check(
      await client.from('menus').update(values).eq('id', id).eq('restaurant_id', restaurantId).select().single(),
    ) as AdminMenu;
  }
  return check(
    await client.from('menus').insert({ ...values, restaurant_id: restaurantId }).select().single(),
  ) as AdminMenu;
}

export async function deleteMenu(client: SupabaseClient, restaurantId: string, id: string): Promise<void> {
  check(await client.from('menus').delete().eq('id', id).eq('restaurant_id', restaurantId));
}

export interface DuplicatePair {
  a_id: string;
  a_name: string;
  b_id: string;
  b_name: string;
  distance_m: number | null;
  reason: string;
}

export async function findDuplicates(client: SupabaseClient): Promise<DuplicatePair[]> {
  return check(await client.rpc('admin_find_duplicates')) as DuplicatePair[];
}

// ───────── 공공데이터 가져오기 ─────────

const EXISTING_COLUMNS =
  'license_no,name,category,business_status,coord_status,lat,lng,road_address,lot_address,admin_edited';

/** 관리번호로 기존 매장을 조회 (200개씩 나눠서) */
export async function fetchExisting(client: SupabaseClient, licenseNos: string[]): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  for (let i = 0; i < licenseNos.length; i += 200) {
    const chunk = licenseNos.slice(i, i + 200);
    const rows = check(await client.from('restaurants').select(EXISTING_COLUMNS).in('license_no', chunk)) as ExistingRow[];
    for (const r of rows) map.set(r.license_no, r);
  }
  return map;
}

export interface BatchMeta {
  fileName: string;
  regionId: RegionId;
  sourceName: string;
  collectedAt: string;
  clientStats: unknown;
}

export interface CommitResult {
  staged: number;
  inserted: number;
  updated: number;
  unchanged: number;
  closed_skipped: number;
  success: number;
}

/**
 * 스테이징 테이블에 500행씩 올린 뒤 한 번에 반영한다.
 * 반영(admin_commit_import)은 DB 안에서 한 트랜잭션이라 중간에 실패해도 기존 매장은 바뀌지 않는다.
 */
export async function stageAndCommit(
  client: SupabaseClient,
  meta: BatchMeta,
  rows: PlannedRow[],
  onProgress?: (staged: number) => void,
): Promise<CommitResult> {
  const batch = check(
    await client
      .from('import_batches')
      .insert({
        file_name: meta.fileName,
        region_id: meta.regionId,
        source_name: meta.sourceName,
        collected_at: meta.collectedAt,
        client_stats: meta.clientStats,
      })
      .select('id')
      .single(),
  ) as { id: string };
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({
        batch_id: batch.id,
        license_no: r.licenseNo,
        source_ref: r.sourceRef,
        name: r.name,
        category: r.category,
        category_raw: r.categoryRaw,
        road_address: r.roadAddress,
        lot_address: r.lotAddress,
        lat: r.lat,
        lng: r.lng,
        coord_status: r.coordStatus,
        business_status: r.businessStatus,
        business_status_raw: r.businessStatusRaw,
      }));
      check(await client.from('import_staging').insert(chunk));
      onProgress?.(Math.min(i + 500, rows.length));
    }
    return check(await client.rpc('admin_commit_import', { p_batch_id: batch.id })) as CommitResult;
  } catch (e) {
    // 실패한 배치는 표시만 남기고 올리던 원본 행은 지운다 (기존 매장 데이터는 그대로)
    await client.from('import_staging').delete().eq('batch_id', batch.id);
    await client.from('import_batches').update({ status: 'failed' }).eq('id', batch.id);
    throw e;
  }
}
