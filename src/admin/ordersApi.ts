import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalOrder, OrderProvider } from '../../supabase/functions/_shared/canonicalOrder.ts';

/**
 * 관리자 주문 데이터 작업. 권한은 DB(RLS·is_admin·ingest_orders 내부 검사)가 다시 확인한다.
 * API 인증정보 값은 다루지 않는다 — 서버 비밀값의 '이름'(credential_ref)만 저장한다.
 */

export const PROVIDER_LABEL: Record<OrderProvider, string> = {
  pos: '홀 POS',
  baemin: '배달의민족',
  coupangeats: '쿠팡이츠',
  csv: '주문 CSV',
};

export type ConnectionStatus = 'preparing' | 'pending_approval' | 'active' | 'paused' | 'error';

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  preparing: '연동 준비',
  pending_approval: '승인 대기',
  active: '수집 중',
  paused: '일시중지',
  error: '오류',
};

export const CHANNEL_LABEL = { HALL: '홀', DELIVERY: '배달', PICKUP: '포장', UNKNOWN: '구분 불가' } as const;
export type Channel = keyof typeof CHANNEL_LABEL;

export interface OrderConnection {
  id: string;
  restaurant_id: string;
  provider: OrderProvider;
  vendor: string | null;
  external_store_id: string | null;
  ingest_mode: 'webhook' | 'polling' | 'file';
  status: ConnectionStatus;
  store_consent: boolean;
  provider_permission: boolean;
  public_allowed: boolean;
  is_test: boolean;
  test_simulate_error: boolean;
  credential_ref: string | null;
  unit_cost_krw: number;
  monthly_call_limit: number | null;
  calls_month: string | null;
  calls_this_month: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  restaurants?: { name: string } | null;
}

export type ConnectionInput = Pick<
  OrderConnection,
  | 'restaurant_id'
  | 'provider'
  | 'vendor'
  | 'external_store_id'
  | 'ingest_mode'
  | 'store_consent'
  | 'provider_permission'
  | 'public_allowed'
  | 'credential_ref'
  | 'unit_cost_krw'
  | 'monthly_call_limit'
>;

export interface OrderOverview {
  connected_restaurants: number;
  healthy_restaurants: number;
  error_restaurants: number;
  preparing_connections: number;
  today: Record<Channel, number>;
  last_10m: number;
  needs_review: number;
  unmatched_items: number;
  last_collected_at: string | null;
  last_success_at: string | null;
}

export interface RestaurantOrderStats {
  connections: Pick<OrderConnection, 'id' | 'provider' | 'vendor' | 'status' | 'ingest_mode' | 'public_allowed' | 'last_success_at' | 'last_error' | 'last_error_at'>[];
  today_by_channel: Partial<Record<Channel, { count: number; net_amount: number; gross_amount: number }>>;
  today_by_provider: Partial<Record<OrderProvider, number>>;
  windows: Record<'10m' | '30m' | '60m', Record<'HALL' | 'DELIVERY' | 'PICKUP', number>>;
  menu_quantities: { channel: Channel; name: string; quantity: number; matched: boolean }[];
  cancelled_today: number;
  refund_today: number;
  needs_review: number;
}

export interface IngestResult {
  ok: boolean;
  error?: string;
  inserted: number;
  updated: number;
  merged: number;
  needs_review: number;
  items: number;
  unmatched_items: number;
}

