import type { PilotArea, PilotAreaId } from '../types';

/** GPS를 쓸 수 없을 때 고를 수 있는 시범 위치 (역 중심 좌표) */
export const PILOT_AREAS: PilotArea[] = [
  { id: 'seolleung', name: '선릉', center: { lat: 37.50449, lng: 127.04893 } },
  { id: 'pangyo', name: '판교', center: { lat: 37.39482, lng: 127.11119 } },
  { id: 'yeouido', name: '여의도', center: { lat: 37.5215, lng: 126.92427 } },
];

export function pilotArea(id: PilotAreaId): PilotArea {
  return PILOT_AREAS.find((a) => a.id === id)!;
}
