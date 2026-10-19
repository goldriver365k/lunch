import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import BusinessApp from './BusinessApp';
import { MarketDashboard } from './MarketDashboard';
import { fakeSupabase, type FakeOptions } from '../test/fakeSupabase';
import { analysisToCsv, bandLabel, change } from '../lib/market/format';
import type { MarketAnalysis, MarketCompare } from '../lib/market/types';

const AREAS = [
  { id: 'seolleung', name: '선릉역 주변', sido: '서울특별시', spatial_mode: 'radius', radius_m: 500, business_visible: true },
  { id: 'yeoksam', name: '역삼역 주변', sido: '서울특별시', spatial_mode: 'radius', radius_m: 500, business_visible: true },
  { id: 'pangyo', name: '판교역 주변', sido: '경기도', spatial_mode: 'radius', radius_m: 500, business_visible: true },
  { id: 'yeouido', name: '여의도역 주변', sido: '서울특별시', spatial_mode: 'radius', radius_m: 500, business_visible: true },
];

const slot = (s: number, orders: number) => ({ slot: s, orders, amount_sum: orders * 10000, avg: orders ? 10000 : null, channels: { HALL: orders }, top_menu: orders ? '제육볶음' : null });

function analysis(over: Partial<MarketAnalysis> = {}): MarketAnalysis {
  return {
    area: { id: 'seolleung', name: '선릉역 주변', sido: '서울특별시', spatial_mode: 'radius', radius_m: 500, boundary_source: null, area_km2: 0.785, label: '기준점 반경 500m' },
    scope: 'business',
    period: { key: '7d', from: '2026-10-12', to: '2026-10-18', live: false, now_slot: 25, compare_label: '전주(직전 7일) 대비', prev_from: '2026-10-05', prev_to: '2026-10-11' },
    lunch: { start_min: 660, end_min: 840 },
    price_bounds: [7000, 9000, 12000, 15000],
    as_of: '2026-10-19T03:40:00Z',
    refreshed_at: '2026-10-19T03:41:00Z',
    coverage: {
      registered: 40, operating: 30, consented: 8, collecting_recent: 6, providing_stores: 6, store_days: 36, data_days: 6, period_days: 7,
      last_collected_at: '2026-10-19T03:40:00Z', delayed_stores: 1, rate: 0.2, rate_label: '영업 중으로 확인된 음식점 중 분석 기간에 주문 자료를 제공한 매장 비율',
      delayed_list: null, unmatched_items: null, needs_review: null,
    },
    reliability: { status: 'ok', reasons: [], warnings: ['데이터 제공 매장의 67%가 한식 — 업종 편향 가능성'], min_stores: 5, min_orders: 100 },
    totals: {
      orders: 200, amount_orders: 190, amount_sum: 2090000, avg: 11000, median: 10500, excluded_amount_orders: 10, unknown_channel_orders: 0,
      orders_per_store_day: 5.56, orders_change_pct: 4.2, avg_change_pct: -1.5,
    },
    channels: [
      { channel: 'HALL', orders: 120, share: 0.6, stores: 6, amount_orders: 120, amount_sum: 1200000, avg: 10000, median: 9500, orders_change_pct: 3, avg_change_pct: 1, peak_slot: 24, top_menus: [{ name: '제육볶음', quantity: 40 }], providers: { pos: 120 } },
      { channel: 'DELIVERY', orders: 50, share: 0.25, stores: 2, amount_orders: 40, amount_sum: 560000, avg: 14000, median: 13500, orders_change_pct: null, avg_change_pct: null, peak_slot: 23, top_menus: [], providers: { baemin: 30, coupangeats: 20 } },
      { channel: 'PICKUP', orders: 30, share: 0.15, stores: 3, amount_orders: 30, amount_sum: 330000, avg: 11000, median: 11000, orders_change_pct: 0, avg_change_pct: 0, peak_slot: 25, top_menus: [], providers: { pos: 30 } },
    ],
    price_bands: [
      { lo: 0, hi: 7000, orders: 19, pct: 0.1, change_pp: -1, by_channel: { HALL: { orders: 19, pct: 0.16 }, DELIVERY: { orders: 0, pct: 0 }, PICKUP: { orders: 0, pct: 0 } } },
      { lo: 7001, hi: 9000, orders: 57, pct: 0.3, change_pp: 2, by_channel: { HALL: { orders: 57, pct: 0.48 }, DELIVERY: { orders: 0, pct: 0 }, PICKUP: { orders: 0, pct: 0 } } },
      { lo: 9001, hi: 12000, orders: 76, pct: 0.4, change_pp: 0, by_channel: { HALL: { orders: 44, pct: 0.36 }, DELIVERY: { orders: 2, pct: 0.05 }, PICKUP: { orders: 30, pct: 1 } } },
      { lo: 12001, hi: 15000, orders: 38, pct: 0.2, change_pp: null, by_channel: { HALL: { orders: 0, pct: 0 }, DELIVERY: { orders: 38, pct: 0.95 }, PICKUP: { orders: 0, pct: 0 } } },
      { lo: 15001, hi: null, orders: 0, pct: 0, change_pp: null, by_channel: { HALL: { orders: 0, pct: 0 }, DELIVERY: { orders: 0, pct: 0 }, PICKUP: { orders: 0, pct: 0 } } },
    ],
    menu_unit_prices: { quantity: 250, bands: [{ lo: 0, hi: 7000, quantity: 50, pct: 0.2 }, { lo: 7001, hi: 9000, quantity: 200, pct: 0.8 }] },
    categories: [
      { category: '한식', orders: 150, pct: 0.75, stores: 4, avg: 10500, by_channel: { HALL: 100, DELIVERY: 40, PICKUP: 10 } },
      { category: '중식', orders: 50, pct: 0.25, stores: 2, avg: 12500, by_channel: { HALL: 20, DELIVERY: 10, PICKUP: 20 } },
    ],
    menus: {
      items: [{ name: '제육볶음', grouped: false, quantity: 80, amount_sum: 760000, avg_unit_price: 9500, stores: 3, by_channel: { HALL: 60, DELIVERY: 20 }, peak_slot: 24, change_pct: 12.5 }],
      unclassified_quantity: 7,
      total_quantity: 260,
    },
    slots_half: [22, 23, 24, 25, 26, 27].map((s, i) => slot(s, [20, 30, 50, 40, 35, 25][i])),
    slots_hour: [
      { ...slot(22, 50), from_slot: 22, to_slot: 24 },
      { ...slot(24, 90), from_slot: 24, to_slot: 26 },
      { ...slot(26, 60), from_slot: 26, to_slot: 28 },
    ],
    weekdays: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dow: d, observed_days: d === 4 ? 0 : 1, orders: d === 4 ? 0 : 30, avg_orders: d === 4 ? null : 30, avg: 11000, channels: { HALL: 20 }, top_menu: '제육볶음',
    })),
    today_vs_last_week: { cutoff_slot: 25, today_observed: true, last_week_observed: true, today_orders: 40, last_week_orders: 35, today_stores: 6, last_week_stores: 5, today_avg: 10800, last_week_avg: 10600 },
    public_data: [
      { source: 'seoul_golmok', dataset: '서울시 상권분석서비스', metric: '업종별 점포 수', category: '한식음식점', value: 120, unit: '개', period_label: '2026년 2분기', base_date: null, source_updated_at: '2026-08-01', source_url: null, note: null },
    ],
    ...over,
  };
}

