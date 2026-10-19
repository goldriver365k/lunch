import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import AdminApp from '../AdminApp';
import { fakeSupabase, type FakeOptions } from '../../test/fakeSupabase';
import type { AdminRestaurant } from '../adminApi';
import type { PopularRow } from '../ordersApi';

const base = {
  region_id: 'seolleung_yeoksam', is_public: true, as_of: '2026-10-19T03:40:00Z', c_today: 0, by_provider: {},
  top_menus: [], last_order_at: '2026-10-19T03:39:00Z', public_rank_allowed: true,
};
const conn = (provider: 'pos' | 'baemin', public_allowed = true) => ({
  provider, status: 'active' as const, public_allowed, last_success_at: '2026-10-19T03:40:00Z',
});

const ROWS: PopularRow[] = [
  {
    ...base, restaurant_id: 'a', name: '가 활발식당', freshness: 'fresh', c_primary: 8, c_secondary: 11, c10: 8, c30: 11, c60: 11,
    c_lunch: 11, top_menus: [{ menu_id: 'm1', name: '돼지불백', quantity: 16 }], connections: [conn('pos')],
  },
  {
    ...base, restaurant_id: 'h', name: '아 공개불허', freshness: 'fresh', c_primary: 3, c_secondary: 3, c10: 3, c30: 3, c60: 3,
    c_lunch: 3, connections: [conn('pos', false)], public_rank_allowed: false,
  },
  {
    ...base, restaurant_id: 's', name: '사 갱신지연', freshness: 'delayed', c_primary: 10, c_secondary: 10, c10: 10, c30: 10, c60: 10,
    c_lunch: 10, connections: [conn('pos')],
  },
  {
    ...base, restaurant_id: 'b', name: '바 미연동', freshness: 'none', as_of: null, c_primary: 0, c_secondary: 0, c10: 0, c30: 0, c60: 0,
    c_lunch: 0, last_order_at: null, connections: [],
  },
];

function setup(opts: FakeOptions = {}) {
  const fake = fakeSupabase({
    session: { user: { email: 'admin@example.com' } },
    ...opts,
    rpc: (fn, args) => {
      if (fn === 'is_admin') return { data: true, error: null };
      if (fn === 'admin_dashboard_stats') return { data: null, error: null };
      if (fn === 'admin_popular_restaurants') return { data: args.p_channel === 'HALL' ? ROWS : [], error: null };
      return { data: null, error: null };
    },
  });
  render(<AdminApp client={fake.client as unknown as SupabaseClient} />);
  return fake;
}

