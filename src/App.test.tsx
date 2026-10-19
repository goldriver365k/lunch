import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PILOT_AREAS } from './data/pilotAreas';

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

function cardNames() {
  return within(screen.getByRole('list'))
    .queryAllByText((_, el) => el?.classList.contains('name') ?? false)
    .map((el) => el.textContent);
}

function cardNumbers(pattern: RegExp) {
  return within(screen.getByRole('list'))
    .getAllByRole('button')
    .map((b) => Number(b.textContent!.match(pattern)![1].replace(/,/g, '')));
}

afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
});

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

  it('음식점을 누르면 대표메뉴와 가격이 나타난다', async () => {
    gpsAtSeolleung();
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('searchbox', { name: '음식 검색' }), '짬뽕');
    const head = screen.getByRole('button', { name: /빨간짬뽕집/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('대표메뉴')).toBeInTheDocument();
    expect(screen.getByText('9,000원')).toBeInTheDocument();
    expect(screen.getByText('탕수육 소')).toBeInTheDocument();
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
