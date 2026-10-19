import { describe, expect, it } from 'vitest';
import { distanceM } from '../geo';
import { tmToWgs84 } from './coords';
import fixture from './epsg5174.fixture.json';

describe('EPSG:5174 → WGS84', () => {
  it(`PROJ/EPSG 공식 변환과 36개 지점에서 1m 안으로 일치 (${fixture.source})`, () => {
    let max = 0;
    for (const p of fixture.points) {
      const got = tmToWgs84(p.x, p.y)!;
      max = Math.max(max, distanceM(got, { lat: p.lat, lng: p.lng }));
    }
    expect(max).toBeLessThan(1);
  });

  it('숫자가 아니거나 중부원점 범위를 벗어나면 null', () => {
    expect(tmToWgs84(NaN, 443589)).toBeNull();
    expect(tmToWgs84(999999, 999999)).toBeNull();
    expect(tmToWgs84(0, 0)).toBeNull();
  });

  it('EPSG:2097(경도 보정 없음)은 약 250m 서쪽으로 어긋난다 — 원본 좌표계 확인용', () => {
    const p = fixture.points.find((q) => q.name === '선릉역')!;
    const a = tmToWgs84(p.x, p.y, 'EPSG:5174')!;
    const b = tmToWgs84(p.x, p.y, 'EPSG:2097')!;
    expect(distanceM(a, b)).toBeGreaterThan(200);
    expect(distanceM(a, b)).toBeLessThan(300);
    expect(b.lng).toBeLessThan(a.lng);
  });
});
