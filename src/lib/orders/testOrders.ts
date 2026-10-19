import type { CanonicalOrder, OrderChannel, OrderProvider } from '../../../supabase/functions/_shared/canonicalOrder.ts';
import type { ConnectionTestResult, OrderConnector } from './connector';

/**
 * 테스트용 가상 주문 (관리자 시험 전용).
 * 실제 주문이 아니며 반드시 테스트 연동(is_test)으로만 넣는다 → 소비자 공개·실제 통계에 섞이지 않는다.
 */

export interface TestMenu {
  name: string;
  price_dine_in: number | null;
  price_delivery: number | null;
  price_takeout: number | null;
}

export type TestBatches = Record<OrderProvider, CanonicalOrder[]>;

export type WindowKey = '10m' | '30m' | '60m';

export interface TestScenario {
  batches: TestBatches;
  /** 생성기가 계산한 기대 유효 주문 수 — DB 집계와 비교해 검증한다 */
  expected: Record<WindowKey, Record<'HALL' | 'DELIVERY' | 'PICKUP', number>>;
  /** 일부러 넣은 상황 설명 */
  notes: string[];
}

/** 같은 씨드면 같은 결과 */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const FALLBACK_MENUS: TestMenu[] = [
  { name: '테스트 메뉴 A', price_dine_in: 9000, price_delivery: 10000, price_takeout: 8500 },
  { name: '테스트 메뉴 B', price_dine_in: 11000, price_delivery: 12000, price_takeout: 10500 },
];

const PRICE_KEY = { HALL: 'price_dine_in', DELIVERY: 'price_delivery', PICKUP: 'price_takeout' } as const;

