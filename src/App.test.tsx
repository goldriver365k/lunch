import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PILOT_AREAS } from './data/pilotAreas';
import { external } from './lib/mapLinks';

type Success = (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (err: { code: number }) => void;

function mockGeolocation(impl: (ok: Success, fail: Failure) => void) {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

const seolleung = PILOT_AREAS[0].center;
const gpsAtSeolleung = () =>
  mockGeolocation((ok) => ok({ coords: { latitude: seolleung.lat, longitude: seolleung.lng, accuracy: 20 } }));

function listEl() {
  return document.querySelector('ol.list') as HTMLElement;
}

function cardNames() {
  return within(listEl())
    .queryAllByText((_, el) => el?.classList.contains('name') ?? false)
    .map((el) => el.textContent);
}

function cardNumbers(pattern: RegExp) {
  return within(listEl())
    .getAllByRole('button')
    .map((b) => Number(b.textContent!.match(pattern)![1].replace(/,/g, '')));
}

let openWeb: ReturnType<typeof vi.spyOn>;
let openApp: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // 이전 테스트가 남긴 상세화면 history 항목이 뒤로 가기 시험에 섞이지 않게 한다
  window.history.replaceState(null, '');
  openWeb = vi.spyOn(external, 'openWeb').mockImplementation(() => {});
  openApp = vi.spyOn(external, 'openApp').mockImplementation(() => {});
});

afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
  localStorage.clear();
  vi.restoreAllMocks();
});

const detail = () => screen.getByRole('dialog', { name: /상세정보/ });

describe('App — 1단계 기능 유지', () => {
  it('앱 이름, 슬로건, 가상 데이터 안내를 보여준다', () => {
    gpsAtSeolleung();
    render(<App />);
    expect(screen.getByRole('heading', { name: '뭐먹' })).toBeInTheDocument();
    expect(screen.getByText('지금 다들 뭐 먹어?')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('가상 데이터');
  });

  it('3개 탭이 있다', () => {
    gpsAtSeolleung();
    render(<App />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      '🚶 도보 식사',
      '🛵 배달',
      '🛍️ 포장',
    ]);
  });

  it('목록에 대표메뉴와 가격이 보이고, 누르면 상세화면이 열린다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('searchbox', { name: '음식 검색' }), '짬뽕');
    const card = screen.getByRole('button', { name: /빨간짬뽕집/ });
    expect(card).toHaveTextContent('짬뽕9,000원');
    await user.click(card);
    expect(detail()).toBeInTheDocument();
  });
});

describe('App — GPS', () => {
  it('GPS로 현재 위치를 확인하고 주변 가게를 보여준다', () => {
    const geo = gpsAtSeolleung();
    render(<App />);
    expect(geo).toHaveBeenCalled();
    expect(screen.getByText('현재 위치')).toBeInTheDocument();
    expect(screen.getByText(/GPS 정확도 ±20m/)).toBeInTheDocument();
    expect(cardNames().length).toBeGreaterThan(0);
  });

  it('위치 확인 중에는 안내 문구를 보여준다', () => {
    mockGeolocation(() => {});
    render(<App />);
    expect(screen.getByText(/현재 위치를 확인하는 중/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('GPS 오류가 나면 선릉·판교·여의도 시범 위치를 고를 수 있다', async () => {
    mockGeolocation((_, fail) => fail({ code: 1 }));
    const user = userEvent.setup();
    render(<App />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('위치');
    const picker = within(alert).getByRole('group', { name: '시범 위치 선택' });
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['📍 선릉', '📍 판교', '📍 여의도']);
    await user.click(within(picker).getByRole('button', { name: /판교/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('판교 (시범 위치)')).toBeInTheDocument();
    expect(cardNames().length).toBeGreaterThan(0);
  });

  it('GPS를 지원하지 않는 브라우저도 시범 위치로 쓸 수 있다', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('지원하지 않아요');
    await user.click(screen.getByRole('button', { name: /여의도/ }));
    expect(cardNames().length).toBeGreaterThan(0);
  });

  it('GPS 다시 시도 버튼이 위치를 다시 요청한다', async () => {
    const geo = mockGeolocation((_, fail) => fail({ code: 3 }));
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('시간이 초과');
    const calls = geo.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'GPS 다시 시도' }));
    expect(geo.mock.calls.length).toBe(calls + 1);
  });
});

describe('App — 검색·정렬', () => {
  it('반경은 100·200·300m이고 기본값 100m, 넓힐수록 결과가 늘어난다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    const group = screen.getByRole('radiogroup', { name: '검색 반경' });
    expect(within(group).getAllByRole('radio').map((b) => b.textContent)).toEqual(['100m', '200m', '300m']);
    expect(within(group).getByRole('radio', { name: '100m' })).toHaveAttribute('aria-checked', 'true');
    const at100 = cardNames().length;
    expect(cardNumbers(/직선 (\d+)m/).every((d) => d <= 100)).toBe(true);
    await user.click(within(group).getByRole('radio', { name: '200m' }));
    const at200 = cardNames().length;
    await user.click(within(group).getByRole('radio', { name: '300m' }));
    expect(at100).toBeLessThan(at200);
    expect(at200).toBeLessThan(cardNames().length);
  });

  it('기본 정렬은 최근 주문 많은 순, 거리순으로 바꿀 수 있다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    expect(screen.getByRole('radio', { name: '최근 주문 많은 순' })).toHaveAttribute('aria-checked', 'true');
    const orders = cardNumbers(/주문 (\d+)건/);
    expect(orders).toEqual([...orders].sort((a, b) => b - a));
    expect(screen.getAllByText(/\(가상\)/).length).toBe(orders.length);
    await user.click(screen.getByRole('radio', { name: '거리순' }));
    const dists = cardNumbers(/직선 (\d+)m/);
    expect(dists).toEqual([...dists].sort((a, b) => a - b));
  });

  it('음식 종류로 거른다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await user.click(screen.getByRole('radio', { name: '중식' }));
    expect(cardNames().sort()).toEqual(['마라 연구소', '빨간짬뽕집']);
  });
});

