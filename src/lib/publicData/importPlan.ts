import type { Category, GeoPoint } from '../../types';
import { distanceM } from '../geo';
import { tmToWgs84, type SourceCrs } from './coords';
import type { ImportRegion } from './regions';

/**
 * 공공데이터(전국일반음식점표준데이터 / 지방행정 인허가 일반음식점) CSV를 읽어
 * 선택한 지역의 매장만 골라 DB에 올릴 행을 만든다.
 * 원본에 없는 메뉴·가격은 만들지 않는다.
 */

export type BusinessStatus = 'open' | 'suspended' | 'closed' | 'unknown';
export type CoordStatus = 'valid' | 'missing' | 'invalid';

export interface PlannedRow {
  licenseNo: string;
  sourceRef: string | null;
  name: string;
  category: Category;
  categoryRaw: string | null;
  roadAddress: string | null;
  lotAddress: string | null;
  lat: number | null;
  lng: number | null;
  coordStatus: CoordStatus;
  businessStatus: BusinessStatus;
  businessStatusRaw: string | null;
  /** 가까운 지역 중심점까지 거리 (m) — 좌표가 있을 때만 */
  centerDistanceM: number | null;
}

export interface PlanStats {
  totalRows: number;
  /** 지역 밖이라 건너뜀 */
  outsideRegion: number;
  /** 관리번호·사업장명 등 필수값 누락 */
  invalidRows: number;
  /** 같은 파일 안 중복 (같은 관리번호) */
  duplicateInFile: number;
  /** 지역 안 매장 중 폐업·휴업·영업정지 등 (신규 등록 제외, 기존 매장은 상태만 갱신) */
  closedExcluded: number;
  coordMissing: number;
  coordInvalid: number;
  /** 지역 안 영업 중 + 좌표 정상 */
  openValid: number;
}

export interface ImportPlan {
  rows: PlannedRow[];
  stats: PlanStats;
}

const FIELD_ALIASES = {
  licenseNo: ['관리번호', '인허가관리번호', '인허가번호'],
  govCode: ['개방자치단체코드'],
  name: ['사업장명', '업소명'],
  status: ['영업상태명'],
  detailStatus: ['상세영업상태명'],
  lotAddress: ['소재지전체주소', '지번주소', '소재지주소', '소재지지번주소'],
  roadAddress: ['도로명전체주소', '도로명주소', '소재지도로명주소'],
  category: ['업태구분명', '위생업태명'],
  x: ['좌표정보xepsg5174', '좌표정보x', 'x좌표', '좌표정보xepsg2097'],
  y: ['좌표정보yepsg5174', '좌표정보y', 'y좌표', '좌표정보yepsg2097'],
} as const;

export type FieldKey = keyof typeof FIELD_ALIASES;
export type HeaderMap = Partial<Record<FieldKey, number>>;

const REQUIRED: FieldKey[] = ['licenseNo', 'name', 'status', 'x', 'y'];

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').replace(/[\s()_[\]]/g, '').toLowerCase();
}

export class CsvFormatError extends Error {}

/** 헤더에서 필요한 열을 찾는다. 필수 열이 없으면 CsvFormatError */
export function mapHeader(header: string[]): HeaderMap {
  const normalized = header.map(normalizeHeader);
  const map: HeaderMap = {};
  for (const [key, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, readonly string[]][]) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[key] = idx;
  }
  const missing = REQUIRED.filter((k) => map[k] === undefined);
  if (map.lotAddress === undefined && map.roadAddress === undefined) missing.push('lotAddress');
  if (missing.length > 0) {
    const label: Record<string, string> = {
      licenseNo: '관리번호',
      name: '사업장명',
      status: '영업상태명',
      x: '좌표정보x(epsg5174)',
      y: '좌표정보y(epsg5174)',
      lotAddress: '소재지전체주소 또는 도로명전체주소',
    };
    throw new CsvFormatError(`필수 항목이 없어요: ${missing.map((k) => label[k] ?? k).join(', ')}`);
  }
  return map;
}

