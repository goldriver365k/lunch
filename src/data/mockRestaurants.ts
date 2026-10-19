import type { Category, GeoPoint, MenuItem, Mode, PilotAreaId, Restaurant } from '../types';
import { destinationPoint, distanceM } from '../lib/geo';
import { hashString } from '../lib/restaurants';
import { PILOT_AREAS } from './pilotAreas';

/**
 * ⚠️ 가상 데이터 (MOCK)
 * 시연용으로 만든 가짜 음식점 목록입니다.
 * 상호·좌표·가격·주문 수는 모두 임의로 지어낸 값이며 실제 가게와 무관합니다.
 * 실제 음식점 DB·지도 API·POS·배달앱·카드사 데이터는 사용하지 않습니다.
 */
export const IS_MOCK_DATA = true;

/** 이 거리 안에 있으면 해당 시범 지역의 가상 매장을 쓴다 (미터) */
export const PILOT_AREA_MATCH_M = 500;

interface Template {
  key: string;
  name: string;
  category: Category;
  /** 지역 중심에서의 거리 (미터) */
  d: number;
  recentOrders: number;
  rating: number;
  menus: MenuItem[];
  modes: Mode[];
  deliveryMinutes?: number;
  deliveryFee?: number;
  deliveryRadiusM?: number;
  takeoutMinutes?: number;
}

const m = (name: string, price: number): MenuItem => ({ name, price });

