import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketPublicData } from '../../lib/market/types';

/** 관리자 상권 분석 설정. 권한은 DB(RLS·is_admin)가 다시 확인한다. */

export interface MarketArea {
  id: string;
  name: string;
  sido: string;
  center_lat: number;
  center_lng: number;
  spatial_mode: 'radius' | 'boundary';
  radius_m: number;
  boundary_geojson: unknown | null;
  boundary_source: string | null;
  is_active: boolean;
  business_visible: boolean;
  sort_order: number;
  seoul_realtime_place: string | null;
  seoul_realtime_verified: boolean;
  note: string | null;
}

export type MarketAreaInput = Omit<MarketArea, 'sort_order'> & { sort_order?: number };

export interface MarketSettings {
  lunch_start_min: number;
  lunch_end_min: number;
  price_bands: number[];
  min_stores: number;
  min_orders: number;
}

export interface BusinessUser {
  user_id: string;
  email: string;
  org_name: string;
  plan: string;
  is_active: boolean;
  created_at: string;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const AREA_COLUMNS =
  'id, name, sido, center_lat, center_lng, spatial_mode, radius_m, boundary_geojson, boundary_source, is_active, business_visible, sort_order, seoul_realtime_place, seoul_realtime_verified, note';

export async function listAreas(client: SupabaseClient): Promise<MarketArea[]> {
  return check(await client.from('market_areas').select(AREA_COLUMNS).order('sort_order').order('name')) as MarketArea[];
}

export async function saveArea(client: SupabaseClient, area: MarketAreaInput, isNew: boolean): Promise<void> {
  const row = { ...area, updated_at: new Date().toISOString() };
  if (isNew) check(await client.from('market_areas').insert(row));
  else check(await client.from('market_areas').update(row).eq('id', area.id));
}

export async function fetchMarketSettings(client: SupabaseClient): Promise<MarketSettings> {
  return check(
    await client.from('market_settings').select('lunch_start_min, lunch_end_min, price_bands, min_stores, min_orders').single(),
  ) as MarketSettings;
}

export async function saveMarketSettings(client: SupabaseClient, s: MarketSettings): Promise<void> {
  check(await client.from('market_settings').update({ ...s, updated_at: new Date().toISOString() }).eq('id', true));
}

export async function listPublicData(client: SupabaseClient, areaId: string): Promise<MarketPublicData[]> {
  return check(
    await client.from('market_public_data').select('*').eq('area_id', areaId).order('source').order('metric'),
  ) as MarketPublicData[];
}

export async function addPublicData(client: SupabaseClient, row: MarketPublicData & { area_id: string }): Promise<void> {
  check(await client.from('market_public_data').insert(row));
}

export async function deletePublicData(client: SupabaseClient, id: string): Promise<void> {
  check(await client.from('market_public_data').delete().eq('id', id));
}

export async function listBusinessUsers(client: SupabaseClient): Promise<BusinessUser[]> {
  return check(await client.rpc('admin_list_business_users')) as BusinessUser[];
}

export async function setBusinessUser(client: SupabaseClient, email: string, orgName: string, active: boolean): Promise<void> {
  check(await client.rpc('admin_set_business_user', { p_email: email, p_org_name: orgName, p_active: active }));
}

export async function rebuildMarketStats(client: SupabaseClient, from: string, to: string): Promise<number> {
  return check(await client.rpc('admin_rebuild_market_stats', { p_from: from, p_to: to })) as number;
}

/** 가격 구간 입력 '7000, 9000, 12000' → 오름차순 양수 배열 (아니면 null) */
export function parsePriceBands(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean).map((p) => Number(p.replace(/원$/, '')));
  if (parts.length < 1 || parts.length > 9) return null;
  if (parts.some((n, i) => !Number.isInteger(n) || n <= 0 || (i > 0 && n <= parts[i - 1]))) return null;
  return parts;
}

/** 경계 GeoJSON 입력 검사 — Polygon·MultiPolygon만 (Feature면 geometry를 꺼낸다) */
export function parseBoundary(text: string): { ok: true; value: unknown | null } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: null };
  let v: { type?: string; geometry?: unknown; coordinates?: unknown };
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'GeoJSON 형식이 아니에요.' };
  }
  if (v?.type === 'Feature') v = v.geometry as typeof v;
  if (v?.type !== 'Polygon' && v?.type !== 'MultiPolygon') return { ok: false, error: 'Polygon 또는 MultiPolygon만 쓸 수 있어요.' };
  if (!Array.isArray(v.coordinates)) return { ok: false, error: '좌표가 없어요.' };
  return { ok: true, value: v };
}