/** 영업상태명·상세영업상태명 → 영업상태 */
export function mapBusinessStatus(status: string, detail = ''): BusinessStatus {
  const s = `${status} ${detail}`;
  if (/폐업|취소|말소|만료|직권/.test(s)) return 'closed';
  if (/휴업|정지|중지|중단/.test(s)) return 'suspended';
  if (/영업|정상/.test(s)) return 'open';
  return 'unknown';
}

/** 업태구분명 → 앱 음식 종류 */
export function mapCategory(raw: string): Category {
  const s = raw.replace(/\s/g, '');
  if (!s) return '기타';
  if (/중국/.test(s)) return '중식';
  if (/일식|초밥|돈까스|라멘/.test(s)) return '일식';
  if (/경양식|양식|이탈리|피자/.test(s)) return '양식';
  if (/분식|김밥|도시락|떡볶이/.test(s)) return '분식';
  if (/외국음식|인도|태국|베트남|아시아/.test(s)) return '아시안';
  if (/패스트푸드|통닭\(치킨\)|^치킨|햄버거/.test(s)) return '패스트푸드';
  if (/까페|카페|커피|찻집|제과|디저트/.test(s)) return '카페·디저트';
  if (/한식|식육|숯불|냉면|탕류|복어|횟집|회집|국밥|백반/.test(s)) return '한식';
  return '기타';
}

function cell(row: string[], idx: number | undefined): string {
  return idx === undefined ? '' : (row[idx] ?? '').trim();
}

function parseNum(s: string): number {
  return s === '' ? NaN : Number(s.replace(/,/g, ''));
}

function nearestCenter(point: GeoPoint, region: ImportRegion): number {
  return Math.min(...region.centers.map((c) => distanceM(point, c.point)));
}

export interface PlanOptions {
  region: ImportRegion;
  crs?: SourceCrs;
  onProgress?: (rowsRead: number) => void;
}

/**
 * CSV 행(첫 행은 헤더)을 차례로 받아 지역 매장만 골라낸다.
 * 지역 밖 행은 바로 버려서 전국 파일도 메모리에 다 올리지 않는다.
 */
