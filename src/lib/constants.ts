import type { Category, Mode, Radius, SortKey } from '../types';

export const APP_NAME = '점심뭐먹';
export const SLOGAN = '지금 다들 뭐 먹어?';

export const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: 'walk', label: '도보 식사', emoji: '🚶' },
  { key: 'delivery', label: '배달', emoji: '🛵' },
  { key: 'takeout', label: '포장', emoji: '🛍️' },
];

export const RADII: Radius[] = [100, 200, 300];
export const DEFAULT_RADIUS: Radius = 100;

/** 매장에 배달 가능 거리가 없을 때 쓰는 기본값 (미터) */
export const DEFAULT_DELIVERY_RADIUS_M = 3000;

/** 도보 속도 — 분당 미터 (약 4km/h) */
export const WALK_M_PER_MIN = 67;

export const CATEGORIES: Category[] = [
  '한식',
  '중식',
  '일식',
  '양식',
  '분식',
  '아시안',
  '패스트푸드',
  '카페·디저트',
  '기타',
];

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: '지금 주문 많은 순' },
  { key: 'distance', label: '거리순' },
];

/** 반경 필터를 쓰는 탭인지 */
export function usesRadius(mode: Mode): boolean {
  return mode === 'walk' || mode === 'takeout';
}
