import { preparingConnector, type OrderConnector } from './connector';

/**
 * 쿠팡이츠 주문 연동 — 배민과 분리된 별도 모듈.
 * - 쿠팡 일반 쇼핑몰(마켓플레이스) API는 음식 주문 API가 아니므로 쓰지 않는다.
 * - 수집 항목은 제공 가능한 정보(주문번호·주문시각·메뉴·수량·금액·상태)로 제한한다.
 * - 쿠팡이츠 주문조회 API 명세·계약이 없어 '연동 준비' 상태이며 외부 호출을 하지 않는다.
 */
export const COUPANGEATS_VENDORS = ['쿠팡이츠 제휴 API(확인 필요)', '기타 제공업체'] as const;

export function coupangEatsConnector(vendor: string): OrderConnector {
  return preparingConnector('coupangeats', vendor, `쿠팡이츠(${vendor || '제공업체 미정'})`, 'polling');
}
