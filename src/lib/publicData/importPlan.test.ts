// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../data/stations';
import { distanceM } from '../geo';
import { readCsvRows } from './csv';
import {
  CsvFormatError,
  diffWithExisting,
  mapBusinessStatus,
  mapCategory,
  mapHeader,
  planImport,
  type ExistingRow,
} from './importPlan';
import { importRegion } from './regions';

const sample = () => readCsvRows(new Blob([readFileSync(new URL('./__fixtures__/sample_cp949.csv', import.meta.url))]));

describe('헤더·값 매핑', () => {
  it('필수 항목이 없으면 알려준다', () => {
    expect(() => mapHeader(['사업장명', '영업상태명'])).toThrow(CsvFormatError);
    expect(() => mapHeader(['사업장명', '영업상태명'])).toThrow(/관리번호/);
  });

  it('열 이름의 공백·괄호 차이를 허용한다', () => {
    const m = mapHeader(['관리번호', '사업장명', '영업상태명', '도로명전체주소', '좌표정보(x)', '좌표정보(y)']);
    expect(m.x).toBe(4);
    expect(m.y).toBe(5);
  });

  it.each([
    ['영업/정상', '영업', 'open'],
    ['폐업', '폐업', 'closed'],
    ['휴업', '휴업', 'suspended'],
    ['취소/말소/만료/정지/중지', '', 'closed'],
    ['', '', 'unknown'],
  ])('영업상태 %s/%s → %s', (a, b, want) => {
    expect(mapBusinessStatus(a, b)).toBe(want);
  });

  it.each([
    ['한식', '한식'],
    ['중국식', '중식'],
    ['경양식', '양식'],
    ['김밥(도시락)', '분식'],
    ['외국음식전문점(인도,태국등)', '아시안'],
    ['까페', '카페·디저트'],
    ['호프/통닭', '기타'],
  ])('업태 %s → %s', (raw, want) => {
    expect(mapCategory(raw)).toBe(want);
  });
});

describe('planImport — 선릉역·역삼역 업무지구', () => {
  it('지역 매장만 고르고, 폐업·좌표오류·중복·필수값 누락을 분류한다', async () => {
    const { rows, stats } = await planImport(sample(), { region: importRegion('seolleung_yeoksam') });
    expect(stats.totalRows).toBe(12);
    expect(stats.outsideRegion).toBe(1); // 판교
    expect(stats.invalidRows).toBe(1); // 관리번호 없음
    expect(stats.duplicateInFile).toBe(1); // 같은 관리번호 두 번
    expect(stats.closedExcluded).toBe(2); // 폐업·휴업
    expect(stats.coordMissing).toBe(1);
    expect(stats.coordInvalid).toBe(2); // 범위 밖 좌표, 주소가 마포구인데 좌표는 선릉
    expect(stats.openValid).toBe(4);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((r) => r.licenseNo)).size).toBe(rows.length);
    // 원본에 없는 메뉴·가격은 만들지 않는다
    expect(rows.every((r) => !('menus' in r))).toBe(true);
  });

  it('변환한 좌표가 역 기준 거리와 맞다 (선릉역 50m·150m, 역삼역 250m)', async () => {
    const { rows } = await planImport(sample(), { region: importRegion('seolleung_yeoksam') });
    const at = (name: string) => rows.find((r) => r.name === name)!;
    const d = (name: string, s: keyof typeof STATIONS) =>
      distanceM({ lat: at(name).lat!, lng: at(name).lng! }, STATIONS[s].point);
    // 앱의 거리 계산은 구면(하버사인)이라 타원체 거리와 0.2% 정도 차이 난다
    expect(Math.abs(d('시험식당 선릉50', 'seolleung') - 50)).toBeLessThan(1.5);
    expect(Math.abs(d('시험식당 선릉150', 'seolleung') - 150)).toBeLessThan(1.5);
    expect(Math.abs(d('시험식당 역삼250', 'yeoksam') - 250)).toBeLessThan(1.5);
    expect(at('시험식당 선릉150').category).toBe('중식');
    expect(at('시험식당 좌표없음')).toMatchObject({ coordStatus: 'missing', lat: null });
    expect(at('시험식당 주소불일치')).toMatchObject({ coordStatus: 'invalid', lat: null });
  });

  it('판교 지역을 고르면 판교 매장만', async () => {
    const { rows } = await planImport(sample(), { region: importRegion('pangyo') });
    expect(rows.map((r) => r.name)).toEqual(['시험식당 판교']);
  });
});

describe('diffWithExisting — 재업로드 중복 방지', () => {
  it('관리번호가 같으면 신규로 만들지 않고, 바뀐 것만 갱신한다', async () => {
    const { rows } = await planImport(sample(), { region: importRegion('seolleung_yeoksam') });
    const first = diffWithExisting(rows, new Map());
    expect(first.toInsert).toHaveLength(7); // 영업 중 (좌표 정상 4 + 누락 1 + 오류 2)
    expect(first.skippedClosed).toHaveLength(2);

    const existing = new Map<string, ExistingRow>(
      first.toInsert.map((r) => [
        r.licenseNo,
        {
          license_no: r.licenseNo,
          name: r.name,
          category: r.category,
          business_status: r.businessStatus,
          coord_status: r.coordStatus,
          lat: r.lat,
          lng: r.lng,
          road_address: r.roadAddress,
          lot_address: r.lotAddress,
          admin_edited: false,
        },
      ]),
    );
    const second = diffWithExisting(rows, existing);
    expect(second.toInsert).toHaveLength(0);
    expect(second.toUpdate).toHaveLength(0);
    expect(second.unchanged).toHaveLength(7);

    // 관리자가 이름을 고친 매장은 이름 차이로 갱신하지 않는다
    const lic = first.toInsert[0].licenseNo;
    existing.set(lic, { ...existing.get(lic)!, name: '관리자 정정', admin_edited: true });
    expect(diffWithExisting(rows, existing).toUpdate).toHaveLength(0);
  });
});
