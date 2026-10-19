// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OrderValidationError, sanitizeOrder } from '../../../supabase/functions/_shared/canonicalOrder.ts';
import { handleOrderWebhook, hmacHex, type WebhookDeps } from '../../../supabase/functions/_shared/orderWebhook.ts';
import { pollOnce, type OrderConnector } from './connector';
import { baeminConnector } from './baeminConnector';
import { coupangEatsConnector } from './coupangEatsConnector';
import { posAdapter, posConnector } from './posConnector';
import { kstIso, mapChannel, OrderCsvFormatError, parseOrderCsv } from './orderCsv';
import { generateTestScenario, mockConnector } from './testOrders';

const raw = {
  external_order_id: ' A-1 ',
  channel: 'delivery',
  ordered_at: '2026-10-19T12:03:00+09:00',
  total_amount: '21,000',
  items: [{ name: '고추장불백', quantity: 2, unit_price: 10500 }],
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  delivery_address: '서울 강남구 테헤란로 1, 101동 1203호',
  card_number: '1234-****',
};

describe('공통 주문 형식', () => {
  it('허용한 필드만 남겨 개인정보를 버린다', () => {
    const o = sanitizeOrder(raw);
    expect(o).toMatchObject({ external_order_id: 'A-1', channel: 'DELIVERY', total_amount: 21000, is_cancelled: false });
    expect(o.ordered_at).toBe('2026-10-19T03:03:00.000Z');
    const text = JSON.stringify(o);
    for (const s of ['홍길동', '010-1234', '101동', '1234-****']) expect(text).not.toContain(s);
  });

  it('잘못된 값은 거부한다', () => {
    expect(() => sanitizeOrder({ ...raw, external_order_id: '' })).toThrow(OrderValidationError);
    expect(() => sanitizeOrder({ ...raw, channel: 'DRONE' })).toThrow(/채널/);
    expect(() => sanitizeOrder({ ...raw, items: [{ name: 'x', quantity: 0 }] })).toThrow(/수량/);
    expect(() => sanitizeOrder({ ...raw, total_amount: -1 })).toThrow(/총금액/);
    expect(() => sanitizeOrder({ ...raw, ordered_at: '어제' })).toThrow(/시각/);
  });

  it('주문상태가 cancelled면 취소로 본다', () => {
    expect(sanitizeOrder({ ...raw, order_status: 'cancelled' }).is_cancelled).toBe(true);
  });
});