function setup(opts: { role?: 'admin' | 'business'; data?: MarketAnalysis; compare?: MarketCompare } & FakeOptions = {}) {
  const fake = fakeSupabase({
    session: { user: { email: 'biz@example.com' } },
    ...opts,
    rpc: (fn, args) => {
      if (fn === 'market_viewer_role') return { data: opts.role ?? 'business', error: null };
      if (fn === 'market_area_list') return { data: AREAS, error: null };
      if (fn === 'market_analysis') {
        const d = opts.data ?? analysis();
        return { data: { ...d, scope: args.p_test ? 'test' : d.scope }, error: null };
      }
      if (fn === 'market_compare') return { data: opts.compare, error: null };
      return { data: null, error: { message: fn } };
    },
  });
  return fake;
}

afterEach(() => sessionStorage.clear());

describe('사업자 상권 분석 화면', () => {
  it('지역·기간을 고르면 평균 주문금액, 홀·배달·포장, 가격대, 시간대, 음식 종류, 인기메뉴, 요일을 보여준다', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    render(<MarketDashboard client={client as unknown as SupabaseClient} role="business" />);
    const head = await screen.findByRole('region', { name: '분석 개요' });
    expect(client.rpc).toHaveBeenCalledWith('market_analysis', { p_area_id: 'seolleung', p_period: '7d', p_test: false, p_as_business: false });
    expect(head).toHaveTextContent('기준점 반경 500m');
    expect(head).toHaveTextContent('최근 7일 · 10.12~10.18 (완료된 날) · 점심 11:00~14:00(한국시간)');
    expect(head).toHaveTextContent('내부 품질 기준 충족');
    expect(head).toHaveTextContent('업종 편향 가능성');

    const tiles = screen.getByRole('region', { name: '핵심 지표' });
    expect(within(tiles).getByLabelText('평균 주문금액')).toHaveTextContent('11,000원중앙값 10,500원');
    expect(within(tiles).getByLabelText('배달 주문 비중')).toHaveTextContent('25%50건');
    expect(within(tiles).getByLabelText('주문 집중 시간')).toHaveTextContent('12:00~13:00');
    expect(within(tiles).getByLabelText('데이터 제공 매장')).toHaveTextContent('6곳영업 확인 30곳 중');

    const amt = screen.getByRole('region', { name: '평균 주문금액' });
    expect(amt).toHaveTextContent('1인당 식사비가 아니에요');
    expect(amt).toHaveTextContent('배달50건14,000원13,500원');
    expect(amt).toHaveTextContent('금액 기준을 확인할 수 없는 주문 10건');

    const ch = screen.getByRole('region', { name: '홀·배달·포장 비교' });
    expect(ch).toHaveTextContent('선릉역 소재 매장의 배달 주문');
    expect(ch).toHaveTextContent('주문 출처 배민 30 · 쿠팡이츠 20');
    expect(ch).toHaveTextContent('이 상권 전체의 홀·배달·포장 점유율이 아니에요');

    const bands = within(screen.getByRole('region', { name: '가격대별 주문' })).getByRole('list', { name: '가격대별 주문 비중' });
    expect(within(bands).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      '7,000원 이하 10% · 19건', '7,001~9,000원 30% · 57건', '9,001~12,000원 40% · 76건', '12,001~15,000원 20% · 38건', '15,000원 초과 0% · 0건',
    ]);
    expect(within(screen.getByRole('region', { name: '가격대별 주문' })).getByRole('list', { name: '메뉴 판매단가 분포' })).toHaveTextContent('80%');

    const time = screen.getByRole('region', { name: '시간대별 주문' });
    expect(within(time).getAllByRole('listitem')).toHaveLength(3);
    await user.click(within(time).getByRole('radio', { name: '30분' }));
    expect(within(time).getAllByRole('listitem')).toHaveLength(6);
    expect(time).toHaveTextContent('착석 인원·대기시간은 수집하지 않아');

    expect(screen.getByRole('region', { name: '인기 음식 종류' })).toHaveTextContent('데이터 제공 매장 4곳');
    const menus = screen.getByRole('region', { name: '인기메뉴' });
    expect(menus).toHaveTextContent('제육볶음80개');
    expect(menus).toHaveTextContent('분류 미확인 메뉴 7개는 순위에서 뺐어요');

    const dow = screen.getByRole('region', { name: '요일별 주문' });
    expect(within(dow).getByLabelText('목요일 자료 없음')).toHaveTextContent('0건으로 보지 않음');
    expect(dow).toHaveTextContent('오늘 40건(매장 6곳');

    expect(screen.getByRole('list', { name: '공공 상권 자료' })).toHaveTextContent('서울시 상권분석서비스 · 서울시 상권분석서비스 · 업종별 점포 수 (한식음식점): 120개');
    expect(screen.getByRole('list', { name: '공공 상권 자료' })).toHaveTextContent('실시간 자료 아님');
    // 사업자에게는 관리자 기능·내부 지표가 없다
    expect(screen.queryByLabelText('테스트 데이터')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CSV 통계 다운로드' })).not.toBeInTheDocument();
    expect(screen.queryByText('데이터 제공 동의')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '판교역 주변' }));
    await user.click(screen.getByRole('radio', { name: '오늘' }));
    await waitFor(() =>
      expect(client.rpc).toHaveBeenLastCalledWith('market_analysis', { p_area_id: 'pangyo', p_period: 'today', p_test: false, p_as_business: false }),
    );
  });

  it('실제 주문이 없으면 수치 없이 ‘분석할 데이터가 부족합니다’', async () => {
    const empty = analysis({
      reliability: { status: 'none', reasons: ['분석 기간에 확인된 유효 주문이 없어요'], warnings: [], min_stores: 5, min_orders: 100 },
      totals: { ...analysis().totals, orders: 0, amount_orders: 0, amount_sum: 0, avg: null, median: null },
      public_data: [],
      area: { ...analysis().area, name: '판교역 주변', sido: '경기도' },
    });
    const { client } = setup({ data: empty });
    render(<MarketDashboard client={client as unknown as SupabaseClient} role="business" />);
    expect(await screen.findByText('분석할 데이터가 부족합니다', { selector: '.mk-empty-title' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '핵심 지표' })).not.toBeInTheDocument();
    expect(screen.queryByText(/11,000원/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '데이터 출처' })).toHaveTextContent('경기도 지역은 서울시 상권 자료 대상이 아니에요');
  });

  it('표본 부족이면 참고용 표시와 함께 상권 전체 평균으로 단정하지 않는다', async () => {
    const { client } = setup({
      data: analysis({ reliability: { status: 'insufficient', reasons: ['데이터 제공 매장 1곳 (기준 5곳 이상)'], warnings: [], min_stores: 5, min_orders: 100 } }),
    });
    render(<MarketDashboard client={client as unknown as SupabaseClient} role="business" />);
    expect(await screen.findByRole('region', { name: '분석 개요' })).toHaveTextContent('표본 부족 · 참고용 데이터 제공 매장 1곳 (기준 5곳 이상)');
    expect(screen.getByRole('region', { name: '평균 주문금액' })).toHaveTextContent('상권 전체 평균으로 볼 수 없어요');
  });

  it('지역 비교: 같은 기간으로 계산하고, 범위가 다르면 직접 비교하지 말라고 알린다 (순위 없음)', async () => {
    const user = userEvent.setup();
    const row = (id: string, name: string, label: string, status: 'ok' | 'insufficient') => ({
      area: { ...analysis().area, id, name, label }, scope: 'business' as const, period: analysis().period, as_of: null,
      coverage: analysis().coverage, reliability: { ...analysis().reliability, status }, totals: analysis().totals,
      channels: analysis().channels.map((c) => ({ channel: c.channel, orders: c.orders, share: c.share, avg: c.avg })),
      top_category: '한식', top_menu: '제육볶음', peak_hour: analysis().slots_hour[1],
    });
    const { client } = setup({
      compare: { comparable: false, units: ['기준점 반경 500m', '기준점 반경 1000m'], areas: [row('seolleung', '선릉역 주변', '기준점 반경 500m', 'ok'), row('yeoksam', '역삼역 주변', '기준점 반경 1000m', 'insufficient')] },
    });
    render(<MarketDashboard client={client as unknown as SupabaseClient} role="business" />);
    const box = await screen.findByRole('region', { name: '다른 지역과 비교' });
    await user.click(within(box).getByLabelText('판교역 주변'));
    await user.click(within(box).getByLabelText('여의도역 주변'));
    await user.click(within(box).getByRole('button', { name: '최근 7일 지역 비교' }));
    expect(client.rpc).toHaveBeenLastCalledWith('market_compare', {
      p_area_ids: ['seolleung', 'yeoksam'], p_period: '7d', p_test: false, p_as_business: false,
    });
    expect(await within(box).findByRole('note')).toHaveTextContent('지역마다 분석 범위가 달라요');
    expect(box).toHaveTextContent('주문 건수로 순위를 매기지 않아요');
    expect(box).toHaveTextContent('신뢰상태내부 품질 기준 충족표본 부족 · 참고용');
  });
});

