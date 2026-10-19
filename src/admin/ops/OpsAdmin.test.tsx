import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import AdminApp from '../AdminApp';
import { fakeSupabase } from '../../test/fakeSupabase';

const USAGE = {
  day: '2026-10-19', visitors: 12, sessions: 15, searches: 40, searches_by_mode: { walk: 25, delivery: 10, takeout: 5 },
  detail_views: 18, find_route: 7, installs: 1, gps_denied: 2, gps_error: 1, errors: 0, error_details: [],
  by_area: [{ area: 'seolleung', visitors: 8, searches: 30 }, { area: 'other', visitors: 4, searches: 10 }],
  by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, searches: h === 12 ? 20 : 1, visitors: 1 })),
  last7: [{ day: '2026-10-19', visitors: 12, searches: 40 }],
};
const SYSTEM = {
  checked_at: '2026-10-19T03:00:00Z', db_size_bytes: 52428800, tables: [{ table: 'restaurants', bytes: 1048576, rows: 1200 }],
  usage_24h: 300, connections: [{ provider: 'baemin', status: 'preparing', count: 2 }], api_calls_month: 0, api_cost_month_krw: 0,
  monthly_budget_krw: 0, last_success_at: null, errors: [],
  settings: { notice_message: null, live_orders_public: true, collection_paused: false },
};
const QUALITY = [
  { region_id: 'seolleung_yeoksam', region: '선릉역·역삼역', search_public: true, live_public: true, total: 120, public: 100, open: 110,
    not_open: 10, coord_problem: 3, needs_review: 2, unverified: 90, no_verified_date: 80, category_other: 5, channel_unknown: 70,
    without_menu: 85, menu_ready: 12, price_unverified: 4, possible_duplicates: 2, live_ready: 0, search_ready: true, searchable: 95 },
  { region_id: 'pangyo', region: '판교', search_public: false, live_public: false, total: 0, public: 0, open: 0, not_open: 0,
    coord_problem: 0, needs_review: 0, unverified: 0, no_verified_date: 0, category_other: 0, channel_unknown: 0, without_menu: 0,
    menu_ready: 0, price_unverified: 0, possible_duplicates: 0, live_ready: 0, search_ready: false, searchable: 0 },
];

function setup() {
  const fake = fakeSupabase({
    session: { user: { email: 'admin@example.com' } },
    rpc: (fn) => {
      if (fn === 'is_admin') return { data: true, error: null };
      if (fn === 'admin_usage_overview') return { data: USAGE, error: null };
      if (fn === 'admin_system_status') return { data: SYSTEM, error: null };
      if (fn === 'admin_data_quality') return { data: QUALITY, error: null };
      return { data: null, error: null };
    },
    query: (c) =>
      c.table === 'admin_audit_log'
        ? { data: [{ id: 1, at: '2026-10-19T03:00:00Z', actor: 'abcdef12-0000', table_name: 'restaurants', op: 'UPDATE', row_count: 3, sample_keys: [] }], error: null }
        : { data: null, error: null },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...__APP_BUILD__, buildId: 'newer', commit: 'abc1234' }) })));
  render(<AdminApp client={fake.client as unknown as SupabaseClient} />);
  return fake;
}

afterEach(() => vi.unstubAllGlobals());

