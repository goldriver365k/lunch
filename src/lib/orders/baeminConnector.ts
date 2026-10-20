import { preparingConnector, type OrderConnector } from './connector';

/**
 * 배달의민족 주문 연동.
 * - 매장 동의 + 데이터 제공업체(예: 하이픈 등 주문조회 API 업체)의 사용 허락을 받은 주문만 수집한다.
 * - 수집 항목: 배민 주문번호, 주문시각, 주문 메뉴·수량, 주문금액, 배달·포장 구분, 주문상태, 취소 여부.
 * - 배민 공식/제공업체 API 명세와 계약이 아직 없으므로 실제 연결은 '연동 준비'이며 외부 호출을 하지 않는다.
 *   기능 시험은 mockConnectors.ts의 가상 연결로 한다.
 */
export const BAEMIN_VENDORS = ['하이픈', '기타 제공업체'] as const;

export function baeminConnector(vendor: string): OrderConnector {
  return preparingConnector('baemin', vendor, `배달의민족(${vendor || '제공업체 미정'})`, 'polling');
}
