import type { GeoPoint } from '../types';

export type StationId = 'seolleung' | 'yeoksam' | 'pangyo' | 'yeouido';

export interface Station {
  id: StationId;
  name: string;
  point: GeoPoint;
}

/**
 * 역사 중심 좌표 (WGS84).
 * 위키백과·위키데이터·위키미디어 공용의 역 좌표를 서로 대조해 20m 안에서 일치하는 값을 썼다.
 * - 선릉역: 위키백과 37°30′16.2″N 127°02′56.4″E
 * - 역삼역: 위키미디어 공용 37°30′02.83″N 127°02′12.79″E (위키데이터 37.5008, 127.0369)
 * - 판교역: 위키백과 37.394762, 127.111137 (위키데이터 37°23′41.14″N 127°6′40.09″E)
 * - 여의도역: 위키백과·위키데이터 37°31′18″N 126°55′27″E
 */
export const STATIONS: Record<StationId, Station> = {
  seolleung: { id: 'seolleung', name: '선릉역', point: { lat: 37.5045, lng: 127.049 } },
  yeoksam: { id: 'yeoksam', name: '역삼역', point: { lat: 37.500786, lng: 127.036886 } },
  pangyo: { id: 'pangyo', name: '판교역', point: { lat: 37.394762, lng: 127.111137 } },
  yeouido: { id: 'yeouido', name: '여의도역', point: { lat: 37.521667, lng: 126.924167 } },
};