describe('관리자 — 실시간 인기매장', () => {
  it('지역·채널별 순위를 정확한 건수로 보여주고, 갱신 지연·공개 불허·주문 데이터 없는 매장을 구분한다', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await user.click(await screen.findByRole('tab', { name: '실시간 인기매장' }));
    const table = await screen.findByRole('table', { name: '홀 인기 순위' });
    expect(client.rpc).toHaveBeenCalledWith('admin_popular_restaurants', {
      p_region_id: 'seolleung_yeoksam', p_channel: 'HALL', p_test: false,
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['가 활발식당', '아 공개불허', '사 갱신지연']);
    const a = within(table).getByRole('row', { name: '가 활발식당' });
    expect(a).toHaveTextContent('1가 활발식당8111111돼지불백 16');
    expect(a).toHaveTextContent('홀 POS 수집 중');
    // 관리자는 최소 공개 건수(5) 미만도 정확히 본다
    expect(within(table).getByRole('row', { name: '아 공개불허' })).toHaveTextContent('소비자 순위 미반영');
    expect(within(table).getByRole('row', { name: '사 갱신지연' })).toHaveTextContent('—사 갱신지연데이터 갱신 지연');
    expect(screen.getByRole('list', { name: '주문 데이터가 없는 매장' })).toHaveTextContent('바 미연동 · 홀 연동 없음');

    await user.click(screen.getByRole('button', { name: '배달 순위' }));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('admin_popular_restaurants', expect.objectContaining({ p_channel: 'DELIVERY' })));
    expect(await screen.findByText(/배달 주문 데이터가 있는 매장이 없어요/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('지역'), '');
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('admin_popular_restaurants', expect.objectContaining({ p_region_id: null })));

    await user.click(screen.getByLabelText('테스트 데이터'));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('admin_popular_restaurants', expect.objectContaining({ p_test: true })));
    expect(screen.getByText(/테스트 주문으로 순위를 검증해요/)).toBeInTheDocument();
  });

  it('설정: 순위 집계시간(1차·2차)과 화면 새로고침 간격을 저장한다 (2차는 1차보다 길어야)', async () => {
    const user = userEvent.setup();
    const settings = {
      min_public_count: 5, monthly_budget_krw: 0, stale_after_minutes: 15,
      refresh_interval_seconds: 60, rank_primary_minutes: 10, rank_secondary_minutes: 30,
    };
    const { queries } = setup({ query: (c) => (c.table === 'order_settings' ? { data: settings, error: null } : { data: [], error: null }) });
    await user.click(await screen.findByRole('tab', { name: '주문 데이터' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    const form = await screen.findByRole('form', { name: '주문 데이터 설정' });
    const primary = within(form).getByLabelText(/1차 집계시간/);
    await user.clear(primary);
    await user.type(primary, '40');
    expect(within(form).getByRole('alert')).toHaveTextContent('2차 집계시간은 1차보다 길어야 해요');
    expect(within(form).getByRole('button', { name: '저장' })).toBeDisabled();
    await user.clear(primary);
    await user.type(primary, '15');
    const refresh = within(form).getByLabelText(/자동 새로고침/);
    await user.clear(refresh);
    await user.type(refresh, '30');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('저장했어요');
    const upd = queries.find((q) => q.table === 'order_settings' && q.ops[0][0] === 'update')!;
    expect(upd.ops[0][1][0]).toMatchObject({ rank_primary_minutes: 15, rank_secondary_minutes: 30, refresh_interval_seconds: 30 });
  });
});

describe('관리자 — 확인된 배달 정보와 승인된 배달앱 링크', () => {
  const restaurant = {
    id: 'r1', license_no: 'L-1', source_ref: null, name: '공공 식당', category: '한식', category_raw: '한식',
    road_address: '서울 강남구 테헤란로 1', lot_address: null, lat: 37.5046, lng: 127.0491, coord_status: 'valid',
    business_status: 'open', business_status_raw: null, dine_in: 'yes', delivery: 'yes', takeout: 'unknown',
    delivery_radius_m: 1500, delivery_fee_krw: null, delivery_eta_minutes: null, baemin_order_url: null, coupangeats_order_url: null, market_category: null,
    has_signature_menu: false, source: 'public_data', source_name: null, source_collected_at: null, verify_status: 'verified',
    last_verified_at: null, is_public: true, admin_edited: false, region_id: 'seolleung_yeoksam', updated_at: '2026-10-19T00:00:00Z',
  } satisfies AdminRestaurant;

  it('배달비·예상시간은 확인된 값만 넣고, 배달앱 링크는 https만 저장한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup({
      query: (c) => {
        const op = c.ops[0][0];
        if (c.table === 'restaurants' && op === 'select') return { data: [restaurant], error: null, count: 1 };
        if (c.table === 'restaurants') return { data: { ...restaurant, ...(c.ops[0][1][0] as object) }, error: null };
        return { data: [], error: null };
      },
    });
    await user.click(await screen.findByRole('tab', { name: '음식점·메뉴' }));
    await user.click(await screen.findByRole('button', { name: '공공 식당' }));
    const form = screen.getByRole('region', { name: '공공 식당 수정' });
    await user.type(within(form).getByLabelText(/배달비/), '3000');
    await user.type(within(form).getByLabelText(/배달 예상시간/), '25');
    await user.type(within(form).getByLabelText(/배민 주문 링크/), 'http://baemin.example/store');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(within(form).getByRole('status')).toHaveTextContent('https:// 주소만');
    expect(queries.some((q) => q.table === 'restaurants' && q.ops[0][0] === 'update')).toBe(false);

    await user.clear(within(form).getByLabelText(/배민 주문 링크/));
    await user.type(within(form).getByLabelText(/배민 주문 링크/), 'https://baemin.example/store');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByText(/저장했어요/)).toBeInTheDocument();
    const upd = queries.find((q) => q.table === 'restaurants' && q.ops[0][0] === 'update')!;
    expect(upd.ops[0][1][0]).toMatchObject({
      delivery_fee_krw: 3000, delivery_eta_minutes: 25, baemin_order_url: 'https://baemin.example/store', coupangeats_order_url: null,
    });
  });
});