export function generateTestScenario(menusIn: TestMenu[], now: Date, seed = 1): TestScenario {
  const menus = menusIn.length > 0 ? menusIn : FALLBACK_MENUS;
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const batches: TestBatches = { pos: [], baemin: [], coupangeats: [], csv: [] };
  const valid: { channel: 'HALL' | 'DELIVERY' | 'PICKUP'; minsAgo: number }[] = [];
  const notes: string[] = [];
  let seq = 0;

  const make = (prefix: string, channel: OrderChannel, minsAgo: number, extra: Partial<CanonicalOrder> = {}): CanonicalOrder => {
    const priceKey = PRICE_KEY[channel as keyof typeof PRICE_KEY] ?? 'price_dine_in';
    const lines = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => {
      const m = pick(menus);
      const unit = m[priceKey] ?? m.price_dine_in ?? 9000;
      const qty = 1 + Math.floor(rand() * 2);
      return { name: m.name, quantity: qty, unit_price: unit, line_amount: unit * qty };
    });
    const at = new Date(now.getTime() - minsAgo * 60000 - Math.floor(rand() * 50) * 1000).toISOString();
    return {
      external_order_id: `TEST-${prefix}-${seed}-${++seq}`,
      channel,
      ordered_at: at,
      paid_at: at,
      total_amount: lines.reduce((s, l) => s + l.line_amount, 0),
      order_status: 'completed',
      payment_status: 'paid',
      items: lines,
      ...extra,
    };
  };
  // 집계 창 경계(9·29·59분)에 걸치면 처리 시간 몇 초 때문에 기대값이 흔들리므로 피한다
  const minute = () => {
    const m = Math.floor(rand() * 70);
    return [9, 29, 59].includes(m) ? m - 2 : m;
  };
  const isPosSide = (p: OrderProvider) => p === 'pos' || p === 'csv';
  /** 우연히 ‘중복 의심’ 규칙(POS↔배달앱, 같은 채널·금액, 3분 이내)에 걸리는지 */
  const collides = (provider: OrderProvider, o: CanonicalOrder) =>
    (Object.keys(batches) as OrderProvider[])
      .filter((p) => isPosSide(p) !== isPosSide(provider))
      .some((p) =>
        batches[p].some(
          (x) =>
            x.channel === o.channel &&
            x.total_amount === o.total_amount &&
            Math.abs(Date.parse(x.ordered_at) - Date.parse(o.ordered_at)) <= 4 * 60000,
        ),
      );
  const addRandom = (provider: OrderProvider, prefix: string, channel: OrderChannel) => {
    let o = make(prefix, channel, minute());
    for (let tries = 0; collides(provider, o) && tries < 50; tries++) o = make(prefix, channel, minute());
    add(provider, o);
  };
  const add = (provider: OrderProvider, o: CanonicalOrder, counted = true) => {
    batches[provider].push(o);
    if (counted && !o.is_cancelled && o.channel !== 'UNKNOWN') {
      valid.push({ channel: o.channel as 'HALL' | 'DELIVERY' | 'PICKUP', minsAgo: (now.getTime() - Date.parse(o.ordered_at)) / 60000 });
    }
  };

  // 홀(POS)·방문 포장(POS)·배민 배달/포장·쿠팡이츠 배달을 0~70분 전에 고르게
  for (let i = 0; i < 14; i++) addRandom('pos', 'HALL', 'HALL');
  for (let i = 0; i < 4; i++) addRandom('pos', 'POSPICK', 'PICKUP');
  for (let i = 0; i < 8; i++) addRandom('baemin', 'BM', 'DELIVERY');
  for (let i = 0; i < 3; i++) addRandom('baemin', 'BMPICK', 'PICKUP');
  for (let i = 0; i < 6; i++) addRandom('coupangeats', 'CE', 'DELIVERY');

  // 취소·환불
  add('pos', make('CANCEL', 'HALL', 5, { is_cancelled: true, order_status: 'cancelled', payment_status: 'refunded' }));
  notes.push('홀 주문 1건 취소 (집계 제외)');
  const refunded = make('REFUND', 'DELIVERY', 7);
  refunded.refund_amount = Math.floor(refunded.total_amount / 2);
  refunded.payment_status = 'partially_refunded';
  add('baemin', refunded);
  notes.push('배민 주문 1건 부분 환불 (건수 포함, 실제 집계금액에서 환불 차감)');

  // 같은 주문 재전송 → 신규로 늘지 않아야 함
  batches.pos.push({ ...batches.pos[0] });
  notes.push('POS 주문 1건 같은 주문번호로 재전송 (중복 생성 없음)');

  // 배민 주문이 POS에도 자동 입력 (연결번호 있음) → 통합
  const linked = make('BM', 'DELIVERY', 3, { link_key: `TEST-LINK-${seed}` });
  add('baemin', linked);
  add('pos', { ...linked, external_order_id: `TEST-POSCOPY-${seed}-${++seq}` }, false);
  notes.push('배민 주문 1건이 POS에도 연결번호와 함께 기록 → 하나로 통합');

  // 쿠팡이츠 주문이 POS에 연결번호 없이 기록 → 중복 가능성 확인 필요
  const unlinked = make('CE', 'DELIVERY', 4);
  add('coupangeats', unlinked);
  add('pos', { ...unlinked, external_order_id: `TEST-POSCOPY-${seed}-${++seq}`, ordered_at: new Date(Date.parse(unlinked.ordered_at) + 60000).toISOString() }, false);
  notes.push('쿠팡이츠 주문 1건이 POS에 연결번호 없이 기록 → ‘중복 가능성 확인 필요’ (합산 안 함)');

  const expected = Object.fromEntries(
    (['10m', '30m', '60m'] as WindowKey[]).map((w) => {
      const mins = Number(w.replace('m', ''));
      const count = (ch: 'HALL' | 'DELIVERY' | 'PICKUP') => valid.filter((v) => v.channel === ch && v.minsAgo < mins).length;
      return [w, { HALL: count('HALL'), DELIVERY: count('DELIVERY'), PICKUP: count('PICKUP') }];
    }),
  ) as TestScenario['expected'];

  return { batches, expected, notes };
}

/** 테스트용 가상 연결 — 외부 호출 없이 성공/오류를 흉내 낸다 */
export function mockConnector(provider: OrderProvider, opts: { simulateError?: boolean } = {}): OrderConnector {
  return {
    provider,
    vendor: '가상 연결(테스트)',
    label: `${provider} 가상 연결`,
    kind: 'webhook',
    readiness: 'mock',
    async testConnection(): Promise<ConnectionTestResult> {
      return opts.simulateError
        ? { ok: false, readiness: 'mock', message: '테스트: API 연결 오류(시뮬레이션)', calledExternalApi: false }
        : { ok: true, readiness: 'mock', message: '테스트 연결 정상 (가상, 외부 호출 없음)', calledExternalApi: false };
    },
  };
}
