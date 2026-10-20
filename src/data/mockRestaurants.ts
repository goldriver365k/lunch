import type { Category, ChannelPrices, GeoPoint, Mode, PilotAreaId, Restaurant } from '../types';
import { destinationPoint, distanceM } from '../lib/geo';
import { hashString } from '../lib/restaurants';
import { PILOT_AREAS } from './pilotAreas';

/**
 * ⚠️ 가상 데이터 (MOCK)
 * 시연용으로 만든 가짜 음식점 목록입니다.
 * 상호·주소·좌표·가격·주문 수는 모두 임의로 지어낸 값이며 실제 가게와 무관합니다.
 * 좌표도 가상 값이므로 coordVerified: false — 외부 지도 길찾기에 쓰지 않습니다.
 */
export const IS_MOCK_DATA = true;

/** 가상 데이터 기준시각 */
export const MOCK_UPDATED_AT = '2026-10-19T12:00:00+09:00';

/** 이 거리 안에 있으면 해당 시범 지역의 가상 매장을 쓴다 (미터) */
export const PILOT_AREA_MATCH_M = 500;

interface MenuTemplate {
  name: string;
  signature: boolean;
  prices: ChannelPrices;
}

interface Template {
  key: string;
  name: string;
  category: Category;
  /** 지역 중심에서의 거리 (미터) */
  d: number;
  /** 채널별 최근 30분 주문 수 (가상) */
  orders: Partial<Record<Mode, number>>;
  rating: number;
  menus: MenuTemplate[];
  modes: Mode[];
  deliveryMinutes?: number;
  deliveryFee?: number;
  deliveryRadiusM?: number;
  takeoutMinutes?: number;
}

/**
 * 메뉴 한 개 — 홀(도보 식사)·포장·배달 가격을 따로 적는다.
 * null은 그 채널에서 팔지 않는다는 뜻.
 */
function m(name: string, walk: number | null, takeout: number | null, delivery: number | null, signature = false): MenuTemplate {
  const prices: ChannelPrices = {};
  if (walk !== null) prices.walk = walk;
  if (takeout !== null) prices.takeout = takeout;
  if (delivery !== null) prices.delivery = delivery;
  return { name, signature, prices };
}

