import type { RoutePlace } from '../lib/mapLinks';
import { STATIONS } from './stations';

/**
 * 외부 지도 길찾기 연결 시험용 목적지.
 * 가상 매장 좌표는 길찾기에 쓰지 않으므로, 공공 장소(역)만 시험 목적지로 둔다.
 */
export const ROUTE_TEST_PLACES: RoutePlace[] = [STATIONS.seolleung, STATIONS.pangyo, STATIONS.yeouido].map((s) => ({
  name: s.name,
  point: s.point,
}));