/** 지역 중심 기준으로 배치되는 가상 매장 템플릿 */
const TEMPLATES: Template[] = [
  { key: '01', name: '골목집 백반', category: '한식', d: 35, recentOrders: 42, rating: 4.6,
    menus: [m('제육볶음 백반', 9000), m('김치찌개', 8500), m('계란말이', 6000)],
    modes: ['walk', 'takeout'], takeoutMinutes: 10 },
  { key: '02', name: '모퉁이 김밥', category: '분식', d: 55, recentOrders: 55, rating: 4.3,
    menus: [m('참치김밥', 4500), m('라볶이', 6500), m('떡볶이', 5000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 5 },
  { key: '03', name: '오늘의 국수', category: '한식', d: 80, recentOrders: 31, rating: 4.4,
    menus: [m('잔치국수', 7000), m('비빔국수', 7500), m('수육 소', 15000)],
    modes: ['walk', 'takeout'], takeoutMinutes: 8 },
  { key: '04', name: '빨간짬뽕집', category: '중식', d: 95, recentOrders: 38, rating: 4.2,
    menus: [m('짬뽕', 9000), m('짜장면', 7000), m('탕수육 소', 16000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 12 },
  { key: '05', name: '구름 베이커리 카페', category: '카페·디저트', d: 60, recentOrders: 29, rating: 4.5,
    menus: [m('아메리카노', 3500), m('소금빵', 3000), m('샌드위치', 6500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2500, takeoutMinutes: 4 },
  { key: '06', name: '스시 한 점', category: '일식', d: 120, recentOrders: 19, rating: 4.7,
    menus: [m('점심 초밥 12p', 15000), m('연어덮밥', 13000), m('우동', 8000)],
    modes: ['walk', 'takeout'], takeoutMinutes: 15 },
  { key: '07', name: '돈까스 공방', category: '일식', d: 140, recentOrders: 47, rating: 4.5,
    menus: [m('등심돈까스', 10000), m('치즈돈까스', 11500), m('냉모밀', 8500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 12 },
  { key: '08', name: '파스타 브릿지', category: '양식', d: 165, recentOrders: 22, rating: 4.4,
    menus: [m('알리오올리오', 12000), m('토마토 리조또', 13500), m('시저 샐러드', 9500)],
    modes: ['walk', 'delivery'], deliveryMinutes: 35, deliveryFee: 3000 },
  { key: '09', name: '쌀국수 하루', category: '아시안', d: 185, recentOrders: 34, rating: 4.3,
    menus: [m('양지 쌀국수', 10000), m('분짜', 12000), m('짜조', 6000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 10 },
  { key: '10', name: '버거 스테이션', category: '패스트푸드', d: 210, recentOrders: 51, rating: 4.1,
    menus: [m('클래식 버거 세트', 8900), m('더블치즈버거', 7500), m('감자튀김', 2500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 6 },
  { key: '11', name: '순두부 한그릇', category: '한식', d: 230, recentOrders: 26, rating: 4.4,
    menus: [m('해물순두부', 9500), m('돌솥비빔밥', 9500), m('고등어구이', 10000)],
    modes: ['walk', 'takeout'], takeoutMinutes: 12 },
  { key: '12', name: '마라 연구소', category: '중식', d: 250, recentOrders: 44, rating: 4.2,
    menus: [m('마라탕 (100g)', 2000), m('꿔바로우 소', 14000), m('마라샹궈 1인', 16000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 35, deliveryFee: 3500, takeoutMinutes: 15 },
  { key: '13', name: '포케 그린', category: '양식', d: 270, recentOrders: 17, rating: 4.6,
    menus: [m('연어 포케', 12500), m('닭가슴살 포케', 11000), m('그릭요거트', 6000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 8 },
  { key: '14', name: '떡볶이 연구실', category: '분식', d: 285, recentOrders: 39, rating: 4.3,
    menus: [m('로제 떡볶이', 14000), m('모둠튀김', 5000), m('순대', 4500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 2500, takeoutMinutes: 10 },
  { key: '15', name: '카레 하우스', category: '일식', d: 295, recentOrders: 21, rating: 4.2,
    menus: [m('돈까스 카레', 10500), m('야채 카레', 8500), m('고로케', 3000)],
    modes: ['walk', 'takeout'], takeoutMinutes: 9 },
  { key: '16', name: '치킨 브라더스', category: '패스트푸드', d: 650, recentOrders: 63, rating: 4.4,
    menus: [m('후라이드 치킨', 19000), m('양념 치킨', 21000), m('치킨마요 덮밥', 7000)],
    modes: ['delivery'], deliveryMinutes: 35, deliveryFee: 3000 },
  { key: '17', name: '달콤 디저트랩', category: '카페·디저트', d: 800, recentOrders: 24, rating: 4.6,
    menus: [m('크로플', 6500), m('딸기 케이크 조각', 7000), m('바닐라 라떼', 5000)],
    modes: ['delivery'], deliveryMinutes: 30, deliveryFee: 3000 },
  { key: '18', name: '피자 공장', category: '양식', d: 900, recentOrders: 36, rating: 4.3,
    menus: [m('페퍼로니 피자 L', 22000), m('고르곤졸라 M', 17000), m('치즈오븐스파게티', 9000)],
    modes: ['delivery', 'takeout'], deliveryMinutes: 40, deliveryFee: 3000, takeoutMinutes: 20 },
  { key: '19', name: '족발 명가', category: '한식', d: 1400, recentOrders: 28, rating: 4.5,
    menus: [m('족발 중', 33000), m('보쌈 중', 32000), m('막국수', 8000)],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 3500 },
  { key: '20', name: '팟타이 키친', category: '아시안', d: 2200, recentOrders: 15, rating: 4.4,
    menus: [m('팟타이', 11000), m('똠얌꿍', 13000), m('푸팟퐁커리', 18000)],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 4000 },
  { key: '21', name: '한우 국밥집', category: '한식', d: 3600, recentOrders: 33, rating: 4.5,
    menus: [m('한우 국밥', 12000), m('수육 국밥', 13000), m('모둠 수육', 30000)],
    modes: ['delivery'], deliveryMinutes: 50, deliveryFee: 4000, deliveryRadiusM: 3000 },
];

/**
 * 지역 중심 좌표 주변에 가상 매장을 배치한다.
 * 방위각과 주문 수는 지역 키로 결정적으로 달라져서, 지역마다 인기 순위가 조금씩 다르다.
 */
export function buildMockRestaurants(areaKey: string, center: GeoPoint): Restaurant[] {
  return TEMPLATES.map(({ key, d, recentOrders, ...rest }) => {
    const seed = hashString(`${areaKey}:${key}`);
    return {
      ...rest,
      id: `${areaKey}-${key}`,
      location: destinationPoint(center, d, seed % 360),
      recentOrders: Math.max(1, recentOrders + (seed % 15) - 7),
    };
  });
}

const PILOT_DATA = new Map<PilotAreaId, Restaurant[]>(
  PILOT_AREAS.map((a) => [a.id, buildMockRestaurants(a.id, a.center)]),
);

export function pilotRestaurants(id: PilotAreaId): Restaurant[] {
  return PILOT_DATA.get(id)!;
}

export interface MockDataset {
  /** 가상 매장이 배치된 지역 이름 — 시범 지역이 아니면 null */
  areaName: string | null;
  restaurants: Restaurant[];
}

/**
 * 기준 좌표에 맞는 가상 매장 목록.
 * 시범 지역(선릉·판교·여의도) 가까이면 그 지역 데이터를, 아니면 기준 좌표 주변에 가상 매장을 새로 배치한다.
 */
export function mockDatasetFor(point: GeoPoint): MockDataset {
  const area = PILOT_AREAS.find((a) => distanceM(a.center, point) <= PILOT_AREA_MATCH_M);
  if (area) return { areaName: area.name, restaurants: pilotRestaurants(area.id) };
  return { areaName: null, restaurants: buildMockRestaurants('here', point) };
}
