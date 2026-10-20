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
  refreshSec: 60,
  notice: null as string | null,
  rpc: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}));

vi.mock('./lib/supabase', async () => {
  const { fakeSupabase } = await import('./test/fakeSupabase');
  const { distanceM: dist } = await import('./lib/geo');
  const { client } = fakeSupabase({
    rpc: (fn, args) => {
      if (fn === 'is_admin') return { data: h.isAdmin, error: null };
      if (fn === 'public_app_settings') return { data: { refresh_interval_seconds: h.refreshSec, notice: h.notice, live_orders_public: true }, error: null };
      if (fn !== 'search_restaurants') return { data: null, error: { message: 'unknown' } };
      if (h.rpcError) return { data: null, error: { message: 'boom' } };
      const origin = { lat: args.p_lat as number, lng: args.p_lng as number };
      const data = h.rows
        .map((r) => ({ ...r, distance_m: Math.round(dist(origin, { lat: r.lat, lng: r.lng })) }))
        .filter((r) => r.distance_m <= (args.p_mode === 'delivery' ? (r.delivery_radius_m ?? -1) : (args.p_radius_m as number)))
        .filter((r) => (args.p_mode === 'takeout' ? r.takeout !== 'no' : args.p_mode === 'walk' ? r.dine_in !== 'no' : r.delivery === 'yes'))
        .filter((r) => !args.p_category || r.category === args.p_category)
        // 서버와 같은 정렬: [최신 공개 데이터] 1차 창 ↓ → 2차 창 ↓ → (포장) 운영 확인 → 거리 ↑, 그다음 [나머지] 같은 방식
        .map((r) => ({ ...r, rank_group: r.activity && ['active', 'none_recent'].includes(r.activity.status) ? 0 : 1 }))
        .sort((a, b) =>
          args.p_sort === 'popular'
            ? a.rank_group - b.rank_group ||
              (b.rank_group === 0 ? (b.activity?.rank_primary ?? 0) - (a.activity?.rank_primary ?? 0) : 0) ||
              (b.rank_group === 0 ? (b.activity?.rank_secondary ?? 0) - (a.activity?.rank_secondary ?? 0) : 0) ||
              (args.p_mode === 'takeout' ? Number(a.takeout !== 'yes') - Number(b.takeout !== 'yes') : 0) ||
              a.distance_m - b.distance_m
            : a.distance_m - b.distance_m,
        );
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
  h.notice = null;
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
    expect(screen.getByText('실시간 주문정보 준비 중 · 거리순으로 보여드려요')).toBeInTheDocument();
    expect(screen.getAllByText('주문정보 없음')).toHaveLength(3);
    expect(document.querySelector('ol.list')!.textContent).not.toContain('실시간');
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

describe('6단계 — 지금 주문 활발한 순 (서버 순위)', () => {
  const act = (over: Partial<NonNullable<DbSearchRow['activity']>> = {}): NonNullable<DbSearchRow['activity']> => ({
    scope: 'public',
    status: 'active',
    as_of: '2026-10-19T03:40:00Z',
    primary_minutes: 10,
    secondary_minutes: 30,
    rank_primary: 0,
    rank_secondary: 12,
    windows: { '30m': 12, '60m': 25 },
    providers: [],
    top_menus: [],
    ...over,
  });

  it('기본은 지금 주문 활발한 순: 주문 데이터 매장이 먼저, 나머지는 따로 거리순 · 거리순으로 바꿀 수 있음', async () => {
    h.rows[1] = { ...h.rows[1], activity: act({ rank_primary: 6, windows: { '10m': 6, '30m': 12 } }) }; // 150m
    h.rows[2] = { ...h.rows[2], activity: act({ rank_primary: 9, windows: { '10m': 9 } }) }; // 250m
    h.rows[3] = { ...h.rows[3], activity: act({ status: 'delayed', rank_primary: 0, rank_secondary: 0, windows: {} }) }; // 350m
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('radio', { name: '지금 주문 활발한 순' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await waitFor(() => expect(names()).toEqual(['이백오십 중식당', '백오십 국수', '오십미터 백반']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_sort: 'popular', p_radius_m: 300 }));
    expect(screen.getByText('주문정보가 없거나 갱신이 늦은 매장 · 거리순')).toBeInTheDocument();
    expect(screen.queryByText('실시간 주문정보 준비 중 · 거리순으로 보여드려요')).not.toBeInTheDocument();
    const top = screen.getByRole('button', { name: /이백오십 중식당/ });
    expect(top).toHaveTextContent('📈 최근 10분 홀 주문 있음 · 오후 12:40 기준');
    expect(screen.getByRole('button', { name: /오십미터 백반/ })).toHaveTextContent('주문정보 없음');
    expect(screen.queryByText(/9건|12건/)).not.toBeInTheDocument(); // 정확한 건수는 공개하지 않음

    await user.click(screen.getByRole('radio', { name: '거리순' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반', '백오십 국수', '이백오십 중식당']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_sort: 'distance' }));
    expect(screen.queryByText('주문정보가 없거나 갱신이 늦은 매장 · 거리순')).not.toBeInTheDocument();
  });

  it('상태 구분: 최근 주문 확인(소량) · 최근 주문 없음 · 데이터 갱신 지연 · 주문정보 없음', async () => {
    h.rows = [
      row('소량', 30, 0, STATIONS.seolleung.point, { activity: act({ rank_secondary: 0, windows: {} }) }),
      row('없음', 40, 0, STATIONS.seolleung.point, { activity: act({ status: 'none_recent', rank_secondary: 0, windows: {} }) }),
      row('지연', 50, 0, STATIONS.seolleung.point, { activity: act({ status: 'delayed', rank_secondary: 0, windows: {} }) }),
      row('미연동', 60, 0),
    ];
    gpsAt(STATIONS.seolleung.point);
    render(<App />);
    await waitFor(() => expect(names()).toEqual(['소량', '없음', '지연', '미연동']));
    expect(screen.getByRole('button', { name: /소량/ })).toHaveTextContent('최근 홀 주문 확인 · 오후 12:40 기준');
    expect(screen.getByRole('button', { name: /^2/ })).toHaveTextContent('최근 30분 홀 주문 없음');
    expect(screen.getByRole('button', { name: /지연/ })).toHaveTextContent('데이터 갱신 지연 · 오후 12:40 기준');
    expect(screen.getByRole('button', { name: /지연/ })).not.toHaveTextContent('📈');
    expect(screen.getByRole('button', { name: /미연동/ })).toHaveTextContent('주문정보 없음');
  });

  it('상세: 채널별 인기메뉴 순위와 가격, 홀·배달 가격 따로', async () => {
    const menus = [
      { id: 'sig', name: '돼지불백', is_signature: true, price_dine_in: 9000, price_delivery: 10000, price_takeout: 8500, price_verified_at: null },
      { id: 'hot', name: '고추장불백', is_signature: false, price_dine_in: 9500, price_delivery: 10500, price_takeout: 9000, price_verified_at: null },
    ];
    h.rows = [
      row('불백집', 40, 0, STATIONS.seolleung.point, {
        menus,
        activity: act({ top_menus: [{ menu_id: 'hot', name: '고추장불백' }, { menu_id: 'sig', name: '돼지불백' }] }),
      }),
      row('기록부족', 60, 0, STATIONS.seolleung.point, { menus, activity: act({ top_menus: [] }) }),
    ];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: /불백집/ }));
    const d = screen.getByRole('dialog', { name: /불백집 상세정보/ });
    const pop = within(d).getByRole('region', { name: '인기메뉴' });
    expect(pop).toHaveTextContent('오늘 홀 인기메뉴');
    expect(pop).toHaveTextContent('1고추장불백9,500원2돼지불백9,000원');
    expect(within(d).getByRole('region', { name: '대표메뉴' })).toHaveTextContent('돼지불백배달 10,000원 · 포장 8,500원9,000원');
    await user.click(within(d).getByRole('button', { name: '목록으로 돌아가기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /기록부족/ }));
    expect(within(screen.getByRole('dialog', { name: /기록부족 상세정보/ })).queryByRole('region', { name: '인기메뉴' })).not.toBeInTheDocument();
  });

  it('배달: 배달 가능 표시, 배달 인기메뉴·가격, 제공처 이름만, 확인된 배달비·시간과 승인된 링크만', async () => {
    const menus = [
      { id: 'sig', name: '돼지불백', is_signature: true, price_dine_in: 9000, price_delivery: 10000, price_takeout: null, price_verified_at: null },
      { id: 'hot', name: '고추장불백', is_signature: false, price_dine_in: 9500, price_delivery: 10500, price_takeout: null, price_verified_at: null },
    ];
    h.rows = [
      row('배달 불백', 120, 0, STATIONS.seolleung.point, {
        delivery: 'yes',
        delivery_radius_m: 2000,
        menus,
        delivery_fee_krw: 2500,
        delivery_eta_minutes: 30,
        baemin_order_url: 'https://baemin.example/store/1',
        coupangeats_order_url: null,
        activity: act({ windows: { '10m': 6 }, providers: ['baemin', 'coupangeats'], top_menus: [{ menu_id: 'hot', name: '고추장불백' }] }),
      }),
      row('확인안됨', 200, 0, STATIONS.seolleung.point, { delivery: 'yes', delivery_radius_m: 2000, menus }),
    ];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    await waitFor(() => expect(names()).toEqual(['배달 불백', '확인안됨']));
    const card = screen.getByRole('button', { name: /배달 불백/ });
    expect(card).toHaveTextContent('인기고추장불백10,500원');
    expect(card).toHaveTextContent('배달 30분 · 배달비 2,500원');
    expect(card).toHaveTextContent('배달 가능');
    expect(card).toHaveTextContent('최근 10분 배달 주문 있음');
    const other = screen.getByRole('button', { name: /확인안됨/ });
    expect(other).not.toHaveTextContent(/배달비|\d+분/); // 확인되지 않은 배달비·시간은 만들지 않음
    await user.click(card);
    const d = screen.getByRole('dialog', { name: /배달 불백 상세정보/ });
    expect(d).toHaveTextContent('배민·쿠팡이츠 주문 기준');
    expect(within(d).getByRole('link', { name: '배민에서 주문' })).toHaveAttribute('href', 'https://baemin.example/store/1');
    expect(within(d).queryByRole('link', { name: '쿠팡이츠에서 주문' })).not.toBeInTheDocument();
  });

  it('60초마다 자동 새로고침: 화면이 보일 때만, 검색조건·정렬·열어 둔 상세화면 유지', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.rows[0] = { ...h.rows[0], activity: act({ rank_primary: 5 }) };
      gpsAt(STATIONS.seolleung.point);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);
      await user.click(screen.getByRole('radio', { name: '200m' }));
      await user.click(screen.getByRole('radio', { name: '거리순' }));
      await waitFor(() => expect(names()).toEqual(['오십미터 백반', '백오십 국수']));
      await user.click(screen.getByRole('button', { name: /오십미터 백반/ }));
      const calls = () => h.rpc.mock.calls.filter((c) => c[0] === 'search_restaurants').length;
      const before = calls();

      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(calls()).toBe(before + 1));
      expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_radius_m: 200, p_sort: 'distance' }));
      expect(screen.getByRole('dialog', { name: /오십미터 백반 상세정보/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '거리순' })).toHaveAttribute('aria-checked', 'true');

      // 화면이 숨겨지면 조회하지 않음
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls()).toBe(before + 1);
      // 다시 보이면 바로 한 번
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(calls()).toBe(before + 2));
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      vi.useRealTimers();
    }
  });

  it('관리자 테스트 모드만 테스트 순위를 요청하고 “테스트 데이터”로 표시', async () => {
    gpsAt(STATIONS.seolleung.point);
    const { unmount } = render(<App />);
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.not.objectContaining({ p_include_test: true }));
    unmount();

    h.isAdmin = true;
    h.hasSession = true;
    sessionStorage.setItem('mwomeok.testLocation', 'seolleung');
    h.rows[0] = { ...h.rows[0], activity: act({ scope: 'test', windows: { '10m': 30 }, rank_primary: 30 }) };
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('테스트 모드'));
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith('search_restaurants', expect.objectContaining({ p_include_test: true })));
    await waitFor(() => expect(screen.getByRole('button', { name: /오십미터 백반/ })).toHaveTextContent('테스트 데이터'));
  });
});

