import { describe, expect, it } from 'vitest';
import { destinationPoint, distanceM } from './geo';

const seolleung = { lat: 37.50449, lng: 127.04893 };

describe('geo', () => {
  it('같은 좌표는 0m', () => {
    expect(distanceM(seolleung, seolleung)).toBe(0);
  });

  it('위도 0.001도는 약 111m', () => {
    expect(distanceM(seolleung, { ...seolleung, lat: seolleung.lat + 0.001 })).toBeCloseTo(111.2, 0);
  });

  it('선릉역–판교역 직선거리는 약 13.4km', () => {
    const d = distanceM(seolleung, { lat: 37.39482, lng: 127.11119 });
    expect(d).toBeGreaterThan(13000);
    expect(d).toBeLessThan(14000);
  });

  it.each([0, 90, 200, 333])('destinationPoint로 이동한 거리를 distanceM이 되돌려 준다 (방위각 %i도)', (b) => {
    expect(distanceM(seolleung, destinationPoint(seolleung, 250, b))).toBeCloseTo(250, 3);
  });
});