export interface OrderSettings {
  min_public_count: number;
  monthly_budget_krw: number;
  stale_after_minutes: number;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function fetchOrderOverview(client: SupabaseClient, test: boolean): Promise<OrderOverview> {
  return check(await client.rpc('admin_order_overview', { p_test: test })) as OrderOverview;
}

export async function fetchRestaurantOrderStats(client: SupabaseClient, restaurantId: string, test: boolean): Promise<RestaurantOrderStats> {
  return check(await client.rpc('admin_restaurant_order_stats', { p_restaurant_id: restaurantId, p_test: test })) as RestaurantOrderStats;
}

export async function listConnections(client: SupabaseClient, test: boolean): Promise<OrderConnection[]> {
  return check(
    await client.from('order_connections').select('*, restaurants(name)').eq('is_test', test).order('created_at'),
  ) as OrderConnection[];
}

export async function createConnection(client: SupabaseClient, input: ConnectionInput): Promise<OrderConnection> {
  // 새 실제 연동은 항상 '연동 준비'로 시작한다 (계약·동의 확인 후 관리자가 활성화)
  return check(
    await client.from('order_connections').insert({ ...input, status: 'preparing', is_test: false }).select().single(),
  ) as OrderConnection;
}

export async function updateConnection(client: SupabaseClient, id: string, patch: Partial<OrderConnection>): Promise<void> {
  check(await client.from('order_connections').update(patch).eq('id', id));
}

/** 테스트 연동 — 매장·제공처별로 하나. 외부와 연결되지 않는다 */
export async function ensureTestConnection(client: SupabaseClient, restaurantId: string, provider: OrderProvider): Promise<OrderConnection> {
  return check(
    await client
      .from('order_connections')
      .upsert(
        {
          restaurant_id: restaurantId,
          provider,
          is_test: true,
          status: 'active',
          vendor: '가상 연결(테스트)',
          ingest_mode: provider === 'csv' ? 'file' : 'webhook',
          store_consent: true,
          provider_permission: true,
          public_allowed: false,
        },
        { onConflict: 'restaurant_id,provider,is_test' },
      )
      .select()
      .single(),
  ) as OrderConnection;
}

/** 200건씩 나눠 수집. 같은 주문번호는 DB에서 갱신되므로 다시 올려도 늘지 않는다 */
export async function ingestOrders(
  client: SupabaseClient,
  connectionId: string,
  orders: CanonicalOrder[],
  onProgress?: (done: number) => void,
): Promise<IngestResult> {
  const total: IngestResult = { ok: true, inserted: 0, updated: 0, merged: 0, needs_review: 0, items: 0, unmatched_items: 0 };
  for (let i = 0; i < orders.length || i === 0; i += 200) {
    const r = check(
      await client.rpc('ingest_orders', { p_connection_id: connectionId, p_orders: orders.slice(i, i + 200) }),
    ) as IngestResult;
    if (!r.ok) return { ...total, ok: false, error: r.error };
    for (const k of ['inserted', 'updated', 'merged', 'needs_review', 'items', 'unmatched_items'] as const) total[k] += r[k] ?? 0;
    onProgress?.(Math.min(i + 200, orders.length));
    if (orders.length === 0) break;
  }
  return total;
}

export interface ReviewOrder {
  id: string;
  restaurant_id: string;
  external_order_id: string;
  provider: OrderProvider;
  channel: Channel;
  ordered_at: string;
  total_amount: number;
  restaurants: { name: string } | null;
  duplicate: { external_order_id: string; provider: OrderProvider; ordered_at: string; total_amount: number } | null;
}

export async function listReviewOrders(client: SupabaseClient, test: boolean): Promise<ReviewOrder[]> {
  return check(
    await client
      .from('orders')
      .select(
        'id, restaurant_id, external_order_id, provider, channel, ordered_at, total_amount, restaurants(name), duplicate:duplicate_of(external_order_id, provider, ordered_at, total_amount)',
      )
      .eq('dedup_status', 'possible_duplicate')
      .eq('is_test', test)
      .order('ordered_at', { ascending: false })
      .limit(100),
  ) as unknown as ReviewOrder[];
}

export async function resolveDuplicate(client: SupabaseClient, orderId: string, action: 'separate' | 'duplicate'): Promise<void> {
  check(await client.rpc('admin_resolve_duplicate', { p_order_id: orderId, p_action: action }));
}

export interface UnmatchedMenu {
  restaurant_id: string;
  restaurant_name: string;
  external_menu_name: string;
  count: number;
}

export async function listUnmatchedMenus(client: SupabaseClient, test: boolean): Promise<UnmatchedMenu[]> {
  const rows = check(
    await client
      .from('order_items')
      .select('restaurant_id, external_menu_name, restaurants(name), orders!inner(is_test)')
      .eq('match_status', 'unmatched')
      .eq('orders.is_test', test)
      .limit(1000),
  ) as unknown as { restaurant_id: string; external_menu_name: string; restaurants: { name: string } | null }[];
  const grouped = new Map<string, UnmatchedMenu>();
  for (const r of rows) {
    const key = `${r.restaurant_id}|${r.external_menu_name}`;
    const g = grouped.get(key) ?? {
      restaurant_id: r.restaurant_id,
      restaurant_name: r.restaurants?.name ?? '',
      external_menu_name: r.external_menu_name,
      count: 0,
    };
    g.count++;
    grouped.set(key, g);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

export async function mapMenu(client: SupabaseClient, restaurantId: string, externalName: string, menuId: string | null): Promise<number> {
  return check(
    await client.rpc('admin_map_menu', { p_restaurant_id: restaurantId, p_external_name: externalName, p_menu_id: menuId }),
  ) as number;
}

export async function deleteTestOrders(client: SupabaseClient): Promise<number> {
  return check(await client.rpc('admin_delete_test_orders')) as number;
}

export async function refreshAggregates(client: SupabaseClient, restaurantId: string): Promise<void> {
  check(await client.rpc('refresh_order_aggregates', { p_restaurant_ids: [restaurantId] }));
}

export interface AggregateRow {
  window_key: string;
  channel: Channel;
  order_count: number;
  net_amount: number;
  menu_quantities: { name: string; quantity: number }[];
}

export async function fetchAggregates(client: SupabaseClient, restaurantId: string, scope: 'test' | 'internal' | 'public'): Promise<AggregateRow[]> {
  return check(
    await client
      .from('order_aggregates')
      .select('window_key, channel, order_count, net_amount, menu_quantities')
      .eq('restaurant_id', restaurantId)
      .eq('scope', scope),
  ) as AggregateRow[];
}

export async function fetchOrderSettings(client: SupabaseClient): Promise<OrderSettings> {
  return check(
    await client.from('order_settings').select('min_public_count, monthly_budget_krw, stale_after_minutes').single(),
  ) as OrderSettings;
}

export async function saveOrderSettings(client: SupabaseClient, s: OrderSettings): Promise<void> {
  check(await client.from('order_settings').update({ ...s, updated_at: new Date().toISOString() }).eq('id', true));
}

/** 한국시간 'YYYY-MM' */
export function kstMonth(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}

/** 이번 달 호출량·비용과 월말 예상 비용 (일 평균 × 이번 달 일수) */
export function estimateCost(c: Pick<OrderConnection, 'calls_month' | 'calls_this_month' | 'unit_cost_krw'>, now = new Date()) {
  const calls = c.calls_month === kstMonth(now) ? c.calls_this_month : 0;
  const kst = new Date(now.getTime() + 9 * 3600000);
  const day = kst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0)).getUTCDate();
  const cost = calls * Number(c.unit_cost_krw);
  return { calls, cost, projected: Math.round((cost / day) * daysInMonth) };
}
