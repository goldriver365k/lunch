import { describe, expect, it } from 'vitest';
import type { Restaurant } from '../types';
import { PILOT_AREAS } from '../data/pilotAreas';
import { pilotRestaurants } from '../data/mockRestaurants';
import { distanceM } from './geo';
import {
  applyLiveOrders,
  filterRestaurants,
  formatDistance,
  formatPrice,
  menusForChannel,
  ordersFor,
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

  it('기본(최근 주문 많은 순)은 해당 채널 주문 수 내림차순', () => {
    const out = sortRestaurants(results, 'popular', 'delivery');
    for (let i = 1; i < out.length; i++)
      expect(ordersFor(out[i - 1], 'delivery')!).toBeGreaterThanOrEqual(ordersFor(out[i], 'delivery')!);
  });

  it('배달 주문과 홀 주문은 합산하지 않는다', () => {
    const jjamppong = list.find((r) => r.name === '빨간짬뽕집')!;
    expect(ordersFor(jjamppong, 'walk')).toBe(jjamppong.recentOrders.walk);
    expect(ordersFor(jjamppong, 'delivery')).toBe(jjamppong.recentOrders.delivery);
    expect(ordersFor(jjamppong, 'walk')).not.toBe(ordersFor(jjamppong, 'delivery'));
    // 홀만 하는 매장의 배달 주문은 0건이 아니라 '정보 없음'
    expect(ordersFor(list.find((r) => r.name === '골목집 백반')!, 'delivery')).toBeUndefined();
  });

  it('거리순은 직선거리 오름차순', () => {
    const out = sortRestaurants(results, 'distance', 'delivery');
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

  it('가상 실시간 변동: tick 0은 그대로, 이후에도 음수가 되지 않고 결정적이며 갱신시각을 바꾼다', () => {
    const at = '2026-10-19T03:00:00.000Z';
    expect(applyLiveOrders(list, 0, at)).toBe(list);
    const zero: Restaurant[] = [{ ...list[0], recentOrders: { walk: 0, takeout: 0 } }];
    for (let t = 1; t < 20; t++) {
      const r = applyLiveOrders(zero, t, at)[0];
      expect(r.recentOrders.walk).toBeGreaterThanOrEqual(0);
      expect(r.recentOrders.delivery).toBeUndefined();
    }
    expect(applyLiveOrders(list, 3, at)).toEqual(applyLiveOrders(list, 3, at));
    expect(applyLiveOrders(list, 3, at)[0].dataSource.updatedAt).toBe(at);
  });
});

describe('menusForChannel — 홀·배달·포장 가격 분리', () => {
  const jjamppong = list.find((r) => r.name === '빨간짬뽕집')!;

  it('채널별 가격을 따로 쓴다', () => {
    const price = (mode: 'walk' | 'takeout' | 'delivery') =>
      menusForChannel(jjamppong, mode).find((p) => p.menu.name === '탕수육 소')!.price;
    expect(price('walk')).toBe(16000);
    expect(price('takeout')).toBe(15000);
    expect(price('delivery')).toBe(18000);
  });

  it('해당 채널 가격이 없는 메뉴는 빼고, 다른 채널 가격을 빌려오지 않는다', () => {
    expect(menusForChannel(jjamppong, 'delivery').map((p) => p.menu.name)).not.toContain('군만두');
    expect(menusForChannel(jjamppong, 'walk').map((p) => p.menu.name)).toContain('군만두');
  });

  it('대표메뉴가 먼저 온다', () => {
    const noodles = list.find((r) => r.name === '오늘의 국수')!;
    const out = menusForChannel(noodles, 'walk');
    expect(out.slice(0, 2).every((p) => p.menu.signature)).toBe(true);
    expect(out[2].menu.signature).toBe(false);
  });

  it('메뉴 정보가 없으면 빈 목록 (가격을 지어내지 않는다)', () => {
    expect(menusForChannel(list.find((r) => r.name === '카레 하우스')!, 'walk')).toEqual([]);
  });

  it('메뉴 ID는 매장마다 고유하다', () => {
    const ids = PILOT_AREAS.flatMap((a) => pilotRestaurants(a.id).flatMap((r) => r.menus.map((m) => m.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
