import type { MarketAnalysis, MarketChannel, MarketPeriod, PublicSource, ReliabilityStatus } from './types';

export const PERIOD_LABEL: Record<MarketPeriod, string> = {
  today: '오늘',
  '7d': '최근 7일',
  '30d': '최근 30일',
  '90d': '최근 3개월',
};

export const CHANNEL_NAME: Record<MarketChannel, string> = { HALL: '홀', DELIVERY: '배달', PICKUP: '포장' };

export const RELIABILITY_LABEL: Record<ReliabilityStatus, string> = {
  none: '분석할 데이터가 부족합니다',
  insufficient: '표본 부족 · 참고용',
  ok: '내부 품질 기준 충족',
};

export const PUBLIC_SOURCE_LABEL: Record<PublicSource, string> = {
  seoul_golmok: '서울시 상권분석서비스',
  seoul_realtime: '서울시 실시간 상권현황',
  gyeonggi: '경기도 공개자료',
  seongnam: '성남시 공개자료',
  other_public: '기타 공공자료',
};

export const DOW_LABEL = ['', '월', '화', '수', '목', '금', '토', '일'];

/** 하루 중 분(0~1440) → 'HH:MM' */
export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 30분 구간 번호 → '12:00~12:30' */
export function slotRange(from: number, to = from + 1): string {
  return `${hhmm(from * 30)}~${hhmm(to * 30)}`;
}

export function won(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function count(n: number | null | undefined, unit = '건'): string {
  return n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('ko-KR')}${unit}`;
}

export function pct(r: number | null | undefined, digits = 0): string {
  return r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`;
}

/** 변화율(%) → '+3.2%' / '비교 자료 없음' */
export function change(p: number | null | undefined): string {
  if (p === null || p === undefined) return '비교 자료 없음';
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

/** 가격대 이름 — 상한 포함 */
export function bandLabel(lo: number, hi: number | null): string {
  if (lo === 0 && hi !== null) return `${hi.toLocaleString('ko-KR')}원 이하`;
  if (hi === null) return `${(lo - 1).toLocaleString('ko-KR')}원 초과`;
  return `${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원`;
}

export function dateLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}

export function periodRange(a: MarketAnalysis): string {
  if (a.period.live) return `오늘 ${dateLabel(a.period.from)} · ${hhmm(a.period.now_slot * 30)}경까지 진행 중`;
  return `${dateLabel(a.period.from)}~${dateLabel(a.period.to)} (완료된 날)`;
}

export function kstTime(iso: string | null | undefined): string {
  if (!iso) return '없음';
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. 수식으로 해석될 수 있는 앞글자는 막는다 */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 관리자 CSV 통계 다운로드 — 집계 결과만 (개별 주문·매장 정보 없음) */
export function analysisToCsv(a: MarketAnalysis): string {
  const rows: unknown[][] = [];
  const scope = a.scope === 'test' ? '테스트 데이터' : a.scope === 'business' ? '사업자 공개 범위' : '실제 데이터(내부)';
  rows.push(['상권', a.area.name, a.area.label], ['기간', PERIOD_LABEL[a.period.key], periodRange(a)], ['범위', scope]);
  rows.push(['점심 분석시간', `${hhmm(a.lunch.start_min)}~${hhmm(a.lunch.end_min)}`], ['금액 기준', '메뉴 판매금액 기준 순결제금액(할인·환불 반영, 배달비 제외)']);
  rows.push(['신뢰상태', RELIABILITY_LABEL[a.reliability.status], ...a.reliability.reasons]);
  rows.push([]);
  rows.push(['구분', '항목', '주문 건수', '비율', '분석 금액 합계', '평균 주문금액', '중앙값']);
  rows.push(['전체', '전체', a.totals.orders, '', a.totals.amount_sum, a.totals.avg ?? '', a.totals.median ?? '']);
  for (const c of a.channels) rows.push(['채널', CHANNEL_NAME[c.channel], c.orders, c.share ?? '', c.amount_sum, c.avg ?? '', c.median ?? '']);
  for (const b of a.price_bands) rows.push(['가격대', bandLabel(b.lo, b.hi), b.orders, b.pct ?? '', '', '', '']);
  for (const s of a.slots_half) rows.push(['시간대', slotRange(s.slot), s.orders, '', s.amount_sum, s.avg ?? '', '']);
  for (const c of a.categories) rows.push(['음식 종류', c.category, c.orders, c.pct ?? '', '', c.avg ?? '', '']);
  for (const d of a.weekdays ?? []) rows.push(['요일', DOW_LABEL[d.dow], d.orders, '', '', d.avg ?? '', '']);
  rows.push([]);
  rows.push(['인기메뉴', '판매 수량', '판매금액', '판매 매장 수']);
  for (const m of a.menus.items) rows.push([m.name, m.quantity, m.amount_sum, m.stores]);
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