describe('App — 배달', () => {
  it('배달은 반경 선택 없이 배달 주소 기준으로 보여준다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    expect(screen.queryByRole('radiogroup', { name: '검색 반경' })).not.toBeInTheDocument();
    const panel = screen.getByRole('region', { name: '배달 주소' });
    expect(within(panel).getByRole('button', { name: /현재 위치/ })).toHaveAttribute('aria-pressed', 'true');
    const dists = cardNumbers(/직선 ([\d.]+)(?:k?m)/);
    expect(dists.length).toBeGreaterThan(0);
    expect(screen.getByText('치킨 브라더스')).toBeInTheDocument(); // 650m — 도보 반경 밖이지만 배달 가능
    expect(screen.queryByText('한우 국밥집')).not.toBeInTheDocument(); // 배달 가능 거리 밖
  });

  it('GPS가 없어도 배달 주소로 시범 지역을 고르면 목록이 나온다', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    const panel = screen.getByRole('region', { name: '배달 주소' });
    expect(within(panel).getByRole('button', { name: /현재 위치/ })).toBeDisabled();
    expect(screen.getByText('배달 주소를 선택해 주세요.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /선릉/ }));
    expect(within(panel).getByRole('button', { name: /선릉/ })).toHaveAttribute('aria-pressed', 'true');
    expect(cardNames().length).toBeGreaterThan(0);
  });
});

