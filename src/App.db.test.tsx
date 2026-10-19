import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATIONS } from './data/stations';
import { destinationPoint, distanceM } from './lib/geo';
import type { DbSearchRow } from './lib/db/restaurantsApi';

/**
 * 실제 DB 모드(Supabase 연결) 화면 시험.
 * DB 대신 가짜 클라이언트가 search_restaurants를 흉내 낸다 — 실제 SQL은 supabase/tests에서 PostGIS로 시험한다.
 */
const h = vi.hoisted(() => ({
  rows: [] as DbSearchRow[],
  isAdmin: false,
  hasSession: false,
  rpcError: false,
  rpc: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}));

vi.mock('./lib/supabase', async () => {
  const { fakeSupabase } = await import('./test/fakeSupabase');
  const { distanceM: dist } = await import('./lib/geo');
  const { client } = fakeSupabase({
    rpc: (fn, args) => {
      if (fn === 'is_admin') return { data: h.isAdmin, error: null };
      if (fn !== 'search_restaurants') return { data: null, error: { message: 'unknown' } };
      if (h.rpcError) return { data: null, error: { message: 'boom' } };
      const origin = { lat: args.p_lat as number, lng: args.p_lng as number };
      const data = h.rows
        .map((r) => ({ ...r, distance_m: Math.round(dist(origin, { lat: r.lat, lng: r.lng })) }))
        .filter((r) => r.distance_m <= (args.p_mode === 'delivery' ? (r.delivery_radius_m ?? -1) : (args.p_radius_m as number)))
        .filter((r) => (args.p_mode === 'takeout' ? r.takeout !== 'no' : args.p_mode === 'walk' ? r.dine_in !== 'no' : r.delivery === 'yes'))
        .filter((r) => !args.p_category || r.category === args.p_category)
        .sort((a, b) => a.distance_m - b.distance_m);
      return { data, error: null };
    },
  });
  client.auth.getSession = vi.fn(async () => ({
    data: { session: h.hasSession ? ({ user: { email: 'a@x' } } as never) : null },
  }));
  h.rpc = client.rpc;
  return { supabase: client };
});

import App from './App';
import { external } from './lib/mapLinks';

function row(name: string, d: number, bearing: number, from = STATIONS.seolleung.point, over: Partial<DbSearchRow> = {}): DbSearchRow {
  const p = destinationPoint(from, d, bearing);
  return {
    id: `db-${name}`,
    name,
    category: '한식',
    road_address: `서울특별시 강남구 시험로 ${d}`,
    lot_address: null,
    lat: p.lat,
    lng: p.lng,
    distance_m: 0,
    dine_in: 'yes',
    delivery: 'no',
    takeout: 'yes',
    delivery_radius_m: null,
    last_verified_at: null,
    updated_at: '2026-10-19T03:00:00Z',
    menus: [],
    ...over,
  };
}

type Success = (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (err: { code: number }) => void;
function mockGeolocation(impl: (ok: Success, fail: Failure) => void) {
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn(impl) }, configurable: true });
}
const gpsAt = (p: { lat: number; lng: number }, accuracy = 15) =>
  mockGeolocation((ok) => ok({ coords: { latitude: p.lat, longitude: p.lng, accuracy } }));

const names = () =>
  [...document.querySelectorAll('ol.list .name')].map((e) => e.textContent);

let openWeb: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, '');
  openWeb = vi.spyOn(external, 'openWeb').mockImplementation(() => {});
  h.rows = [
    row('오십미터 백반', 50, 0, STATIONS.seolleung.point, {
      menus: [
        { id: 'm1', name: '김치찌개', is_signature: true, price_dine_in: 9000, price_delivery: null, price_takeout: null, price_verified_at: null },
        { id: 'm2', name: '공기밥', is_signature: false, price_dine_in: null, price_delivery: null, price_takeout: null, price_verified_at: null },
      ],
    }),
    row('백오십 국수', 150, 90),
    row('이백오십 중식당', 250, 180, STATIONS.seolleung.point, { category: '중식', takeout: 'unknown' }),
    row('삼백오십 일식', 350, 270),
    row('역삼 백미터', 100, 45, STATIONS.yeoksam.point),
  ];
  h.isAdmin = false;
  h.hasSession = false;
  h.rpcError = false;
  h.rpc.mockClear();
});

afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('실제 DB 모드 — 소비자 화면', () => {
  it('가상 데이터 안내 없이 DB 매장을 서버 반경 검색으로 보여준다 (100→200→300m)', async () => {
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(screen.queryByText(/가상 데이터/)).not.toBeInTheDocument();
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_radius_m: 100, p_mode: 'walk' }));

    await user.click(screen.getByRole('radio', { name: '200m' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반', '백오십 국수']));
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반', '백오십 국수', '이백오십 중식당']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_radius_m: 300 }));
  });

  it('주문정보가 없으면 0건으로 쓰지 않고 “주문정보 없음” + 거리순', async () => {
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(screen.getByText('주문 활발도 순 정렬은 준비 중이에요 · 가까운 순으로 보여드려요')).toBeInTheDocument();
    expect(screen.getAllByText('주문정보 없음')).toHaveLength(3);
    expect(document.body.textContent).not.toContain('실시간');
    expect(screen.queryByText(/주문 0건/)).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /오십미터 백반/ });
    expect(card).toHaveTextContent('김치찌개9,000원');
    expect(screen.getByRole('button', { name: /백오십 국수/ })).toHaveTextContent('메뉴정보 준비 중');
  });

  it('음식 종류 필터는 서버로 전달된다', async () => {
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await user.click(screen.getByRole('radio', { name: '중식' }));
    await waitFor(() => expect(names()).toEqual(['이백오십 중식당']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_category: '중식' }));
  });

  it('포장은 운영 확인 매장을 미확인보다 먼저 보여준다', async () => {
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    h.rows[0] = { ...h.rows[0], takeout: 'unknown' };
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /포장/ }));
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(names()).toEqual(['백오십 국수', '오십미터 백반', '이백오십 중식당']);
    expect(screen.getByRole('button', { name: /오십미터 백반/ })).toHaveTextContent('포장 운영 미확인');
  });

  it('결과가 없으면 “검색 범위를 넓혀보세요”', async () => {
    h.rows = [row('멀리', 280, 0)];
    gpsAt(STATIONS.seolleung.point);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/검색 범위를 넓혀보세요/)).toBeInTheDocument());
  });

  it('DB 오류는 안내하고 다시 시도할 수 있다 (가상 데이터로 대신 채우지 않음)', async () => {
    h.rpcError = true;
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했어요'));
    expect(screen.queryByText('골목집 백반')).not.toBeInTheDocument();
    h.rpcError = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
  });

  it('상세화면: 가격 없는 메뉴는 “가격정보 없음”, 매장찾기는 DB 좌표로 카카오맵 도보 길찾기', async () => {
    const gps = destinationPoint(STATIONS.seolleung.point, 20, 200);
    gpsAt(gps);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /오십미터 백반/ }));
    const d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(within(d).getByRole('region', { name: '대표메뉴' })).toHaveTextContent('김치찌개9,000원');
    expect(within(d).getByRole('region', { name: '추가 메뉴' })).toHaveTextContent('공기밥가격정보 없음');
    expect(d).toHaveTextContent('주문정보 없음');
    expect(d).toHaveTextContent('현장 확인 전');
    expect(within(d).queryByText('가상 매장')).not.toBeInTheDocument();

    await user.click(within(d).getByRole('button', { name: '매장찾기' }));
    await user.click(within(screen.getByRole('dialog', { name: /지도를 골라/ })).getByRole('button', { name: /카카오맵/ }));
    const r = h.rows[0];
    expect(openWeb).toHaveBeenCalledWith(
      `https://map.kakao.com/link/by/walk/${encodeURIComponent('현재 위치')},${gps.lat.toFixed(6)},${gps.lng.toFixed(6)}/${encodeURIComponent('오십미터 백반')},${r.lat.toFixed(6)},${r.lng.toFixed(6)}`,
    );
  });

  it('GPS 정확도가 낮으면 재확인을 안내한다', async () => {
    gpsAt(STATIONS.seolleung.point, 350);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/위치 정확도가 낮아요\(±350m\)/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '위치 다시 확인' })).toBeInTheDocument();
  });
});

describe('관리자 테스트 위치 — 소비자 화면', () => {
  it('관리자면 “테스트 모드 — 역삼역 기준”으로 역 좌표에서 검색한다', async () => {
    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'yeoksam');
    mockGeolocation((_, fail) => fail({ code: 1 }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('테스트 모드 — 역삼역 기준'));
    await waitFor(() => expect(names()).toEqual(['역삼 백미터']));
    expect(h.rpc).toHaveBeenLastCalledWith(
      'search_restaurants',
      expect.objectContaining({ p_lat: STATIONS.yeoksam.point.lat, p_lng: STATIONS.yeoksam.point.lng }),
    );
    // 실제 위치처럼 보이지 않게: 현재 위치 패널·GPS 오류 패널 대신 테스트 모드 표시
    expect(screen.queryByText('현재 위치')).not.toBeInTheDocument();
  });

  it('테스트 위치를 길찾기 출발지로 쓰지 않는다 (GPS 없으면 출발지 선택 안내)', async () => {
    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'yeoksam');
    localStorage.setItem('mwomeok.mapProvider', 'kakao');
    mockGeolocation((_, fail) => fail({ code: 1 }));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['역삼 백미터']));
    await user.click(screen.getByRole('button', { name: /역삼 백미터/ }));
    const d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(d).toHaveTextContent(/역삼역\(테스트 위치\)에서 직선 100m/);
    await user.click(within(d).getByRole('button', { name: '매장찾기' }));
    expect(screen.getByRole('dialog', { name: '실제 출발 위치를 확인하지 못했어요' })).toBeInTheDocument();
    expect(openWeb).not.toHaveBeenCalled();
  });

  it('테스트 모드에서도 GPS가 있으면 출발지는 실제 GPS 좌표', async () => {
    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'yeoksam');
    localStorage.setItem('mwomeok.mapProvider', 'kakao');
    const real = { lat: 37.49, lng: 127.02 };
    gpsAt(real);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['역삼 백미터']));
    await user.click(screen.getByRole('button', { name: /역삼 백미터/ }));
    await user.click(within(screen.getByRole('dialog', { name: /상세정보/ })).getByRole('button', { name: '매장찾기' }));
    const url = openWeb.mock.calls[0][0] as string;
    expect(url).toContain(`${real.lat.toFixed(6)},${real.lng.toFixed(6)}`);
    expect(url).not.toContain(STATIONS.yeoksam.point.lat.toFixed(6));
  });

  it('관리자가 아니면 테스트 위치 요청을 무시하고 지운다', async () => {
    h.isAdmin = false;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'yeoksam');
    gpsAt(STATIONS.seolleung.point);
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(screen.queryByText(/테스트 모드/)).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('mwomeok.testLocation')).toBeNull());
  });

  it('종료하면 실제 위치로 돌아간다', async () => {
    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'yeoksam');
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['역삼 백미터']));
    await user.click(screen.getByRole('button', { name: '종료' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(distanceM(STATIONS.seolleung.point, STATIONS.yeoksam.point)).toBeGreaterThan(1000);
  });
});

