import { afterEach, describe, expect, it } from 'vitest';
import {
  addressArea,
  isNaverPlaceUrl,
  isValidRoutePoint,
  kakaoAppRouteUrl,
  kakaoWebRouteUrl,
  loadMapProvider,
  naverAppRouteUrl,
  naverPlaceLink,
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

describe('네이버에서 메뉴 보기', () => {
  it('naver.me·naver.com https 주소만 매장 링크로 받는다', () => {
    expect(isNaverPlaceUrl('https://naver.me/xYz123')).toBe(true);
    expect(isNaverPlaceUrl('https://map.naver.com/p/entry/place/123')).toBe(true);
    expect(isNaverPlaceUrl('http://naver.me/xYz123')).toBe(false);
    expect(isNaverPlaceUrl('https://evil.example.com/naver.com/')).toBe(false);
    expect(isNaverPlaceUrl('https://naver.com.evil.example/')).toBe(false);
    expect(isNaverPlaceUrl('javascript:alert(1)')).toBe(false);
    expect(isNaverPlaceUrl(null)).toBe(false);
  });

  it('주소에서 시·군·구만 뽑는다', () => {
    expect(addressArea('경상남도 김해시 인제로 197')).toBe('김해시');
    expect(addressArea('서울특별시 강남구 테헤란로 1')).toBe('강남구');
    expect(addressArea('경기도 성남시 분당구 판교역로 1')).toBe('성남시 분당구');
    expect(addressArea('주소 정보 없음')).toBe('');
  });

  it('저장된 링크가 있으면 그 링크, 없으면 이름 + 시·군·구로 네이버 지도 검색', () => {
    expect(naverPlaceLink({ name: '불백집', address: '경상남도 김해시 인제로 1', naverPlaceUrl: 'https://naver.me/abc' }))
      .toEqual({ url: 'https://naver.me/abc', stored: true });
    expect(naverPlaceLink({ name: '불백집', address: '경상남도 김해시 인제로 1' })).toEqual({
      url: `https://map.naver.com/p/search/${encodeURIComponent('불백집 김해시')}`,
      stored: false,
    });
    // 잘못된 링크는 쓰지 않고 검색으로
    expect(naverPlaceLink({ name: '불백집', address: '', naverPlaceUrl: 'https://evil.example/' }).stored).toBe(false);
  });
});