describe('웹훅 수신', () => {
  const conn = { id: 'c1', provider: 'pos' as const, status: 'active', is_test: false, ingest_mode: 'webhook', credential_ref: 'POS_C1' };
  const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({
    getConnection: async () => conn,
    getSecret: (ref) => (ref === 'POS_C1' ? 'shared-secret' : undefined),
    ingest: vi.fn(async () => ({ inserted: 1 })),
    recordError: vi.fn(async () => {}),
    ...over,
  });
  const body = JSON.stringify({ orders: [raw] });

  it('서명이 맞으면 개인정보를 뺀 공통 형식으로 수집한다', async () => {
    const d = deps();
    const r = await handleOrderWebhook(
      { connectionId: 'c1', format: 'canonical', signature: `sha256=${await hmacHex('shared-secret', body)}`, rawBody: body },
      d,
    );
    expect(r.status).toBe(200);
    const sent = (d.ingest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.stringify(sent)).not.toContain('010-1234');
  });

  it('서명이 틀리면 401, 수집하지 않는다', async () => {
    const d = deps();
    const r = await handleOrderWebhook({ connectionId: 'c1', format: 'canonical', signature: 'sha256=00', rawBody: body }, d);
    expect(r.status).toBe(401);
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it('비활성·테스트·없는 연동은 거부한다', async () => {
    const sig = `sha256=${await hmacHex('shared-secret', body)}`;
    const req = { connectionId: 'c1', format: 'canonical', signature: sig, rawBody: body };
    expect((await handleOrderWebhook(req, deps({ getConnection: async () => ({ ...conn, status: 'preparing' }) }))).status).toBe(409);
    expect((await handleOrderWebhook(req, deps({ getConnection: async () => ({ ...conn, is_test: true }) }))).status).toBe(404);
    expect((await handleOrderWebhook(req, deps({ getConnection: async () => null }))).status).toBe(404);
    expect((await handleOrderWebhook(req, deps({ getSecret: () => undefined }))).status).toBe(503);
  });

  it('명세가 없는 제공처 고유 형식은 501로 거부하고 오류를 기록한다', async () => {
    const d = deps();
    const sig = `sha256=${await hmacHex('shared-secret', body)}`;
    const r = await handleOrderWebhook({ connectionId: 'c1', format: 'baemin-native', signature: sig, rawBody: body }, d);
    expect(r.status).toBe(501);
    expect(d.recordError).toHaveBeenCalled();
    expect(d.ingest).not.toHaveBeenCalled();
  });
});

describe('연결 모듈', () => {
  it('배민·쿠팡이츠는 서로 다른 모듈이고, 계약 전에는 외부 호출 없이 연동 준비', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const b = baeminConnector('하이픈');
    const c = coupangEatsConnector('');
    expect(b.provider).toBe('baemin');
    expect(c.provider).toBe('coupangeats');
    for (const conn of [b, c, posConnector('OKPOS')]) {
      const t = await conn.testConnection();
      expect(t).toMatchObject({ ok: false, readiness: 'preparing', calledExternalApi: false });
      expect(t.message).toContain('실제 연결 미검증');
      await expect(conn.fetchOrders!('2026-10-19T00:00:00Z')).rejects.toThrow(/외부 호출을 하지 않았어요/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('POS 공통 인터페이스: 업체 어댑터로 공통 형식 변환', () => {
    expect(posAdapter('canonical')!.normalize(raw).external_order_id).toBe('A-1');
    expect(posAdapter('없는업체')).toBeUndefined();
  });

  it('주기 조회: 연동 준비 상태면 호출 예약도 하지 않는다', async () => {
    const reserve = vi.fn(async () => true);
    const r = await pollOnce(baeminConnector('하이픈'), '2026-10-19T00:00:00Z', {
      reserveCalls: reserve,
      ingest: vi.fn(),
      recordError: vi.fn(),
    });
    expect(r.status).toBe('skipped');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('주기 조회: 한도 초과면 외부 조회를 하지 않고, 실패하면 오류를 기록한다', async () => {
    const fetchOrders = vi.fn(async () => [sanitizeOrder(raw)]);
    const ready: OrderConnector = { ...mockConnector('baemin'), readiness: 'ready', kind: 'polling', fetchOrders };
    const ingest = vi.fn(async () => ({}));
    expect((await pollOnce(ready, 'x', { reserveCalls: async () => false, ingest, recordError: vi.fn() })).status).toBe('skipped');
    expect(fetchOrders).not.toHaveBeenCalled();
    expect((await pollOnce(ready, 'x', { reserveCalls: async () => true, ingest, recordError: vi.fn() })).count).toBe(1);
    const recordError = vi.fn(async () => {});
    fetchOrders.mockRejectedValueOnce(new Error('timeout'));
    expect((await pollOnce(ready, 'x', { reserveCalls: async () => true, ingest, recordError })).status).toBe('error');
    expect(recordError).toHaveBeenCalledWith('timeout');
  });
});

describe('주문 CSV', () => {
  const header = ['주문번호', '주문시각', '채널', '메뉴명', '수량', '단가', '주문총금액', '취소여부', '고객전화번호', '배달주소'];
  it('같은 주문번호 행을 한 주문으로 묶고, 개인정보 열은 읽지 않는다', () => {
    const r = parseOrderCsv([
      header,
      ['A1', '2026-10-19 12:03', '홀', '돼지불백', '2', '9000', '27000', '', '010-1111-2222', ''],
      ['A1', '2026-10-19 12:03', '홀', '김치찌개', '1', '9000', '27000', '', '010-1111-2222', ''],
      ['A2', '2026-10-19 12:10', '포장', '간장불백', '1', '9000', '9000', 'Y', '', ''],
      ['A3', '2026-10-19 12:15', '배달', '돼지불백', '0', '9000', '9000', '', '', '서울 어딘가'],
    ]);
    expect(r.orders).toHaveLength(2);
    expect(r.orders[0]).toMatchObject({ external_order_id: 'A1', channel: 'HALL', total_amount: 27000 });
    expect(r.orders[0].items.map((i) => [i.name, i.quantity])).toEqual([['돼지불백', 2], ['김치찌개', 1]]);
    expect(r.orders[0].ordered_at).toBe('2026-10-19T03:03:00.000Z'); // 한국시간
    expect(r.orders[1]).toMatchObject({ channel: 'PICKUP', is_cancelled: true });
    expect(r.errors).toEqual([{ row: 5, message: expect.stringContaining('수량') }]);
    expect(r.ignoredColumns).toEqual(['고객전화번호', '배달주소']);
    expect(JSON.stringify(r.orders)).not.toContain('010-1111');
  });

  it('필수 열이 없으면 알려준다', () => {
    expect(() => parseOrderCsv([['주문번호', '메뉴명']])).toThrow(OrderCsvFormatError);
  });

  it('채널·시각 변환', () => {
    expect(mapChannel('매장 식사')).toBe('HALL');
    expect(mapChannel('방문포장')).toBe('PICKUP');
    expect(mapChannel('??')).toBe('UNKNOWN');
    expect(kstIso('2026.10.19 12:03')).toBe('2026-10-19T12:03:00+09:00');
    expect(kstIso('2026-10-19T03:03:00Z')).toBe('2026-10-19T03:03:00Z');
  });
});

describe('테스트 주문 생성기', () => {
  it('채널별 주문·취소·환불·재전송·통합·중복 의심 상황을 만들고 기대 집계를 계산한다', () => {
    const now = new Date('2026-10-19T03:30:00Z');
    const s = generateTestScenario([{ name: '돼지불백', price_dine_in: 9000, price_delivery: 10000, price_takeout: 8500 }], now, 7);
    expect(s.batches.pos.some((o) => o.channel === 'HALL')).toBe(true);
    expect(s.batches.baemin.some((o) => o.channel === 'DELIVERY')).toBe(true);
    expect(s.batches.coupangeats.length).toBeGreaterThan(0);
    expect(s.batches.pos.some((o) => o.is_cancelled)).toBe(true);
    expect(s.batches.baemin.some((o) => (o.refund_amount ?? 0) > 0)).toBe(true);
    const ids = s.batches.pos.map((o) => o.external_order_id);
    expect(new Set(ids).size).toBe(ids.length - 1); // 재전송 1건
    expect(s.expected['60m'].HALL).toBeGreaterThanOrEqual(s.expected['30m'].HALL);
    expect(s.expected['30m'].HALL).toBeGreaterThanOrEqual(s.expected['10m'].HALL);
    expect(s.notes).toHaveLength(5);
    // 모든 주문이 공통 형식 검사를 통과
    for (const list of Object.values(s.batches)) for (const o of list) expect(() => sanitizeOrder({ ...o })).not.toThrow();
    // 같은 씨드면 같은 결과
    expect(generateTestScenario([], now, 3)).toEqual(generateTestScenario([], now, 3));
  });

  it('가상 연결은 외부 호출 없이 정상/오류를 흉내 낸다', async () => {
    expect(await mockConnector('pos').testConnection()).toMatchObject({ ok: true, calledExternalApi: false });
    expect(await mockConnector('pos', { simulateError: true }).testConnection()).toMatchObject({ ok: false });
  });
});