export async function planImport(rows: AsyncIterable<string[]> | Iterable<string[]>, opts: PlanOptions): Promise<ImportPlan> {
  const { region, crs = 'EPSG:5174' } = opts;
  const stats: PlanStats = {
    totalRows: 0,
    outsideRegion: 0,
    invalidRows: 0,
    duplicateInFile: 0,
    closedExcluded: 0,
    coordMissing: 0,
    coordInvalid: 0,
    openValid: 0,
  };
  const byLicense = new Map<string, PlannedRow>();
  let header: HeaderMap | null = null;

  for await (const row of rows) {
    if (!header) {
      header = mapHeader(row);
      continue;
    }
    stats.totalRows++;
    if (opts.onProgress && stats.totalRows % 5000 === 0) opts.onProgress(stats.totalRows);

    const roadAddress = cell(row, header.roadAddress) || null;
    const lotAddress = cell(row, header.lotAddress) || null;
    const address = `${roadAddress ?? ''} ${lotAddress ?? ''}`;
    const addressInRegion =
      region.addressKeywords.some((k) => address.includes(k)) && region.dongKeywords.some((k) => address.includes(k));
    const addressHasGu = region.addressKeywords.some((k) => address.includes(k));

    const x = parseNum(cell(row, header.x));
    const y = parseNum(cell(row, header.y));
    const hasXY = Number.isFinite(x) && Number.isFinite(y);
    const point = hasXY ? tmToWgs84(x, y, crs) : null;
    const d = point ? nearestCenter(point, region) : null;

    let coordStatus: CoordStatus;
    if (point && d !== null && d <= region.radiusM) {
      // 좌표는 지역 안인데 주소가 다른 구라면 좌표를 믿지 않는다
      coordStatus = address.trim() && !addressHasGu ? 'invalid' : 'valid';
    } else if (addressInRegion) {
      if (!hasXY) coordStatus = 'missing';
      else if (!point || (d !== null && d > region.maxPlausibleM)) coordStatus = 'invalid';
      else {
        stats.outsideRegion++; // 같은 동이지만 업무지구 반경 밖
        continue;
      }
    } else {
      stats.outsideRegion++;
      continue;
    }

    const licenseNo = cell(row, header.licenseNo);
    const name = cell(row, header.name);
    if (!licenseNo || !name) {
      stats.invalidRows++;
      continue;
    }
    if (byLicense.has(licenseNo)) stats.duplicateInFile++;

    const statusRaw = [cell(row, header.status), cell(row, header.detailStatus)].filter(Boolean).join(' / ');
    const categoryRaw = cell(row, header.category) || null;
    const govCode = cell(row, header.govCode);
    byLicense.set(licenseNo, {
      licenseNo,
      sourceRef: govCode ? `${govCode}/${licenseNo}` : licenseNo,
      name,
      category: mapCategory(categoryRaw ?? ''),
      categoryRaw,
      roadAddress,
      lotAddress,
      lat: coordStatus === 'valid' && point ? point.lat : null,
      lng: coordStatus === 'valid' && point ? point.lng : null,
      coordStatus,
      businessStatus: mapBusinessStatus(cell(row, header.status), cell(row, header.detailStatus)),
      businessStatusRaw: statusRaw || null,
      centerDistanceM: d === null ? null : Math.round(d),
    });
  }
  if (!header) throw new CsvFormatError('빈 파일이에요.');

  const planned = [...byLicense.values()];
  for (const r of planned) {
    if (r.businessStatus !== 'open') stats.closedExcluded++;
    else if (r.coordStatus === 'missing') stats.coordMissing++;
    else if (r.coordStatus === 'invalid') stats.coordInvalid++;
    else stats.openValid++;
  }
  return { rows: planned, stats };
}

/** DB에 이미 있는 매장 (관리번호 기준 비교용) */
export interface ExistingRow {
  license_no: string;
  name: string;
  category: string;
  business_status: BusinessStatus;
  coord_status: CoordStatus;
  lat: number | null;
  lng: number | null;
  road_address: string | null;
  lot_address: string | null;
  admin_edited: boolean;
}

export interface ImportDiff {
  /** 새로 등록될 매장 (영업 중만) */
  toInsert: PlannedRow[];
  /** 바뀐 내용이 있어 갱신될 매장 */
  toUpdate: PlannedRow[];
  /** 이미 같은 내용으로 있는 매장 (중복 제외) */
  unchanged: PlannedRow[];
  /** DB에 없고 폐업·휴업이라 등록하지 않는 매장 */
  skippedClosed: PlannedRow[];
}

/** 관리번호로 기존 매장과 비교 — DB의 admin_commit_import와 같은 규칙 */
export function diffWithExisting(rows: PlannedRow[], existing: Map<string, ExistingRow>): ImportDiff {
  const diff: ImportDiff = { toInsert: [], toUpdate: [], unchanged: [], skippedClosed: [] };
  for (const r of rows) {
    const e = existing.get(r.licenseNo);
    if (!e) {
      (r.businessStatus === 'open' ? diff.toInsert : diff.skippedClosed).push(r);
      continue;
    }
    const changed =
      e.business_status !== r.businessStatus ||
      (!e.admin_edited &&
        (e.name !== r.name ||
          e.category !== r.category ||
          e.coord_status !== r.coordStatus ||
          e.lat !== r.lat ||
          e.lng !== r.lng ||
          e.road_address !== r.roadAddress ||
          e.lot_address !== r.lotAddress));
    (changed ? diff.toUpdate : diff.unchanged).push(r);
  }
  return diff;
}