describe('관리자 — 운영 현황', () => {
  it('이용 현황: 방문자·세션·검색을 구분하고 도보·배달·포장, 상세 조회, 매장찾기, 지역·시간대를 보여준다', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await user.click(await screen.findByRole('tab', { name: '운영 현황' }));
    const sec = await screen.findByRole('region', { name: '서비스 이용 현황' });
    for (const [label, n] of [
      ['방문자 수 (기기 기준)', '12'], ['세션 수', '15'], ['검색 실행', '40'], ['도보 식사 검색', '25'], ['배달 검색', '10'],
      ['포장 검색', '5'], ['매장 상세 조회', '18'], ['매장찾기 클릭', '7'],
    ]) {
      expect(within(sec).getByText(label).previousSibling).toHaveTextContent(n);
    }
    expect(within(sec).getByRole('table', { name: '지역별 이용' })).toHaveTextContent('선릉830');
    expect(within(sec).getAllByRole('listitem')).toHaveLength(24);
    expect(sec).toHaveTextContent('좌표·IP는 기록하지 않아요');
    expect(client.rpc).toHaveBeenCalledWith('admin_usage_overview', { p_day: null, p_include_test: false });
    await user.click(within(sec).getByLabelText(/관리자 테스트 위치 기록 포함/));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('admin_usage_overview', { p_day: null, p_include_test: true }));
  });

  it('서버·API: DB 사용량, 예상 비용은 확정 청구액이 아님을 밝히고, 배포 버전을 비교한다', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('tab', { name: '운영 현황' }));
    await user.click(screen.getByRole('button', { name: '서버·API' }));
    const sec = await screen.findByRole('region', { name: '서버·API 현황' });
    expect(within(sec).getByText('DB 사용량').previousSibling).toHaveTextContent('50.0MB');
    expect(within(sec).getByText('무료 한도 대비 (참고)').previousSibling).toHaveTextContent('10.0%');
    expect(sec).toHaveTextContent('확정 청구액이 아니에요');
    expect(sec).toHaveTextContent('배달의민족 연동 준비 2');
    expect(await within(sec).findByText(/새로고침하면 새 버전이 보여요/)).toBeInTheDocument();
  });

  it('서비스 관리: 공지 게시, 실시간 표시 중단, 수집 일시중지, 지역별 공개를 저장한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup();
    await user.click(await screen.findByRole('tab', { name: '운영 현황' }));
    await user.click(screen.getByRole('button', { name: '서비스 관리' }));
    const form = await screen.findByRole('form', { name: '서비스 점검 안내' });
    await user.type(within(form).getByLabelText(/소비자 화면 맨 위/), '13시 점검');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    await user.click(screen.getByLabelText('소비자 화면에 실시간 주문정보 표시'));
    await user.click(screen.getByLabelText('실제 주문 데이터 수집 일시중지'));
    await user.click(screen.getByLabelText('판교 음식점 검색 공개'));
    await waitFor(() => expect(queries.filter((q) => q.ops[0][0] === 'update')).toHaveLength(4));
    const updates = queries.filter((q) => q.ops[0][0] === 'update').map((q) => [q.table, q.ops[0][1][0]]);
    expect(updates[0]).toEqual(['app_settings', expect.objectContaining({ notice_message: '13시 점검' })]);
    expect(updates[1]).toEqual(['app_settings', expect.objectContaining({ live_orders_public: false })]);
    expect(updates[2]).toEqual(['app_settings', expect.objectContaining({ collection_paused: true })]);
    expect(updates[3]).toEqual(['regions', { search_public: true }]);
  });

  it('데이터 점검: 지역별 서비스 가능·메뉴정보·실시간 준비를 따로 보여준다', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('tab', { name: '운영 현황' }));
    await user.click(screen.getByRole('button', { name: '데이터 점검' }));
    const table = await screen.findByRole('table', { name: '지역별 데이터 점검' });
    expect(within(table).getByRole('row', { name: /서비스 가능/ })).toHaveTextContent('가능 · 95곳불가');
    expect(within(table).getByRole('row', { name: /메뉴정보 제공 매장/ })).toHaveTextContent('120');
    expect(within(table).getByRole('row', { name: /실시간 인기매장 준비/ })).toHaveTextContent('00');
  });

  it('작업 이력: 누가·언제·무엇을 몇 행 바꿨는지', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('tab', { name: '운영 현황' }));
    await user.click(screen.getByRole('button', { name: '작업 이력' }));
    const sec = await screen.findByRole('region', { name: '관리 작업 이력' });
    expect(await within(sec).findByText('restaurants')).toBeInTheDocument();
    expect(sec).toHaveTextContent('abcdef12');
    expect(sec).toHaveTextContent('수정3');
  });
});
