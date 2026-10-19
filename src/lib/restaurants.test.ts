import { describe, expect, it } from 'vitest';
import { MOCK_RESTAURANTS } from '../data/mockRestaurants';
import {
  filterRestaurants,
  formatDistance,
  formatPrice,
  queryRestaurants,
  simulateLiveOrders,
  sortRestaurants,
  type RestaurantQuery,
} from './restaurants';

const base: RestaurantQuery = { mode: 'walk', radius: 100, category: null, keyword: '', sort: 'popular' };

describe('filterRestaurants', () => {
  it.each([30, 50, 70, 100] as const)('도보 식사: 반경 %im 이내만 보여준다', (radius) => {
    const out = filterRestaurants(MOCK_RESTAURANTS, { ...base, radius });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.distanceM <= radius && r.modes.includes('walk'))).toBe(true);
  });

  it('포장: 반경과 포장 가능 여부를 함께 적용한다', () => {
    const out = filterRestaurants(MOCK_RESTAURANTS, { ...base, mode: 'takeout', radius: 50 });
    expect(out.every((r) => r.distanceM <= 50 && r.modes.includes('takeout'))).toBe(true);
  });

  it('배달: 반경을 적용하지 않는다', () => {
    const out = filterRestaurants(MOCK_RESTAURANTS, { ...base, mode: 'delivery', radius: 30 });
    expect(out.some((r) => r.distanceM > 100)).toBe(true);
    expect(out.every((r) => r.modes.includes('delivery'))).toBe(true);
  });

  it('음식 종류로 거른다', () => {
    const out = filterRestaurants(MOCK_RESTAURANTS, { ...base, category: '중식' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.category === '중식')).toBe(true);
  });

  it('키워드는 가게 이름·종류·메뉴명에서 찾는다', () => {
    expect(filterRestaurants(MOCK_RESTAURANTS, { ...base, keyword: '짬뽕' }).map((r) => r.id)).toEqual(['m04']);
    expect(filterRestaurants(MOCK_RESTAURANTS, { ...base, keyword: '일식' }).every((r) => r.category === '일식')).toBe(true);
    expect(filterRestaurants(MOCK_RESTAURANTS, { ...base, keyword: '없는메뉴' })).toEqual([]);
  });
});

describe('sortRestaurants', () => {
  it('인기순은 최근 주문 수 내림차순', () => {
    const out = sortRestaurants(MOCK_RESTAURANTS, 'popular');
    for (let i = 1; i < out.length; i++) expect(out[i - 1].recentOrders).toBeGreaterThanOrEqual(out[i].recentOrders);
  });

  it('거리순은 거리 오름차순', () => {
    const out = sortRestaurants(MOCK_RESTAURANTS, 'distance');
    for (let i = 1; i < out.length; i++) expect(out[i - 1].distanceM).toBeLessThanOrEqual(out[i].distanceM);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const before = MOCK_RESTAURANTS.map((r) => r.id);
    queryRestaurants(MOCK_RESTAURANTS, { ...base, sort: 'distance' });
    expect(MOCK_RESTAURANTS.map((r) => r.id)).toEqual(before);
  });
});

describe('formatters & simulation', () => {
  it('가격과 거리를 표시 형식으로 바꾼다', () => {
    expect(formatPrice(9000)).toBe('9,000원');
    expect(formatDistance(45)).toBe('45m');
    expect(formatDistance(1200)).toBe('1.2km');
  });

  it('가상 실시간 변동은 음수가 되지 않는다', () => {
    const out = simulateLiveOrders([{ ...MOCK_RESTAURANTS[0], recentOrders: 0 }], () => 0);
    expect(out[0].recentOrders).toBe(0);
  });
});
