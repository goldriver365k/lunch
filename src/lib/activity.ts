import type { Mode, OrderActivity, Restaurant } from '../types';
import { CHANNEL_LABEL } from './channels';
import { menusForChannel, type PricedMenu } from './restaurants';

/**
 * 주문 활발도 표시. 개별 주문이나 정확한 건수 대신 단계로만 보여준다.
 * '실시간'이라고 쓰지 않고 집계 기준시각을 함께 보여준다.
 * 주문 집계일 뿐 매장 안 손님 수나 대기시간이 아니다.
 */
const WINDOW_LABEL = { '10m': '최근 10분', '30m': '최근 30분', '60m': '최근 60분', lunch: '오늘 점심' } as const;
type WindowKey = keyof typeof WINDOW_LABEL;

export function activityLevel(count: number): string {
  if (count >= 20) return '매우 활발';
  if (count >= 10) return '활발';
  return '있음';
}

/** 가장 최근 창 하나로 요약 — 예: '최근 30분 홀 주문 활발' */
export function activitySummary(a: OrderActivity, mode: Mode): string | null {
  const key = (['10m', '30m', '60m', 'lunch'] as WindowKey[]).find((k) => a.windows[k] !== undefined);
  if (!key) return null;
  return `${WINDOW_LABEL[key]} ${CHANNEL_LABEL[mode]} 주문 ${activityLevel(a.windows[key]!)}`;
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
  return Object.keys(a.byProvider ?? {}).map((p) => PROVIDER_NAME[p as keyof typeof PROVIDER_NAME] ?? p);
}

/**
 * 카드에 보여줄 메뉴: 배달·포장은 그 채널 인기메뉴(가격이 등록된 경우), 아니면 대표메뉴.
 * 홀은 홀 대표메뉴를 그대로 쓴다.
 */
export function featuredMenu(r: Restaurant, mode: Mode): { priced: PricedMenu; popular: boolean } | null {
  const menus = menusForChannel(r, mode);
  if (mode !== 'walk' && r.activity?.topMenu) {
    const hit = menus.find((m) => m.menu.id === r.activity!.topMenu!.menuId);
    if (hit) return { priced: hit, popular: true };
  }
  return menus[0] ? { priced: menus[0], popular: false } : null;
}