describe('8단계 — 시범 서비스 점검', () => {
  it('처음 방문하면 위치 용도를 먼저 알리고, ‘현재 위치로 찾기’를 눌러야 GPS 권한을 요청한다', async () => {
    localStorage.removeItem('mwomeok.locationConsent');
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    const ask = screen.getByRole('region', { name: '위치 사용 안내' });
    expect(ask).toHaveTextContent('서버에 위치 기록을 남기지 않아요');
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByText(/현재 위치 · GPS/)).not.toBeInTheDocument(); // 확인 전에 현재 위치처럼 보이지 않음
    await user.click(within(ask).getByRole('button', { name: '자세히' }));
    expect(screen.getByRole('dialog', { name: '위치·개인정보 안내' })).toHaveTextContent('이동 기록으로 저장하지 않아요');
    await user.click(within(screen.getByRole('dialog', { name: '위치·개인정보 안내' })).getByRole('button', { name: '닫기' }));
    await user.click(within(ask).getByRole('button', { name: '현재 위치로 찾기' }));
    await waitFor(() => expect(names()).toEqual(['오십미터 백반']));
    expect(localStorage.getItem('mwomeok.locationConsent')).toBe('1');
  });

  it('위치 없이 지역을 직접 골라도 검색할 수 있다 (역삼 포함, 출발지로는 쓰지 않음)', async () => {
    localStorage.removeItem('mwomeok.locationConsent');
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole('group', { name: '또는 지역 직접 선택' })).getByRole('button', { name: /역삼/ }));
    await waitFor(() => expect(names()).toEqual(['역삼 백미터']));
    expect(screen.getByText('역삼 (시범 위치)')).toBeInTheDocument();
  });

  it('통신이 끊겨 위치를 못 찾으면 그 이유를 알린다', async () => {
    mockGeolocation((_, fail) => fail({ code: 2 }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<App />);
    expect(await screen.findByText(/인터넷 연결이 없어 위치를 확인하지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText(/인터넷 연결이 없어요/)).toBeInTheDocument();
  });

  it('관리자 공지를 맨 위에 보여준다', async () => {
    h.notice = '13시 점검으로 주문정보가 늦을 수 있어요';
    gpsAt(STATIONS.seolleung.point);
    render(<App />);
    expect(await screen.findByText(/13시 점검으로 주문정보가 늦을 수 있어요/)).toBeInTheDocument();
  });

  it('긴 목록은 20곳씩 보여준다 (더 보기)', async () => {
    h.rows = Array.from({ length: 45 }, (_, i) => row(`가게${String(i).padStart(2, '0')}`, 10 + i, i * 8));
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(names()).toHaveLength(20));
    expect(screen.getByText('45곳')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '더 보기 (25곳 더)' }));
    expect(names()).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: '더 보기 (5곳 더)' }));
    expect(names()).toHaveLength(45);
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument();
  });

  it('결과가 없으면 이유와 해결 버튼(범위 넓히기·종류 전체)을 준다', async () => {
    h.rows = [row('멀리', 250, 0)];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/100m 안에 공개된 가게가 없어요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '200m로 넓히기' }));
    await user.click(await screen.findByRole('button', { name: '300m로 넓히기' }));
    await waitFor(() => expect(names()).toEqual(['멀리']));
    await user.click(screen.getByRole('radio', { name: '중식' }));
    await user.click(await screen.findByRole('button', { name: '음식 종류 전체' }));
    await waitFor(() => expect(names()).toEqual(['멀리']));
  });

  it('관리자가 ‘정보 확인 필요’로 둔 매장은 상세화면에 표시한다', async () => {
    h.rows = [row('확인중 식당', 40, 0, STATIONS.seolleung.point, { verify_status: 'needs_review' })];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /확인중 식당/ }));
    expect(screen.getByRole('dialog', { name: /상세정보/ })).toHaveTextContent('정보 확인 필요');
  });

  it('상세화면 ‘네이버에서 메뉴 보기’: 저장된 매장 링크 또는 이름·지역 검색 (네이버 정보임을 밝힌다)', async () => {
    h.rows = [
      row('링크있음', 40, 0, STATIONS.seolleung.point, { naver_place_url: 'https://naver.me/abc' }),
      row('링크없음', 60, 0, STATIONS.seolleung.point),
    ];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /링크있음/ }));
    let d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(within(d).getByRole('link', { name: '네이버에서 메뉴 보기' })).toHaveAttribute('href', 'https://naver.me/abc');
    expect(d).toHaveTextContent('점심뭐먹이 확인한 가격 아님');
    expect(d).not.toHaveTextContent('검색 결과에서 매장을 골라 주세요');
    await user.click(within(d).getByRole('button', { name: /뒤로|목록/ }));
    await user.click(await screen.findByRole('button', { name: /링크없음/ }));
    d = screen.getByRole('dialog', { name: /상세정보/ });
    expect(within(d).getByRole('link', { name: '네이버에서 메뉴 보기' })).toHaveAttribute(
      'href',
      `https://map.naver.com/p/search/${encodeURIComponent('링크없음 강남구')}`,
    );
    expect(d).toHaveTextContent('검색 결과에서 매장을 골라 주세요');
  });

  it('배달은 주소별 배달 가능을 확정하지 않고 ‘배달 가능 거리 안’으로 표시한다', async () => {
    h.rows = [row('배달집', 400, 0, STATIONS.seolleung.point, { delivery: 'yes', delivery_radius_m: 1500 })];
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    const card = await screen.findByRole('button', { name: /배달집/ });
    expect(card).toHaveTextContent('배달 가능 거리 안');
    expect(card).not.toHaveTextContent(/배달 가능(?! 거리)/);
    await user.click(card);
    expect(screen.getByRole('dialog', { name: /상세정보/ })).toHaveTextContent('실제 배달되는지는 주문할 때 배달앱에서 확인');
  });

  it('홈 화면에 추가: 아이폰은 공유 메뉴 안내 (자동 설치 창 없음)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '홈 화면에 추가' }));
    expect(screen.getByRole('dialog', { name: '홈 화면에 추가' })).toHaveTextContent('공유 버튼');
  });

  it('홈 화면에 추가: 안드로이드 크롬은 브라우저 설치 창을 띄운다', async () => {
    gpsAt(STATIONS.seolleung.point);
    const user = userEvent.setup();
    render(<App />);
    const prompt = vi.fn(async () => {});
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(ev);
    await user.click(await screen.findByRole('button', { name: '홈 화면에 추가' }));
    expect(prompt).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });
});
