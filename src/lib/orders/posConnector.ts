import { sanitizeOrder, type CanonicalOrder } from '../../../supabase/functions/_shared/canonicalOrder.ts';
import { preparingConnector, type OrderConnector } from './connector';

/**
 * 홀 POS 연동.
 * POS 업체마다 API 규격이 달라 업체별 어댑터(PosVendorAdapter)를 등록해 쓴다.
 * 공식 POS API가 확보된 업체부터 adapter를 추가한다. 지금 등록된 실제 업체 어댑터는 없다.
 * POS 연결이 없는 매장은 관리자 '주문 CSV 업로드'로 넣는다.
 */
export interface PosVendorAdapter {
  vendor: string;
  /** 업체 원본 주문 1건 → 공통 형식. 홀/포장 구분, 결제·취소·환불, 메뉴별 수량을 채운다 */
  normalize(raw: unknown): CanonicalOrder;
}

const POS_ADAPTERS = new Map<string, PosVendorAdapter>();

export function registerPosAdapter(adapter: PosVendorAdapter): void {
  POS_ADAPTERS.set(adapter.vendor, adapter);
}

export function posAdapter(vendor: string): PosVendorAdapter | undefined {
  return POS_ADAPTERS.get(vendor);
}

/** 공통 형식을 그대로 보내 주는 POS(또는 중계 서버)용 — 웹훅 'canonical' 형식과 같다 */
registerPosAdapter({
  vendor: 'canonical',
  normalize: (raw) => sanitizeOrder(raw as Record<string, unknown>),
});

export function posConnector(vendor: string): OrderConnector {
  // 실제 POS 업체 어댑터는 계약 후 추가 — 그 전까지는 '연동 준비'
  return preparingConnector('pos', vendor, `POS(${vendor || '업체 미정'})`, 'webhook');
}
