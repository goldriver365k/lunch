import type { RoutePlace } from '../lib/mapLinks';
import { PILOT_AREAS } from './pilotAreas';

/**
 * 외부 지도 길찾기 연결 시험용 목적지.
 * 가상 매장 좌표는 길찾기에 쓰지 않으므로, 공공 장소(역)만 시험 목적지로 둔다.
 * ⚠️ 좌표는 역 중심 근사값이며 개발 환경에서 지도 서비스로 대조하지 못했다 — 실제 지도에서 확인 필요.
 */
export const ROUTE_TEST_PLACES: RoutePlace[] = PILOT_AREAS.map((a) => ({ name: `${a.name}역`, point: a.center }));
