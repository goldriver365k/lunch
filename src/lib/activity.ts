import type { Mode, OrderActivity, Restaurant } from '../types';
import { CHANNEL_LABEL } from './channels';
import { menusForChannel, type PricedMenu } from './restaurants';

/**
 * 주문 활발도 표시.
 * - 정확한 건수 대신 단계로만 보여주고, 데이터 기준시각을 함께 보여준다.
 * - 최신 데이터가 아니면 활발도를 보여주지 않는다 ('데이터 갱신 지연').
 * - 주문 집계일 뿐 매장 안 손님 수나 대기시간이 아니다.
 */
const WINDOW_LABEL = { '10m': '최근 10분', '30m': '최근 30분', '60m': '최근 60분', lunch: '오늘 점심' } as const;
type WindowKey = keyof typeof WINDOW_LABEL;

export function activityLevel(count: number): string {
  if (count >= 20) return '매우 활발';
  if (count >= 10) return '활발';
  return '있음';
}

/** 카드 한 줄 요약 — 예: '최근 10분 홀 주문 활발' / '최근 30분 홀 주문 없음' / '데이터 갱신 지연' */
export function activitySummary(a: OrderActivity, mode: Mode): string {
  const ch = CHANNEL_LABEL[mode];
  if (a.status === 'delayed') return '데이터 갱신 지연';
  if (a.status === 'none_recent') return `최근 ${a.secondaryMinutes}분 ${ch} 주문 없음`;
  const key = (['10m', '30m', '60m', 'lunch'] as WindowKey[]).find((k) => a.windows[k] !== undefined);
  // 최소 공개 건수 미만이면 단계 없이 '확인'만
  if (!key) return `최근 ${ch} 주문 확인`;
  return `${WINDOW_LABEL[key]} ${ch} 주문 ${activityLevel(a.windows[key]!)}`;
}

export function activityWindows(a: OrderActivity): { label: string; level: string }[] {
  return (['10m', '30m', '60m', 'lunch'] as WindowKey[])
    .filter((k) => a.windows[k] !== undefined)
    .map((k) => ({ label: WINDOW_LABEL[k], level: activityLevel(a.windows[k]!) }));
}

export function asOfTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

const PROVIDER_NAME = { baemin: '배민', coupangeats: '쿠팡이츠', pos: '매장 POS', csv: '매장 자료' } as const;

/** 배달 제공처 구분 — 이름만 (건수는 공개하지 않는다) */
export function providerNames(a: OrderActivity): string[] {
  return a.providers.map((p) => PROVIDER_NAME[p] ?? p);
}

/** 인기메뉴 순위 — 이 채널 가격이 등록된 내부 메뉴만 */
export function popularMenus(r: Restaurant, mode: Mode): PricedMenu[] {
  const menus = menusForChannel(r, mode);
  return (r.activity?.topMenus ?? [])
    .map((t) => menus.find((m) => m.menu.id === t.menuId))
    .filter((m): m is PricedMenu => m !== undefined);
}

/**
 * 카드에 보여줄 메뉴: 배달·포장은 그 채널 인기메뉴 1위(가격이 등록된 경우), 아니면 대표메뉴.
 * 홀은 홀 대표메뉴를 그대로 쓴다.
 */
export function featuredMenu(r: Restaurant, mode: Mode): { priced: PricedMenu; popular: boolean } | null {
  if (mode !== 'walk') {
    const top = popularMenus(r, mode)[0];
    if (top) return { priced: top, popular: true };
  }
  const first = menusForChannel(r, mode)[0];
  return first ? { priced: first, popular: false } : null;
}
