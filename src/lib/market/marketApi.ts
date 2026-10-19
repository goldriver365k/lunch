import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketAnalysis, MarketAreaListItem, MarketCompare, MarketPeriod } from './types';

/** 상권 분석은 모두 서버 함수로 계산한다. 권한(관리자·사업자)도 서버에서 다시 확인한다. */

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export type ViewerRole = 'admin' | 'business' | null;

export async function fetchViewerRole(client: SupabaseClient): Promise<ViewerRole> {
  const { data, error } = await client.rpc('market_viewer_role');
  if (error) return null;
  return data === 'admin' || data === 'business' ? data : null;
}

export async function fetchMarketAreas(client: SupabaseClient): Promise<MarketAreaListItem[]> {
  return check(await client.rpc('market_area_list')) as MarketAreaListItem[];
}

export interface MarketQuery {
  areaId: string;
  period: MarketPeriod;
  /** 관리자 테스트 데이터 */
  test?: boolean;
  /** 관리자가 사업자 화면과 같은 범위로 보기 */
  asBusiness?: boolean;
}

export async function fetchMarketAnalysis(client: SupabaseClient, q: MarketQuery): Promise<MarketAnalysis> {
  return check(
    await client.rpc('market_analysis', {
      p_area_id: q.areaId,
      p_period: q.period,
      p_test: q.test ?? false,
      p_as_business: q.asBusiness ?? false,
    }),
  ) as MarketAnalysis;
}

export async function fetchMarketCompare(
  client: SupabaseClient,
  areaIds: string[],
  q: Omit<MarketQuery, 'areaId'>,
): Promise<MarketCompare> {
  return check(
    await client.rpc('market_compare', {
      p_area_ids: areaIds,
      p_period: q.period,
      p_test: q.test ?? false,
      p_as_business: q.asBusiness ?? false,
    }),
  ) as MarketCompare;
}
