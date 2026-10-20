import { afterEach, describe, expect, it } from 'vitest';
import {
  isValidRoutePoint,
  kakaoAppRouteUrl,
  kakaoWebRouteUrl,
  loadMapProvider,
  naverAppRouteUrl,
  routeDestinationOf,
  saveMapProvider,
  type RoutePlace,
} from './mapLinks';

const origin: RoutePlace = { name: '현재 위치', point: { lat: 37.5048, lng: 127.0492 } };
const dest: RoutePlace = { name: '선릉역', point: { lat: 37.50449, lng: 127.04893 } };

describe('좌표 검증', () => {
  it.each([
    [null, false],
    [{ lat: NaN, lng: 127 }, false],
    [{ lat: 0, lng: 0 }, false],
    [{ lat: 127.04893, lng: 37.50449 }, false], // 위도·경도 뒤바뀜
    [{ lat: 37.50449, lng: 127.04893 }, true],
  ])('%j → %s', (p, ok) => {
    expect(isValidRoutePoint(p)).toBe(ok);
  });

  it('검증되지 않은 좌표(가상 매장)는 길찾기 목적지로 쓰지 않는다', () => {
    expect(routeDestinationOf({ name: 'A', location: dest.point, coordVerified: false })).toBeNull();
    expect(routeDestinationOf({ name: 'A', location: { lat: 0, lng: 0 }, coordVerified: true })).toBeNull();
    expect(routeDestinationOf({ name: 'A', location: dest.point, coordVerified: true })).toEqual({
      name: 'A',
      point: dest.point,
    });
  });
});

describe('카카오맵', () => {
  it('웹: 출발지·도착지 좌표를 /link/by/walk 규격으로 넣는다', () => {
    expect(kakaoWebRouteUrl(dest, origin)).toBe(
      `https://map.kakao.com/link/by/walk/${encodeURIComponent('현재 위치')},37.504800,127.049200/${encodeURIComponent('선릉역')},37.504490,127.048930`,
    );
  });

  it('웹: 출발지가 없으면 도착지만 지정한다 (/link/to)', () => {
    expect(kakaoWebRouteUrl(dest, null)).toBe(`https://map.kakao.com/link/to/${encodeURIComponent('선릉역')},37.504490,127.048930`);
  });

  it('앱: kakaomap://route?sp=…&ep=…&by=FOOT', () => {
    expect(kakaoAppRouteUrl(dest, origin)).toBe('kakaomap://route?sp=37.504800,127.049200&ep=37.504490,127.048930&by=FOOT');
    expect(kakaoAppRouteUrl(dest, null)).toBe('kakaomap://route?ep=37.504490,127.048930&by=FOOT');
  });
});

describe('네이버지도', () => {
  it('앱: nmap://route/walk 와 필수 appname', () => {
    const url = new URL(naverAppRouteUrl(dest, origin, 'https://mwomeok.example'));
    expect(url.protocol).toBe('nmap:');
    expect(url.host + url.pathname).toBe('route/walk');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      slat: '37.504800',
      slng: '127.049200',
      sname: '현재 위치',
      dlat: '37.504490',
      dlng: '127.048930',
      dname: '선릉역',
      appname: 'https://mwomeok.example',
    });
  });

  it('출발지가 없으면 출발 파라미터를 넣지 않는다', () => {
    const url = new URL(naverAppRouteUrl(dest, null, 'x'));
    expect(url.searchParams.has('slat')).toBe(false);
    expect(url.searchParams.get('dlat')).toBe('37.504490');
  });
});

describe('지도 선택 저장', () => {
  afterEach(() => localStorage.clear());

  it('로컬 저장소에 기억한다', () => {
    expect(loadMapProvider()).toBeNull();
    saveMapProvider('naver');
    expect(loadMapProvider()).toBe('naver');
  });

  it('알 수 없는 값은 무시한다', () => {
    localStorage.setItem('mwomeok.mapProvider', 'google');
    expect(loadMapProvider()).toBeNull();
  });
});