/** 지역 중심 기준으로 배치되는 가상 매장 템플릿 */
const TEMPLATES: Template[] = [
  { key: '01', name: '골목집 백반', category: '한식', d: 35, orders: { walk: 42, takeout: 9 }, rating: 4.6,
    menus: [m('제육볶음 백반', 9000, 9000, null, true), m('김치찌개', 8500, 8500, null), m('계란말이', 6000, 6000, null), m('공기밥 추가', 1000, null, null)],
    modes: ['walk', 'takeout'], takeoutMinutes: 10 },
  { key: '02', name: '모퉁이 김밥', category: '분식', d: 55, orders: { walk: 30, takeout: 25, delivery: 18 }, rating: 4.3,
    menus: [m('참치김밥', 4500, 4500, 5000, true), m('라볶이', 6500, 6500, 7000), m('떡볶이', 5000, 5000, 5500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 5 },
  { key: '03', name: '오늘의 국수', category: '한식', d: 80, orders: { walk: 31, takeout: 6 }, rating: 4.4,
    menus: [m('잔치국수', 7000, 7000, null, true), m('비빔국수', 7500, 7500, null, true), m('수육 소', 15000, 15000, null)],
    modes: ['walk', 'takeout'], takeoutMinutes: 8 },
  { key: '04', name: '빨간짬뽕집', category: '중식', d: 95, orders: { walk: 38, takeout: 7, delivery: 41 }, rating: 4.2,
    menus: [m('짬뽕', 9000, 9000, 10000, true), m('짜장면', 7000, 7000, 8000), m('탕수육 소', 16000, 15000, 18000), m('군만두', 5000, 5000, null)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 12 },
  { key: '05', name: '구름 베이커리 카페', category: '카페·디저트', d: 60, orders: { walk: 18, takeout: 29, delivery: 12 }, rating: 4.5,
    menus: [m('소금빵', 3000, 3000, 3500, true), m('아메리카노', 3500, 3500, 4000), m('샌드위치', 6500, 6500, 7000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2500, takeoutMinutes: 4 },
  { key: '06', name: '스시 한 점', category: '일식', d: 120, orders: { walk: 19, takeout: 4 }, rating: 4.7,
    menus: [m('점심 초밥 12p', 15000, 15000, null, true), m('연어덮밥', 13000, 13000, null), m('우동', 8000, null, null)],
    modes: ['walk', 'takeout'], takeoutMinutes: 15 },
  { key: '07', name: '돈까스 공방', category: '일식', d: 140, orders: { walk: 47, takeout: 12, delivery: 33 }, rating: 4.5,
    menus: [m('등심돈까스', 10000, 10000, 11000, true), m('치즈돈까스', 11500, 11500, 12500), m('냉모밀', 8500, null, null)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 12 },
  { key: '08', name: '파스타 브릿지', category: '양식', d: 165, orders: { walk: 22, delivery: 14 }, rating: 4.4,
    menus: [m('알리오올리오', 12000, null, 13000, true), m('토마토 리조또', 13500, null, 14500), m('시저 샐러드', 9500, null, 10000)],
    modes: ['walk', 'delivery'], deliveryMinutes: 35, deliveryFee: 3000 },
  { key: '09', name: '쌀국수 하루', category: '아시안', d: 185, orders: { walk: 34, takeout: 8, delivery: 21 }, rating: 4.3,
    menus: [m('양지 쌀국수', 10000, 10000, 11000, true), m('분짜', 12000, 12000, 13000), m('짜조', 6000, 6000, 6500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 10 },
  { key: '10', name: '버거 스테이션', category: '패스트푸드', d: 210, orders: { walk: 51, takeout: 22, delivery: 45 }, rating: 4.1,
    menus: [m('클래식 버거 세트', 8900, 8900, 9900, true), m('더블치즈버거', 7500, 7500, 8500), m('감자튀김', 2500, 2500, 3000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 6 },
  { key: '11', name: '순두부 한그릇', category: '한식', d: 230, orders: { walk: 26, takeout: 5 }, rating: 4.4,
    menus: [m('해물순두부', 9500, 9500, null, true), m('돌솥비빔밥', 9500, null, null), m('고등어구이', 10000, 10000, null)],
    modes: ['walk', 'takeout'], takeoutMinutes: 12 },
  { key: '12', name: '마라 연구소', category: '중식', d: 250, orders: { walk: 44, takeout: 15, delivery: 37 }, rating: 4.2,
    menus: [m('마라탕 (100g)', 2000, 2000, 2300, true), m('꿔바로우 소', 14000, 14000, 15000), m('마라샹궈 1인', 16000, 16000, 17000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 35, deliveryFee: 3500, takeoutMinutes: 15 },
  { key: '13', name: '포케 그린', category: '양식', d: 270, orders: { walk: 17, takeout: 11, delivery: 20 }, rating: 4.6,
    menus: [m('연어 포케', 12500, 12500, 13500, true), m('닭가슴살 포케', 11000, 11000, 12000), m('그릭요거트', 6000, 6000, 6500)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 8 },
  { key: '14', name: '떡볶이 연구실', category: '분식', d: 285, orders: { walk: 39, takeout: 14, delivery: 29 }, rating: 4.3,
    menus: [m('로제 떡볶이', 14000, 14000, 15000, true), m('모둠튀김', 5000, 5000, 5500), m('순대', 4500, 4500, 5000)],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 2500, takeoutMinutes: 10 },
  // 메뉴 정보가 아직 등록되지 않은 매장 — '메뉴정보 준비 중'으로 표시된다
  { key: '15', name: '카레 하우스', category: '일식', d: 295, orders: { walk: 21, takeout: 3 }, rating: 4.2,
    menus: [], modes: ['walk', 'takeout'], takeoutMinutes: 9 },
  { key: '16', name: '치킨 브라더스', category: '패스트푸드', d: 650, orders: { delivery: 63 }, rating: 4.4,
    menus: [m('후라이드 치킨', null, null, 19000, true), m('양념 치킨', null, null, 21000, true), m('치킨마요 덮밥', null, null, 7000)],
    modes: ['delivery'], deliveryMinutes: 35, deliveryFee: 3000 },
  { key: '17', name: '달콤 디저트랩', category: '카페·디저트', d: 800, orders: { delivery: 24 }, rating: 4.6,
    menus: [m('크로플', null, null, 6500, true), m('딸기 케이크 조각', null, null, 7000), m('바닐라 라떼', null, null, 5000)],
    modes: ['delivery'], deliveryMinutes: 30, deliveryFee: 3000 },
  { key: '18', name: '피자 공장', category: '양식', d: 900, orders: { takeout: 9, delivery: 36 }, rating: 4.3,
    menus: [m('페퍼로니 피자 L', null, 19000, 22000, true), m('고르곤졸라 M', null, 15000, 17000), m('치즈오븐스파게티', null, 8000, 9000)],
    modes: ['delivery', 'takeout'], deliveryMinutes: 40, deliveryFee: 3000, takeoutMinutes: 20 },
  { key: '19', name: '족발 명가', category: '한식', d: 1400, orders: { delivery: 28 }, rating: 4.5,
    menus: [m('족발 중', null, null, 33000, true), m('보쌈 중', null, null, 32000), m('막국수', null, null, 8000)],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 3500 },
  { key: '20', name: '팟타이 키친', category: '아시안', d: 2200, orders: { delivery: 15 }, rating: 4.4,
    menus: [m('팟타이', null, null, 11000, true), m('똠얌꿍', null, null, 13000), m('푸팟퐁커리', null, null, 18000)],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 4000 },
  { key: '21', name: '한우 국밥집', category: '한식', d: 3600, orders: { delivery: 33 }, rating: 4.5,
    menus: [m('한우 국밥', null, null, 12000, true), m('수육 국밥', null, null, 13000), m('모둠 수육', null, null, 30000)],
    modes: ['delivery'], deliveryMinutes: 50, deliveryFee: 4000, deliveryRadiusM: 3000 },
];

const DIRECTIONS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function directionName(bearingDeg: number): string {
  return DIRECTIONS[Math.round(bearingDeg / 45) % 8];
}

/**
 * 지역 중심 좌표 주변에 가상 매장을 배치한다.
 * 방위각과 주문 수는 지역 키로 결정적으로 달라져서, 지역마다 인기 순위가 조금씩 다르다.
 * 주소는 실제 주소로 오인하지 않도록 '가상 주소 · 기준점에서의 방향·거리'로 만든다.
 */
export function buildMockRestaurants(areaKey: string, center: GeoPoint, areaLabel: string): Restaurant[] {
  return TEMPLATES.map(({ key, d, orders, menus, ...rest }) => {
    const id = `${areaKey}-${key}`;
    const seed = hashString(`${areaKey}:${key}`);
    const bearing = seed % 360;
    const recentOrders: Partial<Record<Mode, number>> = {};
    for (const mode of rest.modes) {
      const base = orders[mode];
      if (base !== undefined) recentOrders[mode] = Math.max(1, base + (seed % 15) - 7);
    }
    return {
      ...rest,
      channelStatus: {
        walk: rest.modes.includes('walk') ? 'yes' : 'no',
        delivery: rest.modes.includes('delivery') ? 'yes' : 'no',
        takeout: rest.modes.includes('takeout') ? 'yes' : 'no',
      },
      id,
      address: `가상 주소 · ${areaLabel} ${directionName(bearing)}쪽 약 ${d}m`,
      location: destinationPoint(center, d, bearing),
      coordVerified: false,
      recentOrders,
      menus: menus.map((menu, i) => ({ id: `${id}-m${i + 1}`, ...menu })),
      dataSource: { kind: 'mock', realtime: false, updatedAt: MOCK_UPDATED_AT },
    };
  });
}

const PILOT_DATA = new Map<PilotAreaId, Restaurant[]>(
  PILOT_AREAS.map((a) => [a.id, buildMockRestaurants(a.id, a.center, `${a.name}역`)]),
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
  return { areaName: null, restaurants: buildMockRestaurants('here', point, '현재 위치') };
}
