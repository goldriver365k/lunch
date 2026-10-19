import type { Category, GeoPoint, Mode, Radius, Restaurant, RestaurantResult, SortKey } from '../types';
import { DEFAULT_DELIVERY_RADIUS_M, usesRadius } from './constants';
import { distanceM } from './geo';

export interface RestaurantQuery {
  mode: Mode;
  radius: Radius;
  category: Category | null;
  keyword: string;
  sort: SortKey;
  /** 거리 계산 기준점 — 도보·포장은 현재 위치, 배달은 배달 주소 */
  origin: GeoPoint;
}

function matchesKeyword(r: Restaurant, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return (
    r.name.toLowerCase().includes(q) ||
    r.category.toLowerCase().includes(q) ||
    r.menus.some((m) => m.name.toLowerCase().includes(q))
  );
}

export function withDistance(list: Restaurant[], origin: GeoPoint): RestaurantResult[] {
  return list.map((r) => ({ ...r, distanceM: Math.round(distanceM(origin, r.location)) }));
}

function withinRange(r: RestaurantResult, mode: Mode, radius: Radius): boolean {
  if (usesRadius(mode)) return r.distanceM <= radius;
  return r.distanceM <= (r.deliveryRadiusM ?? DEFAULT_DELIVERY_RADIUS_M);
}

export function filterRestaurants(list: Restaurant[], query: RestaurantQuery): RestaurantResult[] {
  return withDistance(list, query.origin).filter(
    (r) =>
      r.modes.includes(query.mode) &&
      withinRange(r, query.mode, query.radius) &&
      (query.category === null || r.category === query.category) &&
      matchesKeyword(r, query.keyword),
  );
}

export function sortRestaurants(list: RestaurantResult[], sort: SortKey): RestaurantResult[] {
  const copy = [...list];
  if (sort === 'distance') {
    copy.sort((a, b) => a.distanceM - b.distanceM || b.recentOrders - a.recentOrders);
  } else {
    copy.sort((a, b) => b.recentOrders - a.recentOrders || a.distanceM - b.distanceM);
  }
  return copy;
}

export function queryRestaurants(list: Restaurant[], query: RestaurantQuery): RestaurantResult[] {
  return sortRestaurants(filterRestaurants(list, query), query.sort);
}

export function formatPrice(won: number): string {
  return `${won.toLocaleString('ko-KR')}원`;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** 문자열을 0 이상의 정수로 바꾸는 간단한 해시 (FNV-1a) */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 실시간 주문 변동을 흉내 내는 가상 시뮬레이션.
 * 실제 주문 데이터가 아니며, tick마다 각 가게 주문 수를 -3~+5 범위에서 결정적으로 바꾼다.
 * tick 0은 원래 값을 그대로 돌려준다.
 */
export function applyLiveOrders<T extends Restaurant>(list: T[], tick: number): T[] {
  if (tick === 0) return list;
  return list.map((r) => ({
    ...r,
    recentOrders: Math.max(0, r.recentOrders + (hashString(`${r.id}:${tick}`) % 9) - 3),
  }));
}