describe('App — 3단계 매장 상세화면', () => {
  async function openStore(name: string, opts: { radius?: string; tab?: RegExp } = {}) {
    const user = userEvent.setup();
    if (opts.tab) await user.click(screen.getByRole('tab', { name: opts.tab }));
    if (opts.radius) await user.click(screen.getByRole('radio', { name: opts.radius }));
    await user.click(screen.getByRole('button', { name: new RegExp(name) }));
    return { user, d: detail() };
  }

  it('선택한 매장의 이름·종류·거리·주소·대표메뉴·가격·추가 메뉴·주문 수를 보여준다', async () => {
    gpsAtSeolleung();
    render(<App />);
    const { d } = await openStore('빨간짬뽕집');
    expect(within(d).getByRole('heading', { name: '빨간짬뽕집' })).toBeInTheDocument();
    expect(d).toHaveTextContent('중식');
    expect(d).toHaveTextContent(/현재 위치에서 직선 \d+m · 도보 약 \d+분/);
    expect(d).toHaveTextContent(/가상 주소 · 선릉역 .+쪽 약 95m/);
    const sig = within(d).getByRole('region', { name: '대표메뉴' });
    expect(sig).toHaveTextContent('대표메뉴 · 홀 가격');
    expect(sig).toHaveTextContent('짬뽕9,000원');
    const extra = within(d).getByRole('region', { name: '추가 메뉴' });
    expect(extra).toHaveTextContent('짜장면7,000원');
    expect(extra).toHaveTextContent('탕수육 소16,000원');
    expect(extra).toHaveTextContent('군만두5,000원');
    expect(d).toHaveTextContent(/최근 30분 홀 주문 \d+건/);
    expect(d).toHaveTextContent('실시간 아님');
    expect(within(d).getByRole('button', { name: '매장찾기' })).toBeInTheDocument();
  });

  it('다른 매장의 메뉴가 섞이지 않는다', async () => {
    gpsAtSeolleung();
    render(<App />);
    const { d } = await openStore('골목집 백반');
    expect(d).toHaveTextContent('제육볶음 백반');
    expect(d).not.toHaveTextContent('짬뽕');
    expect(d).not.toHaveTextContent('참치김밥');
  });

  it('홀·포장·배달 가격이 구분된다', async () => {
    gpsAtSeolleung();
    const { unmount } = render(<App />);
    let { d } = await openStore('빨간짬뽕집', { tab: /포장/ });
    expect(within(d).getByRole('region', { name: '대표메뉴' })).toHaveTextContent('포장 가격');
    expect(d).toHaveTextContent('탕수육 소15,000원');
    expect(d).toHaveTextContent(/준비 약 12분/);
    unmount();

    render(<App />);
    ({ d } = await openStore('빨간짬뽕집', { tab: /배달/ }));
    expect(within(d).getByRole('region', { name: '대표메뉴' })).toHaveTextContent('짬뽕10,000원');
    expect(d).toHaveTextContent('탕수육 소18,000원');
    expect(d).not.toHaveTextContent('군만두'); // 배달 가격이 없는 메뉴
    expect(d).toHaveTextContent(/배달 주소에서 직선/);
    expect(d).toHaveTextContent('배달앱 연결은 제공하지 않아요');
    expect(within(d).queryByRole('button', { name: '매장찾기' })).not.toBeInTheDocument();
  });

  it('메뉴가 없으면 메뉴정보 준비 중', async () => {
    gpsAtSeolleung();
    render(<App />);
    const { d } = await openStore('카레 하우스', { radius: '300m' });
    expect(within(d).getByRole('region', { name: '대표메뉴' })).toHaveTextContent('메뉴정보 준비 중');
    expect(within(d).queryByRole('region', { name: '추가 메뉴' })).not.toBeInTheDocument();
  });

  it('가상 매장 좌표는 길찾기에 쓰지 않고 안내한다', async () => {
    gpsAtSeolleung();
    render(<App />);
    const { user, d } = await openStore('빨간짬뽕집');
    await user.click(within(d).getByRole('button', { name: '매장찾기' }));
    expect(within(d).getByRole('alert')).toHaveTextContent('매장 위치정보를 확인할 수 없습니다');
    expect(openWeb).not.toHaveBeenCalled();
    expect(openApp).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /지도를 골라/ })).not.toBeInTheDocument();
  });

  it('뒤로 가면 검색 반경·음식 종류·정렬이 유지된다 (화면 버튼·브라우저 뒤로 가기)', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '300m' }));
    await user.click(screen.getByRole('radio', { name: '중식' }));
    await user.click(screen.getByRole('radio', { name: '거리순' }));
    const before = cardNames();

    await user.click(screen.getByRole('button', { name: /마라 연구소/ }));
    await user.click(within(detail()).getByRole('button', { name: '목록으로 돌아가기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /마라 연구소/ }));
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('radio', { name: '300m' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '중식' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '거리순' })).toHaveAttribute('aria-checked', 'true');
    expect(cardNames()).toEqual(before);
  });
});

