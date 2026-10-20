import type { SupabaseClient } from '@supabase/supabase-js';
import { STATIONS } from '../data/stations';
import type { GeoPoint, Mode } from '../types';
import { distanceM } from './geo';

/**
 * 이용 통계 기록 — 개인 위치·개인정보 없이.
 * 이용자 수: 이 기기에 저장한 임의 ID / 세션 수: 탭마다 새 임의 ID.
 * 위치는 서버로 보내지 않고, 기기에서 가까운 시범 지역 이름(예: seolleung)만 계산해 보낸다.
 */
export type UsageEvent = 'visit' | 'search' | 'detail_view' | 'find_route' | 'install' | 'gps_denied' | 'gps_error' | 'error';

const VISITOR_KEY = 'mwomeok.visitor';
const SESSION_KEY = 'mwomeok.session';
const AREA_RADIUS_M = 1500;

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function stored(storage: () => Storage, key: string): string {
  try {
    const s = storage();
    let v = s.getItem(key);
    if (!v) {
      v = randomId();
      s.setItem(key, v);
    }
    return v;
  } catch {
    return randomId();
  }
}

/** 가까운 시범 지역 (1.5km 안), 없으면 other, 위치가 없으면 unknown */
export function usageArea(point: GeoPoint | null): string {
  if (!point) return 'unknown';
  let best: { id: string; d: number } | null = null;
  for (const s of Object.values(STATIONS)) {
    const d = distanceM(point, s.point);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best && best.d <= AREA_RADIUS_M ? best.id : 'other';
}

export interface UsageContext {
  mode?: Mode | null;
  point?: GeoPoint | null;
  /** 관리자 테스트 위치 — 일반 이용자 통계에서 뺀다 */
  test?: boolean;
  detail?: string;
}

/** 자동 테스트에서는 화면 테스트가 서버 호출 순서에 영향받지 않도록 기록하지 않는다 (sendUsage는 따로 시험) */
const ENABLED = import.meta.env.MODE !== 'test';

export function logUsage(client: SupabaseClient | null, event: UsageEvent, ctx: UsageContext = {}): void {
  if (ENABLED) sendUsage(client, event, ctx);
}

export function sendUsage(client: SupabaseClient | null, event: UsageEvent, ctx: UsageContext = {}): void {
  if (!client) return;
  const visitor = stored(() => localStorage, VISITOR_KEY);
  const session = stored(() => sessionStorage, SESSION_KEY);
  // 기록 실패는 화면에 영향을 주지 않는다
  void Promise.resolve(
    client.rpc('log_usage', {
      p_visitor: visitor,
      p_session: session,
      p_event: event,
      p_mode: ctx.mode ?? null,
      p_area: ctx.point === undefined ? null : usageArea(ctx.point),
      p_test: ctx.test ?? false,
      p_detail: ctx.detail?.slice(0, 60) ?? null,
    }),
  ).catch(() => {});
}
