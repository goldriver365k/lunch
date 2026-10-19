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
  | '카페·디저트'
  | '기타';

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

/** 주문 채널 — 탭과 같은 키를 쓴다 (walk = 홀/도보 식사) */
export type Channel = Mode;

/**
 * 채널별 판매가격.
 * 키가 없으면 그 채널에서 팔지 않음, null이면 팔지만 가격정보 없음 (0원으로 쓰지 않는다).
 */
export type ChannelPrices = Partial<Record<Channel, number | null>>;

/** 운영 여부 — 확인됨 / 운영 안 함 / 미확인 */
export type ChannelStatus = 'yes' | 'no' | 'unknown';

export interface MenuItem {
  id: string;
  name: string;
  /** 대표메뉴 여부 */
  signature: boolean;
  prices: ChannelPrices;
}

export interface DataSourceInfo {
  /** 'mock' = 가상 데이터, 'db' = 실제 음식점 DB */
  kind: 'mock' | 'db';
  /** 실시간 데이터 제공 여부 */
  realtime: boolean;
  /** 데이터 갱신시각 (ISO 8601) */
  updatedAt: string;
}

export interface Restaurant {
  id: string;
  name: string;
  category: Category;
  /** 매장 주소 */
  address: string;
  /** 매장 좌표 */
  location: GeoPoint;
  /** 좌표가 실제 매장 위치로 검증됐는지 — false면 외부 지도 길찾기에 쓰지 않는다 */
  coordVerified: boolean;
  /** 채널별 최근 30분 주문 수 — 채널끼리 합산하지 않는다. 키가 없으면 주문정보 없음 (0건이 아님) */
  recentOrders: Partial<Record<Channel, number>>;
  /** 채널별 운영 여부 */
  channelStatus: Record<Channel, ChannelStatus>;
  /** 평점 — 실제 DB에는 아직 없다 */
  rating?: number;
  /** 메뉴 (대표메뉴 + 추가 메뉴) */
  menus: MenuItem[];
  /** 주문 채널 */
  modes: Mode[];
  dataSource: DataSourceInfo;
  /** 최종 확인일 (실제 DB) */
  lastVerifiedAt?: string | null;
  /** 현재 탭 채널의 주문 활발도 — 없으면 '주문정보 없음' (0건 아님) */
  activity?: OrderActivity | null;
  /** 배달 예상 시간(분) — 배달 지원 시 */
  deliveryMinutes?: number;
  deliveryFee?: number;
  /** 배달 가능 거리(미터) — 배달 주소와의 직선거리 기준 */
  deliveryRadiusM?: number;
  /** 포장 준비 시간(분) — 포장 지원 시 */
  takeoutMinutes?: number;
}

/** 주문 활발도 — 공개 허용된 실제 주문 집계 (또는 관리자 테스트 집계) */
export interface OrderActivity {
  /** 'public' = 실제 공개 집계, 'test' = 관리자 테스트 데이터 */
  scope: 'public' | 'test';
  /** 집계 갱신시각 */
  asOf: string;
  /** 최소 공개 건수 이상인 창만 들어 있다 */
  windows: Partial<Record<'10m' | '30m' | '60m' | 'lunch', number>>;
  /** 배달: 제공처별 (배민·쿠팡이츠) */
  byProvider: Partial<Record<'pos' | 'baemin' | 'coupangeats' | 'csv', number>> | null;
  /** 오늘 이 채널 판매 수량 1위 메뉴 (내부 메뉴와 연결된 것만) */
  topMenu: { menuId: string; name: string; quantity: number } | null;
}

/** 기준 위치로부터의 직선거리가 계산된 음식점 */
export interface RestaurantResult extends Restaurant {
  distanceM: number;
}