describe('관리자 — 상권 분석 조회', () => {
  it('테스트 데이터·사업자 범위를 고를 수 있고, 관리자 테스트 위치의 상권부터 연다', async () => {
    sessionStorage.setItem('mwomeok.testLocation', 'yeouido');
    const user = userEvent.setup();
    const { client } = setup({ role: 'admin', data: analysis({ scope: 'internal' }) });
    render(<MarketDashboard client={client as unknown as SupabaseClient} role="admin" />);
    await screen.findByRole('region', { name: '분석 개요' });
    expect(client.rpc).toHaveBeenCalledWith('market_analysis', expect.objectContaining({ p_area_id: 'yeouido' }));
    expect(screen.getByRole('radio', { name: '여의도역 주변' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('테스트 위치 기준으로 열었어요')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '분석 개요' })).toHaveTextContent('내부 전체 데이터');

    await user.click(screen.getByLabelText('사업자 화면과 같은 범위로 보기'));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('market_analysis', expect.objectContaining({ p_as_business: true })));
    await user.click(screen.getByLabelText('테스트 데이터'));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('market_analysis', expect.objectContaining({ p_test: true })));
    expect(await screen.findByText('테스트 데이터', { selector: '.mk-tag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV 통계 다운로드' })).toBeEnabled();
  });
});

