import type { SupabaseClient } from '@supabase/supabase-js';

/** 관리자 운영 현황. 권한은 DB(is_admin)가 다시 확인한다. */

export interface UsageOverview {
  day: string;
  visitors: number;
  sessions: number;
  searches: number;
  searches_by_mode: Partial<Record<'walk' | 'delivery' | 'takeout', number>>;
  detail_views: number;
  find_route: number;
  installs: number;
  gps_denied: number;
  gps_error: number;
  errors: number;
  error_details: { detail: string; count: number }[];
  by_area: { area: string; visitors: number; searches: number }[];
  by_hour: { hour: number; searches: number; visitors: number }[];
  last7: { day: string; visitors: number; searches: number }[];
}

export interface SystemStatus {
  checked_at: string;
  db_size_bytes: number;
  tables: { table: string; bytes: number; rows: number }[];
  usage_24h: number;
  connections: { provider: string; status: string; count: number }[];
  api_calls_month: number;
  api_cost_month_krw: number;
  monthly_budget_krw: number;
  last_success_at: string | null;
  errors: { restaurant: string; provider: string; error: string; at: string }[];
  settings: AppSettings;
}

export interface AppSettings {
  notice_message: string | null;
  live_orders_public: boolean;
  collection_paused: boolean;
  updated_at?: string;
}

export interface RegionQuality {
  region_id: string;
  region: string;
  search_public: boolean;
  live_public: boolean;
  total: number;
  public: number;
  open: number;
  not_open: number;
  coord_problem: number;
  needs_review: number;
  unverified: number;
  no_verified_date: number;
  category_other: number;
  channel_unknown: number;
  without_menu: number;
  menu_ready: number;
  price_unverified: number;
  possible_duplicates: number;
  live_ready: number;
  search_ready: boolean;
  searchable: number;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  table_name: string;
  op: string;
  row_count: number;
  sample_keys: string[];
}

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
  buildId: string;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function fetchUsage(client: SupabaseClient, day: string | null, includeTest: boolean): Promise<UsageOverview> {
  return check(await client.rpc('admin_usage_overview', { p_day: day, p_include_test: includeTest })) as UsageOverview;
}

export async function fetchSystemStatus(client: SupabaseClient): Promise<SystemStatus> {
  return check(await client.rpc('admin_system_status')) as SystemStatus;
}

export async function fetchDataQuality(client: SupabaseClient): Promise<RegionQuality[]> {
  return check(await client.rpc('admin_data_quality')) as RegionQuality[];
}

export async function saveAppSettings(client: SupabaseClient, patch: Partial<AppSettings>): Promise<void> {
  check(await client.from('app_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true));
}

export async function setRegionPublic(
  client: SupabaseClient,
  regionId: string,
  patch: Partial<Pick<RegionQuality, 'search_public' | 'live_public'>>,
): Promise<void> {
  check(await client.from('regions').update(patch).eq('id', regionId));
}

export async function listAudit(client: SupabaseClient, limit = 50): Promise<AuditRow[]> {
  return check(await client.from('admin_audit_log').select('*').order('id', { ascending: false }).limit(limit)) as AuditRow[];
}

/** 지금 배포된 버전 (캐시 없이) — 보고 있는 화면의 버전과 다르면 새로고침이 필요 */
export async function fetchDeployedVersion(): Promise<BuildInfo | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as BuildInfo) : null;
  } catch {
    return null;
  }
}

/** Supabase 무료 플랜 DB 용량 참고값 — 요금제는 바뀔 수 있어 공식 요금표로 다시 확인해야 한다 */
export const FREE_DB_LIMIT_BYTES = 500 * 1024 * 1024;

export function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
