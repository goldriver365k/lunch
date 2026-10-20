import proj4 from 'proj4';
import type { GeoPoint } from '../../types';

/**
 * 공공데이터 좌표(EPSG:5174, Bessel 중부원점 TM) → WGS84 변환.
 *
 * towgs84 값은 국내에서 널리 쓰는 7변수 값이며, PROJ/EPSG 공식 변환
 * ('Korean 1985 to WGS 84 (1)', Molodensky-Badekas)과 서울·판교·여의도 36개 지점에서
 * 0.05m 안으로 일치함을 시험(epsg5174.fixture.json)으로 확인했다.
 *
 * EPSG:2097은 중부원점 경도 보정(10.405″)이 없는 옛 좌표계다. 원본 파일의 좌표가 약 250m 동서로
 * 어긋나 있으면 관리자 화면에서 이 좌표계로 바꿔 확인할 수 있게 둔다.
 */
export type SourceCrs = 'EPSG:5174' | 'EPSG:2097';

const TOWGS84 = '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const DEFS: Record<SourceCrs, string> = {
  'EPSG:5174': `+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs ${TOWGS84}`,
  'EPSG:2097': `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs ${TOWGS84}`,
};

const converters = new Map<SourceCrs, proj4.Converter>();

function converter(crs: SourceCrs): proj4.Converter {
  let c = converters.get(crs);
  if (!c) {
    c = proj4(DEFS[crs], 'WGS84');
    converters.set(crs, c);
  }
  return c;
}

/**
 * 중부원점 TM 좌표로 그럴듯한 범위 — 대한민국 전체.
 * 공공데이터는 지역과 관계없이 중부원점 좌표를 쓰므로 남부(김해 y≈196,000, 부산 y≈189,000)·제주(y<0)·독도(x≈632,000)도 들어와야 한다.
 */
function plausibleTm(x: number, y: number): boolean {
  return x > -50000 && x < 700000 && y > -100000 && y < 800000;
}

/** 원본 x·y를 WGS84로 바꾼다. 숫자가 아니거나 범위를 벗어나면 null */
export function tmToWgs84(x: number, y: number, crs: SourceCrs = 'EPSG:5174'): GeoPoint | null {
  // 0,0은 공공데이터에서 '좌표 없음'으로 자주 쓰인다
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0) || !plausibleTm(x, y)) return null;
  const [lng, lat] = converter(crs).forward([x, y]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
}
