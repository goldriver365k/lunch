/** 상권 분석 결과 — DB 함수 market_analysis가 돌려주는 모양 그대로 */

export type MarketPeriod = 'today' | '7d' | '30d' | '90d';
export type MarketScope = 'business' | 'internal' | 'test';
export type MarketChannel = 'HALL' | 'DELIVERY' | 'PICKUP';
export type ReliabilityStatus = 'none' | 'insufficient' | 'ok';

export interface MarketAreaInfo {
  id: string;
  name: string;
  sido: string;
  spatial_mode: 'radius' | 'boundary';
  radius_m: number;
  boundary_source: string | null;
  area_km2: number;
  /** 예: '기준점 반경 500m' */
  label: string;
}

export interface MarketCoverage {
  registered: number;
  operating: number;
  consented: number;
  collecting_recent: number;
  providing_stores: number;
  store_days: number;
  data_days: number;
  period_days: number;
  last_collected_at: string | null;
  delayed_stores: number;
  rate: number | null;
  rate_label: string;
  /** 관리자만 (사업자 범위에서는 null) */
  delayed_list: { name: string; provider: string; status: string; last_success_at: string | null; last_error: string | null }[] | null;
  unmatched_items: number | null;
  needs_review: number | null;
}

export interface MarketTotals {
  orders: number;
  amount_orders: number;
  amount_sum: number;
  avg: number | null;
  median: number | null;
  excluded_amount_orders: number;
  unknown_channel_orders: number;
  orders_per_store_day: number | null;
  orders_change_pct: number | null;
  avg_change_pct: number | null;
}

export interface MarketChannelStat {
  channel: MarketChannel;
  orders: number;
  share: number | null;
  stores: number;
  amount_orders: number;
  amount_sum: number;
  avg: number | null;
  median: number | null;
  orders_change_pct: number | null;
  avg_change_pct: number | null;
  peak_slot: number | null;
  top_menus: { name: string; quantity: number }[];
  providers: Partial<Record<'pos' | 'baemin' | 'coupangeats' | 'csv', number>>;
}

export interface MarketPriceBand {
  lo: number;
  hi: number | null;
  orders: number;
  pct: number | null;
  change_pp: number | null;
  by_channel: Record<MarketChannel, { orders: number; pct: number | null }>;
}

export interface MarketMenuItem {
  name: string;
  grouped: boolean;
  quantity: number;
  amount_sum: number;
  avg_unit_price: number | null;
  stores: number;
  by_channel: Partial<Record<MarketChannel | 'UNKNOWN', number>>;
  peak_slot: number | null;
  change_pct: number | null;
}

export interface MarketSlot {
  orders: number;
  amount_sum: number;
  avg: number | null;
  channels: Partial<Record<MarketChannel | 'UNKNOWN', number>>;
  top_menu: string | null;
}

export interface MarketAnalysis {
  area: MarketAreaInfo;
  scope: MarketScope;
  period: {
    key: MarketPeriod;
    from: string;
    to: string;
    live: boolean;
    now_slot: number;
    compare_label: string;
    prev_from: string;
    prev_to: string;
  };
  lunch: { start_min: number; end_min: number };
  price_bounds: number[];
  as_of: string | null;
  refreshed_at: string | null;
  coverage: MarketCoverage;
  reliability: { status: ReliabilityStatus; reasons: string[]; warnings: string[]; min_stores: number; min_orders: number };
  totals: MarketTotals;
  channels: MarketChannelStat[];
  price_bands: MarketPriceBand[];
  menu_unit_prices: { quantity: number; bands: { lo: number; hi: number | null; quantity: number; pct: number }[] } | null;
  categories: { category: string; orders: number; pct: number | null; stores: number; avg: number | null; by_channel: Record<string, number> }[];
  menus: { items: MarketMenuItem[]; unclassified_quantity: number; total_quantity: number };
  slots_half: (MarketSlot & { slot: number })[];
  slots_hour: (MarketSlot & { from_slot: number; to_slot: number })[];
  weekdays: (Omit<MarketSlot, 'amount_sum'> & { dow: number; observed_days: number; avg_orders: number | null })[] | null;
  today_vs_last_week: {
    cutoff_slot: number;
    today_observed: boolean;
    last_week_observed: boolean;
    today_orders: number;
    last_week_orders: number;
    today_stores: number;
    last_week_stores: number;
    today_avg: number | null;
    last_week_avg: number | null;
  };
  public_data: MarketPublicData[];
}

export type PublicSource = 'seoul_golmok' | 'seoul_realtime' | 'gyeonggi' | 'seongnam' | 'other_public';

export interface MarketPublicData {
  id?: string;
  area_id?: string;
  source: PublicSource;
  dataset: string;
  metric: string;
  category: string | null;
  value: number | null;
  unit: string | null;
  period_label: string;
  base_date: string | null;
  source_updated_at: string | null;
  source_url: string | null;
  note: string | null;
}

export interface MarketCompareRow {
  area: MarketAreaInfo;
  scope: MarketScope;
  period: MarketAnalysis['period'];
  as_of: string | null;
  coverage: MarketCoverage;
  reliability: MarketAnalysis['reliability'];
  totals: MarketTotals;
  channels: { channel: MarketChannel; orders: number; share: number | null; avg: number | null }[];
  top_category: string | null;
  top_menu: string | null;
  peak_hour: (MarketSlot & { from_slot: number; to_slot: number }) | null;
}

export interface MarketCompare {
  /** 모든 지역이 같은 공간 단위(예: 반경 500m)일 때만 true */
  comparable: boolean;
  units: string[];
  areas: MarketCompareRow[];
}

export interface MarketAreaListItem {
  id: string;
  name: string;
  sido: string;
  spatial_mode: 'radius' | 'boundary';
  radius_m: number;
  business_visible: boolean;
}
