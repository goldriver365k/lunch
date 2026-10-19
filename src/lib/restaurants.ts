import type { Category, Mode, Radius, Restaurant, SortKey } from '../types';
import { usesRadius } from './constants';

export interface RestaurantQuery {
  mode: Mode;
  radius: Radius;
  category: Category | null;
  keyword: string;
  sort: SortKey;
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

export function filterRestaurants(list: Restaurant[], query: RestaurantQuery): Restaurant[] {
  return list.filter(
    (r) =>
      r.modes.includes(query.mode) &&
      (!usesRadius(query.mode) || r.distanceM <= query.radius) &&
      (query.category === null || r.category === query.category) &&
      matchesKeyword(r, query.keyword),
  );
}

export function sortRestaurants(list: Restaurant[], sort: SortKey): Restaurant[] {
  const copy = [...list];
  if (sort === 'distance') {
    copy.sort((a, b) => a.distanceM - b.distanceM || b.recentOrders - a.recentOrders);
  } else {
    copy.sort((a, b) => b.recentOrders - a.recentOrders || a.distanceM - b.distanceM);
  }
  return copy;
}

export function queryRestaurants(list: Restaurant[], query: RestaurantQuery): Restaurant[] {
  return sortRestaurants(filterRestaurants(list, query), query.sort);
}

export function formatPrice(won: number): string {
  return `${won.toLocaleString('ko-KR')}원`;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/**
 * 실시간 인기 변동을 흉내 내는 가상 시뮬레이션.
 * 실제 주문 데이터가 아니며, 각 가게 주문 수를 -2~+3 범위에서 무작위로 바꾼다.
 */
export function simulateLiveOrders(list: Restaurant[], random: () => number = Math.random): Restaurant[] {
  return list.map((r) => ({
    ...r,
    recentOrders: Math.max(0, r.recentOrders + Math.floor(random() * 6) - 2),
  }));
}