describe('사업자 접속 (/business/market)', () => {
  it('로그인 → 서버에서 사업자 확인 후 분석 화면, 권한 없는 계정은 안내', async () => {
    const user = userEvent.setup();
    const { client } = setup({ session: null });
    render(<BusinessApp client={client as unknown as SupabaseClient} />);
    await user.type(await screen.findByLabelText('이메일'), 'biz@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'pw');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('region', { name: '분석 개요' })).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith('market_viewer_role');
  });

  it('사업자·관리자가 아니면 분석을 불러오지 않는다', async () => {
    const { client } = fakeSupabase({
      session: { user: { email: 'user@example.com' } },
      rpc: (fn) => (fn === 'market_viewer_role' ? { data: null, error: null } : { data: null, error: { message: 'denied' } }),
    });
    render(<BusinessApp client={client as unknown as SupabaseClient} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('사업자 분석 이용 권한이 없는 계정이에요');
    expect(client.rpc).not.toHaveBeenCalledWith('market_analysis', expect.anything());
  });

  it('DB가 없으면 가상 분석을 보여주지 않는다', () => {
    render(<BusinessApp client={null} />);
    expect(screen.getByRole('heading', { name: '데이터베이스가 연결되지 않았어요' })).toBeInTheDocument();
  });
});

describe('상권 분석 표시 규칙', () => {
  it('가격대 이름은 상한 포함, 변화율은 비교 자료가 없으면 그렇게 표시', () => {
    expect(bandLabel(0, 7000)).toBe('7,000원 이하');
    expect(bandLabel(7001, 9000)).toBe('7,001~9,000원');
    expect(bandLabel(15001, null)).toBe('15,000원 초과');
    expect(change(null)).toBe('비교 자료 없음');
    expect(change(3.25)).toBe('+3.3%');
  });

  it('CSV 통계: 집계값만, 채널·가격대 합이 전체와 맞고 수식 주입을 막는다', () => {
    const a = analysis({ menus: { ...analysis().menus, items: [{ ...analysis().menus.items[0], name: '=HYPERLINK("x")' }] } });
    const csv = analysisToCsv(a);
    const lines = csv.replace('﻿', '').trim().split('\n');
    const cells = (l: string) => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]);
    const rows = (k: string) => lines.filter((l) => l.startsWith(`${k},`)).map((l) => Number(cells(l)[2]));
    expect(rows('채널').reduce((s, n) => s + n, 0)).toBe(a.totals.orders);
    expect(rows('가격대').reduce((s, n) => s + n, 0)).toBe(a.totals.amount_orders);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/주문번호|전화/);
  });
});
