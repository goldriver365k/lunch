/** 식사 방식 탭 */
export type Mode = 'walk' | 'delivery' | 'takeout';

/** 도보 식사·포장에서 선택 가능한 검색 반경 (미터) */
export type Radius = 30 | 50 | 70 | 100;

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

export interface MenuItem {
  name: string;
  price: number;
}

export interface Restaurant {
  id: string;
  name: string;
  category: Category;
  /** 현재 위치로부터의 거리 (미터) — 가상 값 */
  distanceM: number;
  /** 최근 30분 주문·방문 수 — 실시간 인기순 예시용 가상 값 */
  recentOrders: number;
  rating: number;
  /** 대표메뉴 */
  menus: MenuItem[];
  /** 지원하는 식사 방식 */
  modes: Mode[];
  /** 배달 예상 시간(분) — 배달 지원 시 */
  deliveryMinutes?: number;
  deliveryFee?: number;
  /** 포장 준비 시간(분) — 포장 지원 시 */
  takeoutMinutes?: number;
}