describe('App — 3단계 외부 지도 길찾기', () => {
  async function startRouteTest(user: ReturnType<typeof userEvent.setup>, place = '선릉역') {
    await user.click(screen.getByRole('button', { name: /길찾기 연결 시험/ }));
    await user.click(screen.getByRole('button', { name: `${place}까지 도보 길찾기` }));
  }

  it('처음에는 지도를 고르고, 카카오맵 웹 도보 길찾기에 GPS 출발지·목적지 좌표를 넘긴다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await startRouteTest(user);
    const chooser = screen.getByRole('dialog', { name: /지도를 골라/ });
    expect(openWeb).not.toHaveBeenCalled();
    await user.click(within(chooser).getByRole('button', { name: /카카오맵/ }));
    expect(openWeb).toHaveBeenCalledWith(
      `https://map.kakao.com/link/by/walk/${encodeURIComponent('현재 위치')},${seolleung.lat.toFixed(6)},${seolleung.lng.toFixed(6)}/${encodeURIComponent('선릉역')},37.504500,127.049000`,
    );
    expect(localStorage.getItem('mwomeok.mapProvider')).toBe('kakao');

    // 다음부터는 선택 창 없이 바로 연결
    await startRouteTest(user, '판교역');
    expect(screen.queryByRole('dialog', { name: /지도를 골라/ })).not.toBeInTheDocument();
    expect(openWeb).toHaveBeenCalledTimes(2);
    expect(openWeb.mock.calls[1][0]).toContain(`/${encodeURIComponent('판교역')},37.394762,127.111137`);
  });

  it('네이버지도: 공식 nmap://route/walk 로 연결하고, 앱이 없을 때 카카오맵 웹 대안을 안내한다', async () => {
    gpsAtSeolleung();
    localStorage.setItem('mwomeok.mapProvider', 'naver');
    const user = userEvent.setup();
    render(<App />);
    await startRouteTest(user);
    expect(openApp).toHaveBeenCalledTimes(1);
    const url = new URL(openApp.mock.calls[0][0] as string);
    expect(url.protocol + '//' + url.host + url.pathname).toBe('nmap://route/walk');
    expect(url.searchParams.get('dlat')).toBe('37.504500');
    expect(url.searchParams.get('slat')).toBe(seolleung.lat.toFixed(6));
    expect(url.searchParams.get('appname')).toBe(window.location.origin);

    const sheet = screen.getByRole('dialog', { name: /네이버지도 앱을 여는 중/ });
    await user.click(within(sheet).getByRole('button', { name: '카카오맵 웹으로 도보 길찾기' }));
    expect(openWeb.mock.calls[0][0]).toMatch(/^https:\/\/map\.kakao\.com\/link\/by\/walk\//);
  });

  it('카카오맵 앱 URL Scheme으로도 열 수 있다 (사용자가 직접 고를 때만)', async () => {
    gpsAtSeolleung();
    localStorage.setItem('mwomeok.mapProvider', 'kakao');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /길찾기 연결 시험/ }));
    await user.click(screen.getByRole('button', { name: /카카오맵 앱으로 선릉역 길찾기/ }));
    expect(openApp).toHaveBeenCalledWith(
      `kakaomap://route?sp=${seolleung.lat.toFixed(6)},${seolleung.lng.toFixed(6)}&ep=37.504500,127.049000&by=FOOT`,
    );
    expect(openWeb).not.toHaveBeenCalled();
  });

  it('지도 변경으로 다른 지도로 바꿀 수 있다', async () => {
    gpsAtSeolleung();
    localStorage.setItem('mwomeok.mapProvider', 'kakao');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /길찾기 연결 시험/ }));
    expect(screen.getByRole('dialog', { name: '길찾기 연결 시험' })).toHaveTextContent('길찾기 지도: 카카오맵');
    await user.click(screen.getByRole('button', { name: '지도 변경' }));
    await user.click(within(screen.getByRole('dialog', { name: /지도를 골라/ })).getByRole('button', { name: /네이버지도/ }));
    expect(localStorage.getItem('mwomeok.mapProvider')).toBe('naver');
    expect(openApp).not.toHaveBeenCalled(); // 설정만 바꾸고 지도는 열지 않는다
  });

  it('GPS를 거부하고 시범 위치를 고른 경우, 시범 위치를 출발지로 쓰지 않고 안내한다', async () => {
    mockGeolocation((_, fail) => fail({ code: 1 }));
    localStorage.setItem('mwomeok.mapProvider', 'kakao');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /선릉/ }));
    await startRouteTest(user);
    const sheet = screen.getByRole('dialog', { name: '실제 출발 위치를 확인하지 못했어요' });
    expect(openWeb).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: /지도에서 출발지 선택/ }));
    expect(openWeb).toHaveBeenCalledWith(`https://map.kakao.com/link/to/${encodeURIComponent('선릉역')},37.504500,127.049000`);
  });

  it('GPS 거부 상태에서도 상세화면·매장찾기가 오류 없이 동작한다', async () => {
    mockGeolocation((_, fail) => fail({ code: 1 }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /판교/ }));
    await user.click(screen.getByRole('button', { name: /빨간짬뽕집/ }));
    expect(detail()).toHaveTextContent(/판교 \(시범 위치\)에서 직선/);
    await user.click(within(detail()).getByRole('button', { name: '매장찾기' }));
    expect(within(detail()).getByRole('alert')).toHaveTextContent('매장 위치정보를 확인할 수 없습니다');
  });
});
