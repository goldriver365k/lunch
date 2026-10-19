import type { Category, GeoPoint, MenuItem, Mode, Radius, Restaurant, RestaurantResult, SortKey } from '../types';
import { DEFAULT_DELIVERY_RADIUS_M, usesRadius, WALK_M_PER_MIN } from './constants';
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

/** 해당 채널의 최근 주문 수 — 다른 채널 주문은 합산하지 않는다 */
export function ordersFor(r: Restaurant, mode: Mode): number {
  return r.recentOrders[mode] ?? 0;
}

export function sortRestaurants(list: RestaurantResult[], sort: SortKey, mode: Mode): RestaurantResult[] {
  const copy = [...list];
  if (sort === 'distance') {
    copy.sort((a, b) => a.distanceM - b.distanceM || ordersFor(b, mode) - ordersFor(a, mode));
  } else {
    copy.sort((a, b) => ordersFor(b, mode) - ordersFor(a, mode) || a.distanceM - b.distanceM);
  }
  return copy;
}

export function queryRestaurants(list: Restaurant[], query: RestaurantQuery): RestaurantResult[] {
  return sortRestaurants(filterRestaurants(list, query), query.sort, query.mode);
}

export interface PricedMenu {
  menu: MenuItem;
  price: number;
}

/**
 * 해당 채널에서 파는 메뉴와 그 채널 가격. 대표메뉴가 먼저, 나머지는 등록 순서대로.
 * 가격이 없는 메뉴는 그 채널에서 팔지 않는 것으로 보고 빼며, 가격을 다른 채널에서 빌려오지 않는다.
 */
export function menusForChannel(r: Restaurant, mode: Mode): PricedMenu[] {
  const priced = r.menus.flatMap((menu) => {
    const price = menu.prices[mode];
    return price === undefined ? [] : [{ menu, price }];
  });
  return [...priced.filter((p) => p.menu.signature), ...priced.filter((p) => !p.menu.signature)];
}

export function formatPrice(won: number): string {
  return `${won.toLocaleString('ko-KR')}원`;
}

/** 직선거리 기준 도보 예상 시간(분) — 실제 경로 시간은 외부 지도에서 확인 */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / WALK_M_PER_MIN));
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
 * 실제 주문 데이터가 아니며, tick마다 각 채널 주문 수를 -3~+5 범위에서 결정적으로 바꾼다.
 * tick 0은 원래 값을 그대로 돌려준다. 갱신시각은 updatedAt으로 바뀐다.
 */
export function applyLiveOrders<T extends Restaurant>(list: T[], tick: number, updatedAt: string): T[] {
  if (tick === 0) return list;
  return list.map((r) => {
    const recentOrders: Restaurant['recentOrders'] = {};
    for (const [mode, n] of Object.entries(r.recentOrders) as [Mode, number][]) {
      recentOrders[mode] = Math.max(0, n + (hashString(`${r.id}:${mode}:${tick}`) % 9) - 3);
    }
    return { ...r, recentOrders, dataSource: { ...r.dataSource, updatedAt } };
  });
}
