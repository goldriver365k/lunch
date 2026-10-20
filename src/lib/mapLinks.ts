import type { GeoPoint, Restaurant } from '../types';

/**
 * 외부 지도(카카오맵·네이버지도) 도보 길찾기 URL 생성.
 * 앱 안에서 지도나 경로를 계산하지 않고, 공식 URL 규격으로 외부 지도에 넘긴다.
 *
 * - 카카오맵 웹: https://apis.map.kakao.com/web/guide/#routeurl
 *     /link/by/{car|traffic|walk|bicycle}/출발지이름,위도,경도/도착지이름,위도,경도
 *     /link/to/이름,위도,경도   (도착지만 지정)
 * - 카카오맵 앱: https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/
 *     kakaomap://route?sp=위도,경도&ep=위도,경도&by=FOOT
 * - 네이버지도 앱: https://guide.ncloud-docs.com/docs/maps-url-scheme
 *     nmap://route/walk?slat=&slng=&sname=&dlat=&dlng=&dname=&appname=
 *     (appname은 필수 — 웹에서는 페이지 URL)
 */

export type MapProvider = 'kakao' | 'naver';

export const MAP_PROVIDER_LABEL: Record<MapProvider, string> = {
  kakao: '카카오맵',
  naver: '네이버지도',
};

export interface RoutePlace {
  name: string;
  point: GeoPoint;
}

/** 대한민국 대략 범위 — 이 밖이거나 숫자가 아니면 잘못된 좌표로 본다 */
const KOREA_BOUNDS = { minLat: 33, maxLat: 38.7, minLng: 124.5, maxLng: 132 };

export function isValidRoutePoint(p: GeoPoint | null | undefined): p is GeoPoint {
  if (!p) return false;
  const { lat, lng } = p;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= KOREA_BOUNDS.minLat &&
    lat <= KOREA_BOUNDS.maxLat &&
    lng >= KOREA_BOUNDS.minLng &&
    lng <= KOREA_BOUNDS.maxLng
  );
}

/**
 * 매장을 길찾기 목적지로 쓸 수 있으면 RoutePlace, 아니면 null.
 * 검증되지 않은 좌표(가상 매장 포함)나 잘못된 좌표는 길찾기에 쓰지 않는다.
 */
export function routeDestinationOf(r: Pick<Restaurant, 'name' | 'location' | 'coordVerified'>): RoutePlace | null {
  if (!r.coordVerified || !isValidRoutePoint(r.location)) return null;
  return { name: r.name, point: r.location };
}

const coord = (n: number) => n.toFixed(6);
const latLng = (p: GeoPoint) => `${coord(p.lat)},${coord(p.lng)}`;
const named = (place: RoutePlace) => `${encodeURIComponent(place.name)},${latLng(place.point)}`;

/** 카카오맵 웹 도보 길찾기. 출발지가 없으면 도착지만 지정해 지도에서 출발지를 고르게 한다. */
export function kakaoWebRouteUrl(dest: RoutePlace, origin: RoutePlace | null): string {
  if (origin) return `https://map.kakao.com/link/by/walk/${named(origin)}/${named(dest)}`;
  return `https://map.kakao.com/link/to/${named(dest)}`;
}

/** 카카오맵 지도 바로가기 — 좌표 위치에 핀을 꽂아 보여준다 (관리자 좌표 확인용) */
export function kakaoMapPinUrl(name: string, lat: number, lng: number): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
}

/** 카카오맵 앱 도보 길찾기 URL Scheme */
export function kakaoAppRouteUrl(dest: RoutePlace, origin: RoutePlace | null): string {
  const sp = origin ? `sp=${latLng(origin.point)}&` : '';
  return `kakaomap://route?${sp}ep=${latLng(dest.point)}&by=FOOT`;
}

/** 네이버지도 앱 도보 길찾기 URL Scheme. 출발지를 비우면 네이버지도 앱이 출발지를 정한다. */
export function naverAppRouteUrl(dest: RoutePlace, origin: RoutePlace | null, appname: string): string {
  const params = new URLSearchParams();
  if (origin) {
    params.set('slat', coord(origin.point.lat));
    params.set('slng', coord(origin.point.lng));
    params.set('sname', origin.name);
  }
  params.set('dlat', coord(dest.point.lat));
  params.set('dlng', coord(dest.point.lng));
  params.set('dname', dest.name);
  params.set('appname', appname);
  return `nmap://route/walk?${params.toString()}`;
}

/** 네이버 매장 링크로 받을 수 있는 주소: https + naver.me 또는 naver.com (DB도 같은 규칙으로 막는다) */
export function isNaverPlaceUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && (url.hostname === 'naver.me' || url.hostname === 'naver.com' || url.hostname.endsWith('.naver.com'));
  } catch {
    return false;
  }
}

/** 주소에서 시·군·구만 뽑는다 (예: '경상남도 김해시 인제로 197' → '김해시', '경기 성남시 분당구 …' → '성남시 분당구') */
export function addressArea(address: string): string {
  return address
    .split(/\s+/)
    .filter((t) => /[시군구]$/.test(t) && !/(특별시|광역시|특별자치시)$/.test(t))
    .slice(0, 2)
    .join(' ');
}

/**
 * '네이버에서 메뉴 보기' 주소. 관리자가 저장한 매장 링크가 있으면 그 링크,
 * 없으면 매장 이름 + 시·군·구로 네이버 지도를 검색한다 (같은 이름 매장이 여럿일 수 있다).
 */
export function naverPlaceLink(r: Pick<Restaurant, 'name' | 'address' | 'naverPlaceUrl'>): { url: string; stored: boolean } {
  if (isNaverPlaceUrl(r.naverPlaceUrl)) return { url: r.naverPlaceUrl, stored: true };
  const q = [r.name, addressArea(r.address)].filter(Boolean).join(' ');
  return { url: `https://map.naver.com/p/search/${encodeURIComponent(q)}`, stored: false };
}

/** 외부로 나가는 동작 — 테스트에서 가로챌 수 있게 객체로 둔다 */
export const external = {
  /** 웹 URL을 새 탭으로 연다. 팝업이 막히면 현재 탭에서 연다. */
  openWeb(url: string) {
    const w = window.open(url, '_blank');
    if (w) w.opener = null;
    else window.location.assign(url);
  },
  /** 앱 URL Scheme으로 이동한다. 앱이 없으면 아무 일도 일어나지 않을 수 있다. */
  openApp(url: string) {
    window.location.href = url;
  },
};

const STORAGE_KEY = 'mwomeok.mapProvider';

export function loadMapProvider(): MapProvider | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'kakao' || v === 'naver' ? v : null;
  } catch {
    return null;
  }
}

export function saveMapProvider(p: MapProvider): void {
  try {
    localStorage.setItem(STORAGE_KEY, p);
  } catch {
    // 저장소를 쓸 수 없으면 이번 세션에서만 기억한다
  }
}
