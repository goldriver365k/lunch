import type { Category, Mode, Radius, SortKey } from '../types';

export const APP_NAME = '뭐먹';
export const SLOGAN = '지금 다들 뭐 먹어?';

export const MODES: { key: Mode; label: string; emoji: string }[] = [
  { key: 'walk', label: '도보 식사', emoji: '🚶' },
  { key: 'delivery', label: '배달', emoji: '🛵' },
  { key: 'takeout', label: '포장', emoji: '🛍️' },
];

export const RADII: Radius[] = [30, 50, 70, 100];
export const DEFAULT_RADIUS: Radius = 50;

export const CATEGORIES: Category[] = [
  '한식',
  '중식',
  '일식',
  '양식',
  '분식',
  '아시안',
  '패스트푸드',
  '카페·디저트',
];

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: '실시간 인기순' },
  { key: 'distance', label: '거리순' },
];

/** 반경 필터를 쓰는 탭인지 */
export function usesRadius(mode: Mode): boolean {
  return mode === 'walk' || mode === 'takeout';
}
