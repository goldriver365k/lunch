import { describe, expect, it } from 'vitest';
import { PILOT_AREAS } from '../data/pilotAreas';
import { pilotRestaurants } from '../data/mockRestaurants';
import { distanceM } from './geo';
import {
  applyLiveOrders,
  filterRestaurants,
  formatDistance,
  formatPrice,
  queryRestaurants,
  sortRestaurants,
  type RestaurantQuery,
} from './restaurants';

const area = PILOT_AREAS[0];
const list = pilotRestaurants(area.id);
const base: RestaurantQuery = {
  mode: 'walk',
  radius: 300,
  category: null,
  keyword: '',
  sort: 'popular',
  origin: area.center,
};

describe('filterRestaurants', () => {
  it('거리는 기준점과 매장 좌표로 계산한 직선거리다', () => {
    for (const r of filterRestaurants(list, base)) {
      expect(r.distanceM).toBe(Math.round(distanceM(area.center, r.location)));
    }
  });

  it.each([100, 200, 300] as const)('도보 식사: 반경 %im 이내만 보여준다', (radius) => {
    const out = filterRestaurants(list, { ...base, radius });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.distanceM <= radius && r.modes.includes('walk'))).toBe(true);
  });

  it('반경이 넓을수록 결과가 늘어난다', () => {
    const counts = ([100, 200, 300] as const).map((radius) => filterRestaurants(list, { ...base, radius }).length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it('포장: 반경과 포장 가능 여부를 함께 적용한다', () => {
    const out = filterRestaurants(list, { ...base, mode: 'takeout', radius: 100 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.distanceM <= 100 && r.modes.includes('takeout'))).toBe(true);
  });

  it('배달: 검색 반경 대신 매장별 배달 가능 거리를 적용한다', () => {
    const out = filterRestaurants(list, { ...base, mode: 'delivery', radius: 100 });
    expect(out.some((r) => r.distanceM > 300)).toBe(true);
    expect(out.every((r) => r.modes.includes('delivery'))).toBe(true);
    // 3.6km 떨어진 '한우 국밥집'은 배달 가능 거리(3km) 밖
    expect(out.map((r) => r.name)).not.toContain('한우 국밥집');
  });

  it('음식 종류로 거른다', () => {
    const out = filterRestaurants(list, { ...base, category: '중식' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.category === '중식')).toBe(true);
  });

  it('키워드는 가게 이름·종류·메뉴명에서 찾는다', () => {
    expect(filterRestaurants(list, { ...base, keyword: '짬뽕' }).map((r) => r.name)).toEqual(['빨간짬뽕집']);
    expect(filterRestaurants(list, { ...base, keyword: '일식' }).every((r) => r.category === '일식')).toBe(true);
    expect(filterRestaurants(list, { ...base, keyword: '없는메뉴' })).toEqual([]);
  });
});

describe('sortRestaurants', () => {
  const results = filterRestaurants(list, { ...base, mode: 'delivery' });

  it('기본(최근 주문 많은 순)은 주문 수 내림차순', () => {
    const out = sortRestaurants(results, 'popular');
    for (let i = 1; i < out.length; i++) expect(out[i - 1].recentOrders).toBeGreaterThanOrEqual(out[i].recentOrders);
  });

  it('거리순은 직선거리 오름차순', () => {
    const out = sortRestaurants(results, 'distance');
    for (let i = 1; i < out.length; i++) expect(out[i - 1].distanceM).toBeLessThanOrEqual(out[i].distanceM);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const before = list.map((r) => r.id);
    queryRestaurants(list, { ...base, sort: 'distance' });
    expect(list.map((r) => r.id)).toEqual(before);
  });
});

describe('formatters & simulation', () => {
  it('가격과 거리를 표시 형식으로 바꾼다', () => {
    expect(formatPrice(9000)).toBe('9,000원');
    expect(formatDistance(45)).toBe('45m');
    expect(formatDistance(1200)).toBe('1.2km');
  });

  it('가상 실시간 변동: tick 0은 그대로, 이후에도 음수가 되지 않고 결정적이다', () => {
    expect(applyLiveOrders(list, 0)).toBe(list);
    const zero = [{ ...list[0], recentOrders: 0 }];
    for (let t = 1; t < 20; t++) expect(applyLiveOrders(zero, t)[0].recentOrders).toBeGreaterThanOrEqual(0);
    expect(applyLiveOrders(list, 3)).toEqual(applyLiveOrders(list, 3));
  });
});
