/** 식사 방식 탭 */
export type Mode = 'walk' | 'delivery' | 'takeout';

/** 도보 식사·포장에서 선택 가능한 검색 반경 (미터) */
export type Radius = 100 | 200 | 300;

export type SortKey = 'popular' | 'distance';

export type Category =
  | '한식'
  | '중식'
  | '일식'
  | '양식'
  | '분식'
  | '아시안'
  | '패스트푸드'
  | '카페·디저트';

/** 위도·경도 (WGS84) */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export type PilotAreaId = 'seolleung' | 'pangyo' | 'yeouido';

export interface PilotArea {
  id: PilotAreaId;
  name: string;
  center: GeoPoint;
}

/** 검색 기준이 되는 위치 */
export interface ActiveLocation {
  source: 'gps' | 'pilot';
  label: string;
  point: GeoPoint;
  /** GPS 정확도 (미터) */
  accuracyM?: number;
}

export interface MenuItem {
  name: string;
  price: number;
}

export interface Restaurant {
  id: string;
  name: string;
  category: Category;
  /** 매장 좌표 — 가상 값 */
  location: GeoPoint;
  /** 최근 30분 주문 수 — 가상 값 */
  recentOrders: number;
  rating: number;
  /** 대표메뉴 */
  menus: MenuItem[];
  /** 지원하는 식사 방식 */
  modes: Mode[];
  /** 배달 예상 시간(분) — 배달 지원 시 */
  deliveryMinutes?: number;
  deliveryFee?: number;
  /** 배달 가능 거리(미터) — 배달 주소와의 직선거리 기준 */
  deliveryRadiusM?: number;
  /** 포장 준비 시간(분) — 포장 지원 시 */
  takeoutMinutes?: number;
}

/** 기준 위치로부터의 직선거리가 계산된 음식점 */
export interface RestaurantResult extends Restaurant {
  distanceM: number;
}
