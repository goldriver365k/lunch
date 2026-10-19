import type { Restaurant } from '../types';

/**
 * ⚠️ 가상 데이터 (MOCK)
 * 1단계 시연용으로 만든 가짜 음식점 목록입니다.
 * 상호·거리·가격·주문 수는 모두 임의로 지어낸 값이며 실제 가게와 무관합니다.
 * 실제 지도 API·POS·배달앱·카드사 데이터는 사용하지 않습니다.
 */
export const IS_MOCK_DATA = true;

export const MOCK_RESTAURANTS: Restaurant[] = [
  {
    id: 'm01', name: '골목집 백반', category: '한식', distanceM: 25, recentOrders: 42, rating: 4.6,
    menus: [{ name: '제육볶음 백반', price: 9000 }, { name: '김치찌개', price: 8500 }, { name: '계란말이', price: 6000 }],
    modes: ['walk', 'takeout'], takeoutMinutes: 10,
  },
  {
    id: 'm02', name: '모퉁이 김밥', category: '분식', distanceM: 28, recentOrders: 55, rating: 4.3,
    menus: [{ name: '참치김밥', price: 4500 }, { name: '라볶이', price: 6500 }, { name: '떡볶이', price: 5000 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 5,
  },
  {
    id: 'm03', name: '오늘의 국수', category: '한식', distanceM: 40, recentOrders: 31, rating: 4.4,
    menus: [{ name: '잔치국수', price: 7000 }, { name: '비빔국수', price: 7500 }, { name: '수육 소', price: 15000 }],
    modes: ['walk', 'takeout'], takeoutMinutes: 8,
  },
  {
    id: 'm04', name: '빨간짬뽕집', category: '중식', distanceM: 45, recentOrders: 38, rating: 4.2,
    menus: [{ name: '짬뽕', price: 9000 }, { name: '짜장면', price: 7000 }, { name: '탕수육 소', price: 16000 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 12,
  },
  {
    id: 'm05', name: '스시 한 점', category: '일식', distanceM: 48, recentOrders: 19, rating: 4.7,
    menus: [{ name: '점심 초밥 12p', price: 15000 }, { name: '연어덮밥', price: 13000 }, { name: '우동', price: 8000 }],
    modes: ['walk', 'takeout'], takeoutMinutes: 15,
  },
  {
    id: 'm06', name: '돈까스 공방', category: '일식', distanceM: 55, recentOrders: 47, rating: 4.5,
    menus: [{ name: '등심돈까스', price: 10000 }, { name: '치즈돈까스', price: 11500 }, { name: '냉모밀', price: 8500 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 12,
  },
  {
    id: 'm07', name: '파스타 브릿지', category: '양식', distanceM: 60, recentOrders: 22, rating: 4.4,
    menus: [{ name: '알리오올리오', price: 12000 }, { name: '토마토 리조또', price: 13500 }, { name: '시저 샐러드', price: 9500 }],
    modes: ['walk', 'delivery'], deliveryMinutes: 35, deliveryFee: 3000,
  },
  {
    id: 'm08', name: '쌀국수 하루', category: '아시안', distanceM: 65, recentOrders: 34, rating: 4.3,
    menus: [{ name: '양지 쌀국수', price: 10000 }, { name: '분짜', price: 12000 }, { name: '짜조', price: 6000 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 30, deliveryFee: 2500, takeoutMinutes: 10,
  },
  {
    id: 'm09', name: '버거 스테이션', category: '패스트푸드', distanceM: 68, recentOrders: 51, rating: 4.1,
    menus: [{ name: '클래식 버거 세트', price: 8900 }, { name: '더블치즈버거', price: 7500 }, { name: '감자튀김', price: 2500 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 20, deliveryFee: 2000, takeoutMinutes: 6,
  },
  {
    id: 'm10', name: '구름 베이커리 카페', category: '카페·디저트', distanceM: 35, recentOrders: 29, rating: 4.5,
    menus: [{ name: '아메리카노', price: 3500 }, { name: '소금빵', price: 3000 }, { name: '샌드위치', price: 6500 }],
    modes: ['walk', 'takeout', 'delivery'], deliveryMinutes: 20, deliveryFee: 2500, takeoutMinutes: 4,
  },
  {
    id: 'm11', name: '순두부 한그릇', category: '한식', distanceM: 75, recentOrders: 26, rating: 4.4,
    menus: [{ name: '해물순두부', price: 9500 }, { name: '돌솥비빔밥', price: 9500 }, { name: '고등어구이', price: 10000 }],
    modes: ['walk', 'takeout'], takeoutMinutes: 12,
  },
  {
    id: 'm12', name: '마라 연구소', category: '중식', distanceM: 82, recentOrders: 44, rating: 4.2,
    menus: [{ name: '마라탕 (100g)', price: 2000 }, { name: '꿔바로우 소', price: 14000 }, { name: '마라샹궈 1인', price: 16000 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 35, deliveryFee: 3500, takeoutMinutes: 15,
  },
  {
    id: 'm13', name: '포케 그린', category: '양식', distanceM: 88, recentOrders: 17, rating: 4.6,
    menus: [{ name: '연어 포케', price: 12500 }, { name: '닭가슴살 포케', price: 11000 }, { name: '그릭요거트', price: 6000 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 3000, takeoutMinutes: 8,
  },
  {
    id: 'm14', name: '떡볶이 연구실', category: '분식', distanceM: 95, recentOrders: 39, rating: 4.3,
    menus: [{ name: '로제 떡볶이', price: 14000 }, { name: '모둠튀김', price: 5000 }, { name: '순대', price: 4500 }],
    modes: ['walk', 'delivery', 'takeout'], deliveryMinutes: 25, deliveryFee: 2500, takeoutMinutes: 10,
  },
  {
    id: 'm15', name: '카레 하우스', category: '일식', distanceM: 98, recentOrders: 21, rating: 4.2,
    menus: [{ name: '돈까스 카레', price: 10500 }, { name: '야채 카레', price: 8500 }, { name: '고로케', price: 3000 }],
    modes: ['walk', 'takeout'], takeoutMinutes: 9,
  },
  {
    id: 'm16', name: '치킨 브라더스', category: '패스트푸드', distanceM: 350, recentOrders: 63, rating: 4.4,
    menus: [{ name: '후라이드 치킨', price: 19000 }, { name: '양념 치킨', price: 21000 }, { name: '치킨마요 덮밥', price: 7000 }],
    modes: ['delivery'], deliveryMinutes: 35, deliveryFee: 3000,
  },
  {
    id: 'm17', name: '피자 공장', category: '양식', distanceM: 520, recentOrders: 36, rating: 4.3,
    menus: [{ name: '페퍼로니 피자 L', price: 22000 }, { name: '고르곤졸라 M', price: 17000 }, { name: '치즈오븐스파게티', price: 9000 }],
    modes: ['delivery', 'takeout'], deliveryMinutes: 40, deliveryFee: 3000, takeoutMinutes: 20,
  },
  {
    id: 'm18', name: '족발 명가', category: '한식', distanceM: 780, recentOrders: 28, rating: 4.5,
    menus: [{ name: '족발 중', price: 33000 }, { name: '보쌈 중', price: 32000 }, { name: '막국수', price: 8000 }],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 3500,
  },
  {
    id: 'm19', name: '팟타이 키친', category: '아시안', distanceM: 1200, recentOrders: 15, rating: 4.4,
    menus: [{ name: '팟타이', price: 11000 }, { name: '똠얌꿍', price: 13000 }, { name: '푸팟퐁커리', price: 18000 }],
    modes: ['delivery'], deliveryMinutes: 45, deliveryFee: 4000,
  },
  {
    id: 'm20', name: '달콤 디저트랩', category: '카페·디저트', distanceM: 420, recentOrders: 24, rating: 4.6,
    menus: [{ name: '크로플', price: 6500 }, { name: '딸기 케이크 조각', price: 7000 }, { name: '바닐라 라떼', price: 5000 }],
    modes: ['delivery'], deliveryMinutes: 30, deliveryFee: 3000,
  },
];
