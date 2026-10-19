import type { PilotArea, PilotAreaId } from '../types';
import { STATIONS } from './stations';

/** GPS를 쓸 수 없을 때 고를 수 있는 시범 위치 (역 중심 좌표) */
export const PILOT_AREAS: PilotArea[] = [
  { id: 'seolleung', name: '선릉', center: STATIONS.seolleung.point },
  { id: 'yeoksam', name: '역삼', center: STATIONS.yeoksam.point },
  { id: 'pangyo', name: '판교', center: STATIONS.pangyo.point },
  { id: 'yeouido', name: '여의도', center: STATIONS.yeouido.point },
];

export function pilotArea(id: PilotAreaId): PilotArea {
  return PILOT_AREAS.find((a) => a.id === id)!;
}
