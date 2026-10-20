import { STATIONS, type Station } from '../../data/stations';

export type RegionId = 'seolleung_yeoksam' | 'pangyo' | 'yeouido';

export interface ImportRegion {
  id: RegionId;
  name: string;
  /** 1차 등록 지역 여부 */
  primary: boolean;
  /** 업무지구 중심점 — 이 중 하나에서 radiusM 안이면 지역 안 */
  centers: Station[];
  radiusM: number;
  /** 주소 빠른 거르기용 — 시·구 이름 */
  addressKeywords: string[];
  /** 주소에 이 동 이름이 있으면 좌표가 없어도 지역 매장으로 보고 '좌표 누락'으로 분류 */
  dongKeywords: string[];
  /** 지역 주소인데 중심에서 이보다 멀면 좌표 오류로 본다 */
  maxPlausibleM: number;
}

/** DB regions 테이블 id와 같다 */
export const IMPORT_REGIONS: ImportRegion[] = [
  {
    id: 'seolleung_yeoksam',
    name: '선릉역·역삼역 업무지구',
    primary: true,
    centers: [STATIONS.seolleung, STATIONS.yeoksam],
    radiusM: 800,
    addressKeywords: ['강남구'],
    dongKeywords: ['역삼동', '대치동', '삼성동'],
    maxPlausibleM: 4000,
  },
  {
    id: 'pangyo',
    name: '판교역·제1판교테크노밸리',
    primary: false,
    // 제1판교테크노밸리는 판교역 북쪽 약 0.8km — 지역 거르기용 대략 중심점 (테스트 위치로는 쓰지 않음)
    centers: [STATIONS.pangyo, { id: 'pangyo', name: '제1판교테크노밸리', point: { lat: 37.4019, lng: 127.1086 } }],
    radiusM: 900,
    addressKeywords: ['분당구'],
    dongKeywords: ['삼평동', '백현동'],
    maxPlausibleM: 5000,
  },
  {
    id: 'yeouido',
    name: '여의도역 업무지구',
    primary: false,
    centers: [STATIONS.yeouido],
    radiusM: 900,
    addressKeywords: ['영등포구'],
    dongKeywords: ['여의도동'],
    maxPlausibleM: 4000,
  },
];

export function importRegion(id: RegionId): ImportRegion {
  return IMPORT_REGIONS.find((r) => r.id === id)!;
}
