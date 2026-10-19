import { useEffect, useMemo, useState } from 'react';
import type { Category, GeoPoint, Mode, Radius, RestaurantResult, SortKey } from '../types';
import { MOCK_UPDATED_AT, mockDatasetFor } from '../data/mockRestaurants';
import { searchRestaurantsDb } from '../lib/db/restaurantsApi';
import { applyLiveOrders, hasOrderData, queryRestaurants, sortRestaurants, withDistance } from '../lib/restaurants';
import { supabase } from '../lib/supabase';

/** 가상 실시간 주문 갱신 주기 (ms) — 가상 데이터에서만 */
const LIVE_TICK_MS = 15000;

export interface RestaurantQueryInput {
  origin: GeoPoint | null;
  mode: Mode;
  radius: Radius;
  category: Category | null;
  keyword: string;
  sort: SortKey;
}

export interface RestaurantData {
  source: 'mock' | 'db';
  results: RestaurantResult[];
  loading: boolean;
  error: string | null;
  /** 결과에 실시간 주문정보가 있는지 — 없으면 거리순 */
  hasOrders: boolean;
  /** 지정한 ID의 매장 하나 — 상세화면용 */
  find: (id: string) => RestaurantResult | null;
  /** 가상 데이터: 시범 지역 이름 (아니면 null) */
  mockAreaName: string | null;
  retry: () => void;
}

/**
 * 음식점 목록.
 * - Supabase가 설정돼 있으면 실제 DB만 (서버 반경 검색)
 * - 아니면 기존 가상 데이터만
 * 두 데이터는 섞지 않는다.
 */
export function useRestaurantData(q: RestaurantQueryInput): RestaurantData {
  const db = supabase;
  const { origin, mode, radius, category, keyword, sort } = q;

  // ── 가상 데이터 ──
  const [live, setLive] = useState({ tick: 0, updatedAt: MOCK_UPDATED_AT });
  useEffect(() => {
    if (db) return;
    const id = setInterval(
      () => setLive((l) => ({ tick: l.tick + 1, updatedAt: new Date().toISOString() })),
      LIVE_TICK_MS,
    );
    return () => clearInterval(id);
  }, [db]);
  const dataset = useMemo(() => (!db && origin ? mockDatasetFor(origin) : null), [db, origin]);
  const liveMock = useMemo(
    () => (dataset ? applyLiveOrders(dataset.restaurants, live.tick, live.updatedAt) : []),
    [dataset, live],
  );

  // ── 실제 DB ──
  const [dbState, setDbState] = useState<{ key: string; rows: RestaurantResult[]; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dbKey = origin ? JSON.stringify([origin.lat, origin.lng, mode, radius, category, keyword.trim(), attempt]) : '';
  useEffect(() => {
    if (!db || !origin) return;
    let cancelled = false;
    const handle = setTimeout(
      () => {
        searchRestaurantsDb(db, { origin, mode, radius, category, keyword })
          .then((rows) => !cancelled && setDbState({ key: dbKey, rows, error: null }))
          .catch(() => !cancelled && setDbState({ key: dbKey, rows: [], error: '음식점 정보를 불러오지 못했어요.' }));
      },
      keyword ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // dbKey가 검색 조건 전체를 담고 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dbKey]);

  const results = useMemo(() => {
    if (!origin) return [];
    if (!db) return queryRestaurants(liveMock, { mode, radius, category, keyword, sort, origin });
    const rows = dbState?.key === dbKey ? dbState.rows : (dbState?.rows ?? []);
    return sortRestaurants(rows, sort, mode);
  }, [db, origin, liveMock, mode, radius, category, keyword, sort, dbState, dbKey]);

  const find = (id: string): RestaurantResult | null => {
    if (!origin) return null;
    if (db) return results.find((r) => r.id === id) ?? null;
    const r = liveMock.find((x) => x.id === id);
    return r ? withDistance([r], origin)[0] : null;
  };

  return {
    source: db ? 'db' : 'mock',
    results,
    loading: !!db && !!origin && dbState?.key !== dbKey,
    error: db && dbState?.key === dbKey ? dbState.error : null,
    hasOrders: hasOrderData(results, mode),
    find,
    mockAreaName: dataset?.areaName ?? null,
    retry: () => setAttempt((a) => a + 1),
  };
}
