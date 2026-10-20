import { useEffect, useMemo, useState } from 'react';
import type { Category, GeoPoint, Mode, Radius, RestaurantResult, SortKey } from '../types';
import { MOCK_UPDATED_AT, mockDatasetFor } from '../data/mockRestaurants';
import { fetchPublicSettings, searchRestaurantsDb } from '../lib/db/restaurantsApi';
import { applyLiveOrders, hasOrderData, queryRestaurants, withDistance } from '../lib/restaurants';
import { supabase } from '../lib/supabase';

/** 화면 새로고침 기본 간격(초) — 관리자 설정을 받기 전까지 */
const DEFAULT_REFRESH_SEC = 60;

/** 가상 실시간 주문 갱신 주기 (ms) — 가상 데이터에서만 */
const LIVE_TICK_MS = 15000;

export interface RestaurantQueryInput {
  origin: GeoPoint | null;
  mode: Mode;
  radius: Radius;
  category: Category | null;
  keyword: string;
  sort: SortKey;
  /** 관리자 테스트 모드 — 테스트 주문 집계 표시 */
  includeTest?: boolean;
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
  /** 관리자 점검·공지 (없으면 null) */
  notice: string | null;
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
  const { origin, mode, radius, category, keyword, sort, includeTest = false } = q;

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
  // 순위는 서버가 계산한다. 정렬을 바꾸면 서버에 다시 요청하고, 받은 순서를 그대로 쓴다.
  const [dbState, setDbState] = useState<{ key: string; rows: RestaurantResult[]; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshSec, setRefreshSec] = useState(DEFAULT_REFRESH_SEC);
  const [notice, setNotice] = useState<string | null>(null);
  const dbKey = origin
    ? JSON.stringify([origin.lat, origin.lng, mode, radius, category, keyword.trim(), includeTest, sort, attempt])
    : '';
  const hasOrigin = origin !== null;

  useEffect(() => {
    if (!db) return;
    fetchPublicSettings(db).then((st) => {
      setRefreshSec(st.refreshSec);
      setNotice(st.notice);
    });
  }, [db]);

  // 화면 자동 새로고침 — 주문 수집 주기와 별개. 화면이 보일 때만 돌고, 다시 보이면 바로 한 번 확인한다.
  useEffect(() => {
    if (!db || !hasOrigin) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const start = () => {
      stop();
      id = setInterval(() => setRefreshTick((t) => t + 1), refreshSec * 1000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        setRefreshTick((t) => t + 1);
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [db, hasOrigin, refreshSec]);

  useEffect(() => {
    if (!db || !origin) return;
    let cancelled = false;
    // 조건이 바뀌면 이전 요청은 취소한다 (늦게 온 옛 결과가 새 결과를 덮지 않게, 데이터도 아끼게)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const handle = setTimeout(
      () => {
        searchRestaurantsDb(db, { origin, mode, radius, category, keyword, includeTest, sort }, ctrl?.signal)
          .then((rows) => {
            if (cancelled) return;
            // 바뀐 것이 없으면 상태를 그대로 둔다 (새 주문이 생긴 것처럼 다시 그리지 않음)
            setDbState((prev) =>
              prev && prev.key === dbKey && !prev.error && JSON.stringify(prev.rows) === JSON.stringify(rows)
                ? prev
                : { key: dbKey, rows, error: null },
            );
          })
          .catch(() => {
            if (cancelled) return;
            // 자동 새로고침이 실패하면 보던 목록을 그대로 둔다
            setDbState((prev) =>
              prev && prev.key === dbKey && !prev.error ? prev : { key: dbKey, rows: [], error: '음식점 정보를 불러오지 못했어요.' },
            );
          });
      },
      keyword ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
      ctrl?.abort();
    };
    // dbKey가 검색 조건 전체를, refreshTick이 자동 새로고침을 담고 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dbKey, refreshTick]);

  const results = useMemo(() => {
    if (!origin) return [];
    if (!db) return queryRestaurants(liveMock, { mode, radius, category, keyword, sort, origin });
    return dbState?.key === dbKey ? dbState.rows : (dbState?.rows ?? []);
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
    // DB: 주문 데이터로 순위가 매겨진 매장(그룹 0)이 하나라도 있는지
    hasOrders: db ? results.some((r) => r.rankGroup === 0) : hasOrderData(results, mode),
    find,
    mockAreaName: dataset?.areaName ?? null,
    notice,
    retry: () => setAttempt((a) => a + 1),
  };
}
