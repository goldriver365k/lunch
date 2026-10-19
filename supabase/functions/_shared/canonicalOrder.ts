/**
 * 주문 수집 공통 형식 (홀 POS · 배달의민족 · 쿠팡이츠 · 포장 · CSV 모두 이 형식으로 바꿔 DB의 ingest_orders에 넘긴다).
 * Edge Function(Deno)과 관리자 화면(브라우저)이 같은 코드를 쓴다 — Web 표준 API만 사용.
 *
 * 개인정보(이름·전화번호·주소·결제수단)는 이 형식에 없다. 들어와도 sanitize 단계에서 버린다.
 */

export type OrderChannel = 'HALL' | 'DELIVERY' | 'PICKUP' | 'UNKNOWN';
export type OrderProvider = 'pos' | 'baemin' | 'coupangeats' | 'csv';
export type OrderStatus = 'accepted' | 'completed' | 'cancelled' | 'pending' | 'unknown';
export type PaymentStatus = 'paid' | 'unpaid' | 'refunded' | 'partially_refunded' | 'unknown';

export interface CanonicalOrderItem {
  name: string;
  quantity: number;
  unit_price?: number | null;
  line_amount?: number | null;
}

export interface CanonicalOrder {
  external_order_id: string;
  /** POS와 배달앱에 같은 주문이 함께 기록될 때의 연결번호 — 있으면 하나로 통합한다 */
  link_key?: string | null;
  channel: OrderChannel;
  ordered_at: string;
  paid_at?: string | null;
  total_amount: number;
  discount_amount?: number;
  refund_amount?: number;
  order_status?: OrderStatus;
  payment_status?: PaymentStatus;
  is_cancelled?: boolean;
  items: CanonicalOrderItem[];
}

const CHANNELS: OrderChannel[] = ['HALL', 'DELIVERY', 'PICKUP', 'UNKNOWN'];
const ORDER_STATUSES: OrderStatus[] = ['accepted', 'completed', 'cancelled', 'pending', 'unknown'];
const PAYMENT_STATUSES: PaymentStatus[] = ['paid', 'unpaid', 'refunded', 'partially_refunded', 'unknown'];

export class OrderValidationError extends Error {}

function int(v: unknown, field: string, { min = 0, optional = false } = {}): number | null {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new OrderValidationError(`${field} 값이 없어요`);
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isInteger(n) || n < min) throw new OrderValidationError(`${field} 값이 올바르지 않아요: ${String(v)}`);
  return n;
}

function iso(v: unknown, field: string, optional = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw new OrderValidationError(`${field} 값이 없어요`);
  }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new OrderValidationError(`${field} 시각을 읽을 수 없어요: ${String(v)}`);
  return d.toISOString();
}

/**
 * 외부에서 들어온 주문을 공통 형식으로 검사·정리한다.
 * 허용한 필드만 남기므로 고객 이름·전화번호·주소·카드번호 같은 값은 여기서 사라진다.
 */
export function sanitizeOrder(raw: Record<string, unknown>): CanonicalOrder {
  const id = String(raw.external_order_id ?? '').trim();
  if (!id) throw new OrderValidationError('주문번호가 없어요');
  const channel = String(raw.channel ?? 'UNKNOWN').toUpperCase() as OrderChannel;
  if (!CHANNELS.includes(channel)) throw new OrderValidationError(`주문 채널을 알 수 없어요: ${String(raw.channel)}`);
  const items = Array.isArray(raw.items) ? raw.items : [];
  const orderStatus = String(raw.order_status ?? 'unknown') as OrderStatus;
  const paymentStatus = String(raw.payment_status ?? 'unknown') as PaymentStatus;
  const cancelled = raw.is_cancelled === true || raw.is_cancelled === 'true' || orderStatus === 'cancelled';
  const link = raw.link_key === undefined || raw.link_key === null ? '' : String(raw.link_key).trim();
  return {
    external_order_id: id,
    link_key: link || null,
    channel,
    ordered_at: iso(raw.ordered_at, '주문시각')!,
    paid_at: iso(raw.paid_at, '결제시각', true),
    total_amount: int(raw.total_amount, '주문 총금액')!,
    discount_amount: int(raw.discount_amount, '할인금액', { optional: true }) ?? 0,
    refund_amount: int(raw.refund_amount, '환불금액', { optional: true }) ?? 0,
    order_status: ORDER_STATUSES.includes(orderStatus) ? orderStatus : 'unknown',
    payment_status: PAYMENT_STATUSES.includes(paymentStatus) ? paymentStatus : 'unknown',
    is_cancelled: cancelled,
    items: items.map((it, i) => {
      const r = it as Record<string, unknown>;
      const name = String(r.name ?? '').trim();
      if (!name) throw new OrderValidationError(`${i + 1}번째 메뉴 이름이 없어요`);
      return {
        name,
        quantity: int(r.quantity, '수량', { min: 1 })!,
        unit_price: int(r.unit_price, '단가', { optional: true }),
        line_amount: int(r.line_amount, '판매금액', { optional: true }),
      };
    }),
  };
}