describe('5단계 — 주문 활발도 표시 (정렬은 바꾸지 않음)', () => {
  const act = (over: Partial<NonNullable<DbSearchRow['activity']>> = {}): NonNullable<DbSearchRow['activity']> => ({
    scope: 'public',
    as_of: '2026-10-19T03:40:00Z',
    windows: { '30m': 12, '60m': 25 },
    by_provider: null,
    top_menu: null,
    ...over,
  });

  it('공개 집계가 있는 매장만 활발도를 보여주고 순서는 거리순 그대로', async () => {
    h.rows[1] = { ...h.rows[1], activity: act() };
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반', '백오십 국수', '이백오십 중식당']));
    expect(screen.getByRole('button', { name: /백오십 국수/ })).toHaveTextContent('📈 최근 30분 홀 주문 활발 · 오후 12:40 기준');
    expect(screen.getByRole('button', { name: /오십미터 백반/ })).toHaveTextContent('주문정보 없음');
    expect(document.body.textContent).not.toMatch(/실시간|손님 수 \d/);
    expect(screen.queryByText(/12건/)).not.toBeInTheDocument(); // 정확한 건수는 공개하지 않음

    await user.click(screen.getByRole('button', { name: /백오십 국수/ }));
    const d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(d).toHaveTextContent('최근 30분 홀 주문 활발 · 최근 60분 홀 주문 매우 활발');
    expect(d).toHaveTextContent('매장 안 손님 수나 대기시간이 아니에요');
  });

  it('배달: 인기메뉴와 배달 가격, 배민·쿠팡이츠 제공처 구분', async () => {
    h.rows = [
      row('배달 불백', 120, 0, STATIONS.seolleung.point, {
        delivery: 'yes',
        delivery_radius_m: 2000,
        menus: [
          { id: 'sig', name: '돼지불백', is_signature: true, price_dine_in: 9000, price_delivery: 10000, price_takeout: null, price_verified_at: null },
          { id: 'hot', name: '고추장불백', is_signature: false, price_dine_in: 9500, price_delivery: 10500, price_takeout: null, price_verified_at: null },
        ],
        activity: act({
          windows: { '10m': 6 },
          by_provider: { baemin: 4, coupangeats: 2 },
          top_menu: { menu_id: 'hot', name: '고추장불백', quantity: 9 },
        }),
      }),
    ];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    await waitFor(() => expect(names()).toEqual(['배달 불백']));
    const card = screen.getByRole('button', { name: /배달 불백/ });
    expect(card).toHaveTextContent('인기고추장불백10,500원');
    expect(card).toHaveTextContent('최근 10분 배달 주문 있음');
    await user.click(card);
    const d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(d).toHaveTextContent('배달 인기메뉴: 고추장불백');
    expect(d).toHaveTextContent('배민·쿠팡이츠 주문 기준');
    expect(d).not.toHaveTextContent(/배민 4|쿠팡이츠 2/);
    // 배달비·예상 배달시간 정보가 없으면 표시하지 않는다
    expect(d).not.toHaveTextContent(/배달비|약 \d+분/);
  });

  it('일반 화면은 테스트 집계를 요청하지 않고, 관리자 테스트 모드만 요청하며 “테스트 데이터”로 표시', async () => {
    gpsAt(STATIONS.seolleung.point);
    const { unmount } = render(<App />);
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.not.objectContaining({ p_include_test: true }));
    unmount();

    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'seolleung');
    h.rows[0] = { ...h.rows[0], activity: act({ scope: 'test', windows: { '10m': 30 } }) };
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('테스트 모드'));
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_include_test: true })));
    await waitFor(() => expect(screen.getByRole('button', { name: /오십미터 백반/ })).toHaveTextContent('테스트 데이터'));
  });
});
