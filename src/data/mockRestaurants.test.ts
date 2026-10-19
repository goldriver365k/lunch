import { describe, expect, it } from 'vitest';
import { PILOT_AREAS } from './pilotAreas';
import { mockDatasetFor, pilotRestaurants } from './mockRestaurants';
import { destinationPoint } from '../lib/geo';

describe('mock 데이터', () => {
  it('시범 지역마다 매장 좌표와 id가 다르다', () => {
    const [a, b] = PILOT_AREAS.map((p) => pilotRestaurants(p.id));
    expect(a[0].id).not.toBe(b[0].id);
    expect(a[0].location).not.toEqual(b[0].location);
  });

  it('시범 지역 근처 좌표는 그 지역 데이터를 쓴다', () => {
    const near = destinationPoint(PILOT_AREAS[1].center, 200, 45);
    const ds = mockDatasetFor(near);
    expect(ds.areaName).toBe('판교');
    expect(ds.restaurants).toBe(pilotRestaurants('pangyo'));
  });

  it('시범 지역 밖이면 기준 좌표 주변에 가상 매장을 배치한다', () => {
    const busan = { lat: 35.1796, lng: 129.0756 };
    const ds = mockDatasetFor(busan);
    expect(ds.areaName).toBeNull();
    expect(ds.restaurants.length).toBeGreaterThan(0);
    expect(Math.abs(ds.restaurants[0].location.lat - busan.lat)).toBeLessThan(0.01);
  });
});
