import { OrderValidationError, sanitizeOrder, type CanonicalOrder, type OrderChannel } from '../../../supabase/functions/_shared/canonicalOrder.ts';

/**
 * 주문 CSV (POS 연결이 없는 매장용). 한 행 = 주문 메뉴 1개, 같은 주문번호 행끼리 묶는다.
 * 필수: 주문번호, 주문시각, 채널(홀/배달/포장), 메뉴명, 수량, 주문총금액
 * 선택: 연결번호, 결제시각, 단가, 판매금액, 할인금액, 환불금액, 결제상태, 취소여부
 * 그 밖의 열(고객명·전화번호·주소 등)은 읽지 않는다.
 * 시각에 시간대가 없으면 한국시간으로 본다.
 */

const ALIASES = {
  orderNo: ['주문번호', '외부주문번호', 'order_id'],
  linkKey: ['연결번호', '주문연결번호'],
  orderedAt: ['주문시각', '주문일시', '주문시간'],
  paidAt: ['결제시각', '결제일시'],
  channel: ['채널', '주문채널', '주문구분'],
  menu: ['메뉴명', '메뉴', '상품명'],
  quantity: ['수량'],
  unitPrice: ['단가'],
  lineAmount: ['판매금액', '메뉴금액'],
  total: ['주문총금액', '총금액', '주문금액'],
  discount: ['할인금액', '할인'],
  refund: ['환불금액', '환불'],
  payment: ['결제상태'],
  cancelled: ['취소여부', '취소'],
} as const;

type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ['orderNo', 'orderedAt', 'channel', 'menu', 'quantity', 'total'];

export class OrderCsvFormatError extends Error {}

export interface OrderCsvResult {
  orders: CanonicalOrder[];
  errors: { row: number; message: string }[];
  rowCount: number;
  ignoredColumns: string[];
}

const norm = (h: string) => h.replace(/^\uFEFF/, '').replace(/[\s()_]/g, '').toLowerCase();

export function mapChannel(v: string): OrderChannel {
  const s = v.replace(/\s/g, '').toUpperCase();
  if (['홀', '매장', '매장식사', 'HALL', 'DINEIN'].includes(s)) return 'HALL';
  if (['배달', 'DELIVERY'].includes(s)) return 'DELIVERY';
  if (['포장', '방문포장', 'PICKUP', 'TAKEOUT'].includes(s)) return 'PICKUP';
  return 'UNKNOWN';
}

/** '2026-10-19 12:03' 처럼 시간대가 없으면 +09:00 */
export function kstIso(v: string): string {
  const t = v.trim().replace(/\./g, '-').replace(' ', 'T');
  const withSec = /T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(withSec) ? withSec : `${withSec}+09:00`;
}

const PAYMENT: Record<string, string> = {
  결제완료: 'paid', 완료: 'paid', paid: 'paid', 미결제: 'unpaid', unpaid: 'unpaid',
  환불: 'refunded', 전액환불: 'refunded', refunded: 'refunded', 부분환불: 'partially_refunded',
};

export function parseOrderCsv(rows: string[][]): OrderCsvResult {
  if (rows.length === 0) throw new OrderCsvFormatError('빈 파일이에요.');
  const header = rows[0].map(norm);
  const idx = {} as Record<Key, number>;
  for (const [k, aliases] of Object.entries(ALIASES) as [Key, readonly string[]][]) {
    idx[k] = header.findIndex((h) => aliases.map(norm).includes(h));
  }
  const missing = REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length) {
    throw new OrderCsvFormatError(`필수 항목이 없어요: ${missing.map((k) => ALIASES[k][0]).join(', ')}`);
  }
  const used = new Set(Object.values(idx).filter((i) => i >= 0));
  const ignoredColumns = rows[0].filter((_, i) => !used.has(i));

  const grouped = new Map<string, { first: number; rows: string[][] }>();
  rows.slice(1).forEach((r, i) => {
    const no = (r[idx.orderNo] ?? '').trim();
    const g = grouped.get(no) ?? { first: i + 2, rows: [] };
    g.rows.push(r);
    grouped.set(no, g);
  });

  const get = (r: string[], k: Key) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  const orders: CanonicalOrder[] = [];
  const errors: OrderCsvResult['errors'] = [];
  for (const [no, g] of grouped) {
    const r0 = g.rows[0];
    try {
      if (!no) throw new OrderValidationError('주문번호가 없어요');
      const cancelled = /^(y|yes|true|1|취소|예|o)$/i.test(get(r0, 'cancelled'));
      orders.push(
        sanitizeOrder({
          external_order_id: no,
          link_key: get(r0, 'linkKey') || null,
          channel: mapChannel(get(r0, 'channel')),
          ordered_at: kstIso(get(r0, 'orderedAt')),
          paid_at: get(r0, 'paidAt') ? kstIso(get(r0, 'paidAt')) : null,
          total_amount: get(r0, 'total'),
          discount_amount: get(r0, 'discount') || 0,
          refund_amount: get(r0, 'refund') || 0,
          payment_status: PAYMENT[get(r0, 'payment')] ?? 'unknown',
          order_status: cancelled ? 'cancelled' : 'completed',
          is_cancelled: cancelled,
          items: g.rows.map((r) => ({
            name: get(r, 'menu'),
            quantity: get(r, 'quantity'),
            unit_price: get(r, 'unitPrice') || null,
            line_amount: get(r, 'lineAmount') || null,
          })),
        }),
      );
    } catch (e) {
      errors.push({ row: g.first, message: `${no || '(주문번호 없음)'}: ${(e as Error).message}` });
    }
  }
  return { orders, errors, rowCount: rows.length - 1, ignoredColumns };
}
