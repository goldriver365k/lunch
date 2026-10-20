/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { File as NodeFile } from 'node:buffer';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import AdminApp from './AdminApp';
import { fakeSupabase, type FakeOptions } from '../test/fakeSupabase';
import { STATIONS } from '../data/stations';
import type { AdminMenu, AdminRestaurant } from './adminApi';

const STATS = {
  total: 12,
  public: 9,
  with_menu: 3,
  without_menu: 9,
  coord_problem: 2,
  closed_or_suspended: 1,
  last_updated_at: '2026-10-19T03:00:00Z',
  last_import_at: null,
  by_region: [{ region_id: 'seolleung_yeoksam', name: '선릉역·역삼역 업무지구', count: 12 }],
};

function setup(opts: FakeOptions & { admin?: boolean } = {}) {
  const fake = fakeSupabase({
    session: { user: { email: 'admin@example.com' } },
    ...opts,
    rpc: (fn, args) => {
      if (fn === 'is_admin') return { data: opts.admin ?? true, error: null };
      if (fn === 'admin_dashboard_stats') return { data: STATS, error: null };
      return opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: fn } };
    },
  });
  render(<AdminApp client={fake.client as unknown as SupabaseClient} />);
  return fake;
}

afterEach(() => sessionStorage.clear());

describe('관리자 접근', () => {
  it('DB가 연결되지 않았으면 연결 방법을 안내한다', () => {
    render(<AdminApp client={null} />);
    expect(screen.getByRole('heading', { name: '데이터베이스가 연결되지 않았어요' })).toBeInTheDocument();
    expect(screen.getByText(/service_role 키는 넣지 마세요/)).toBeInTheDocument();
  });

  it('로그인하지 않았으면 로그인 화면, 로그인하면 서버에서 관리자 확인 후 홈', async () => {
    const user = userEvent.setup();
    const { client } = setup({ session: null });
    expect(await screen.findByRole('form', { name: '관리자 로그인' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('이메일'), 'admin@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'secret-pw');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'secret-pw' });
    expect(await screen.findByText('등록 음식점')).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith('is_admin');
  });

  it('관리자가 아닌 계정은 막는다', async () => {
    setup({ admin: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('관리자 권한이 없는 계정');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('홈: 등록·공개·메뉴·좌표 오류·지역별 수·마지막 업데이트', async () => {
    setup();
    const home = await screen.findByRole('region', { name: '관리자 홈' });
    for (const label of ['등록 음식점', '공개 중', '메뉴 등록', '메뉴 없음', '좌표 오류·누락']) {
      expect(within(home).getByText(label)).toBeInTheDocument();
    }
    expect(home).toHaveTextContent('선릉역·역삼역 업무지구12곳');
    expect(home).toHaveTextContent('마지막 데이터 변경');
  });
});

describe('CSV 업로드', () => {
  const csv = readFileSync(resolve(process.cwd(), 'src/lib/publicData/__fixtures__/sample_cp949.csv'));

  it('검사 → 미리보기 → 승인 → 결과 (중복·폐업·좌표오류 집계)', async () => {
    const user = userEvent.setup();
    let staged = 0;
    const { client, queries } = setup({
      query: (c) => {
        if (c.table === 'restaurants') return { data: [], error: null }; // 기존 매장 없음
        if (c.table === 'import_batches') return { data: { id: 'b1' }, error: null };
        if (c.table === 'import_staging') {
          staged += (c.ops[0][1][0] as unknown[]).length;
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      rpc: (fn) =>
        fn === 'admin_commit_import'
          ? { data: { staged: 9, inserted: 7, updated: 0, unchanged: 0, closed_skipped: 2, success: 7 }, error: null }
          : { data: null, error: { message: fn } },
    });
    await user.click(await screen.findByRole('tab', { name: 'CSV 업로드' }));
    const file = new NodeFile([csv], 'sample.csv', { type: 'text/csv' }) as unknown as File;
    await user.upload(screen.getByLabelText('CSV 파일'), file);
    await user.click(screen.getByRole('button', { name: '파일 검사하기' }));

    const preview = await screen.findByRole('region', { name: '등록 예정 결과 미리보기' });
    expect(preview).toHaveTextContent('신규 등록 예정7건');
    expect(preview).toHaveTextContent('폐업·영업중단 제외2건');
    expect(preview).toHaveTextContent('좌표 오류·누락 (비공개로 분류)3건');
    expect(preview).toHaveTextContent('중복 제외 (이미 같은 내용 + 파일 안 중복)1건');
    expect(preview).toHaveTextContent('필수값 누락1건');
    expect(within(preview).getAllByRole('link', { name: '지도에서 보기' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/map\//),
    );
    expect(client.rpc).not.toHaveBeenCalledWith('admin_commit_import', expect.anything()); // 승인 전에는 저장 안 함

    await user.click(within(preview).getByRole('button', { name: '승인하고 DB에 저장' }));
    const result = await screen.findByRole('status', { name: '업로드 결과' });
    expect(result).toHaveTextContent('신규 등록7건');
    expect(result).toHaveTextContent('최종 등록 성공7건');
    expect(staged).toBe(9); // 영업 7 + 폐업·휴업 2 (기존 매장 폐업 반영용)
    expect(queries.find((q) => q.table === 'import_batches')!.ops[0][1][0]).toMatchObject({
      region_id: 'seolleung_yeoksam',
      source_name: '공공데이터포털 전국일반음식점표준데이터',
    });
  });

  it('필수 항목이 없는 파일은 저장하지 않고 알려준다', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await user.click(await screen.findByRole('tab', { name: 'CSV 업로드' }));
    const bad = new NodeFile([new TextEncoder().encode('이름,주소\n가,나\n')], 'bad.csv') as unknown as File;
    await user.upload(screen.getByLabelText('CSV 파일'), bad);
    await user.click(screen.getByRole('button', { name: '파일 검사하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('필수 항목이 없어요');
    expect(client.from).not.toHaveBeenCalledWith('import_batches');
  });
});

describe('음식점·메뉴 관리', () => {
  const restaurant: AdminRestaurant = {
    id: 'r1', license_no: 'L-1', source_ref: null, name: '공공 식당', category: '한식', category_raw: '한식',
    road_address: '서울 강남구 테헤란로 1', lot_address: null, lat: 37.5046, lng: 127.0491, coord_status: 'valid',
    business_status: 'open', business_status_raw: '영업/정상', dine_in: 'unknown', delivery: 'unknown', takeout: 'unknown',
    delivery_radius_m: null, delivery_fee_krw: null, delivery_eta_minutes: null, baemin_order_url: null, coupangeats_order_url: null, naver_place_url: null, market_category: null,
    has_signature_menu: false, source: 'public_data', source_name: '공공데이터', source_collected_at: '2026-10-19',
    verify_status: 'unverified', last_verified_at: null, is_public: true, admin_edited: false, region_id: 'seolleung_yeoksam',
    updated_at: '2026-10-19T00:00:00Z',
  };
  const menu: AdminMenu = {
    id: 'm1', restaurant_id: 'r1', name: '김치찌개', is_signature: true, price_dine_in: 9000, price_delivery: null,
    price_takeout: null, sort_order: 1, is_available: true, is_public: true, price_verified_at: null, menu_group: null,
  };

  it('매장을 고쳐 저장하고, 메뉴 가격을 바꾸면 그 매장 메뉴만 갱신한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup({
      query: (c) => {
        const op = c.ops[0][0];
        if (c.table === 'restaurants' && op === 'select') return { data: [restaurant], error: null, count: 1 };
        if (c.table === 'restaurants' && op === 'update') return { data: { ...restaurant, ...(c.ops[0][1][0] as object) }, error: null };
        if (c.table === 'menus' && op === 'select') return { data: [menu], error: null };
        if (c.table === 'menus') return { data: { ...menu, ...(c.ops[0][1][0] as object) }, error: null };
        return { data: null, error: null };
      },
    });
    await user.click(await screen.findByRole('tab', { name: '음식점·메뉴' }));
    await user.click(await screen.findByRole('button', { name: '공공 식당' }));

    const form = screen.getByRole('region', { name: '공공 식당 수정' });
    await user.selectOptions(within(form).getByLabelText('홀 운영'), 'yes');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByText(/저장했어요/)).toBeInTheDocument();
    const upd = queries.find((q) => q.table === 'restaurants' && q.ops[0][0] === 'update')!;
    expect(upd.ops[0][1][0]).toMatchObject({ dine_in: 'yes', admin_edited: true, coord_status: 'valid' });
    expect(upd.ops).toContainEqual(['eq', ['id', 'r1']]);

    const menuRow = await screen.findByRole('group', { name: '김치찌개' });
    const dineIn = within(menuRow).getByLabelText('홀 가격');
    await user.clear(dineIn);
    await user.type(dineIn, '9500');
    await user.type(within(menuRow).getByLabelText('배달 가격'), '0');
    await user.click(within(menuRow).getByRole('button', { name: '메뉴 저장' }));
    expect(within(menuRow).getByRole('alert')).toHaveTextContent('1원 이상');

    await user.clear(within(menuRow).getByLabelText('배달 가격'));
    await user.click(within(menuRow).getByRole('button', { name: '메뉴 저장' }));
    await waitFor(() => expect(queries.some((q) => q.table === 'menus' && q.ops[0][0] === 'update')).toBe(true));
    const mu = queries.find((q) => q.table === 'menus' && q.ops[0][0] === 'update')!;
    expect(mu.ops[0][1][0]).toMatchObject({ price_dine_in: 9500, price_delivery: null, price_verified_at: expect.any(String) });
    expect(mu.ops).toContainEqual(['eq', ['restaurant_id', 'r1']]);
  });

  it('네이버 매장 링크는 naver.me·naver.com 주소만 저장한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup({
      query: (c) => {
        const op = c.ops[0][0];
        if (c.table === 'restaurants' && op === 'select') return { data: [restaurant], error: null, count: 1 };
        if (c.table === 'restaurants' && op === 'update') return { data: { ...restaurant, ...(c.ops[0][1][0] as object) }, error: null };
        return { data: [], error: null };
      },
    });
    await user.click(await screen.findByRole('tab', { name: '음식점·메뉴' }));
    await user.click(await screen.findByRole('button', { name: '공공 식당' }));
    const form = screen.getByRole('region', { name: '공공 식당 수정' });
    const input = within(form).getByLabelText(/네이버 매장 링크/);
    await user.type(input, 'https://evil.example.com/');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(within(form).getByRole('status')).toHaveTextContent('네이버 매장 링크는');
    expect(queries.some((q) => q.table === 'restaurants' && q.ops[0][0] === 'update')).toBe(false);
    await user.clear(input);
    await user.type(input, 'https://naver.me/xYz123');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByText(/저장했어요/)).toBeInTheDocument();
    const upd = queries.find((q) => q.table === 'restaurants' && q.ops[0][0] === 'update')!;
    expect(upd.ops[0][1][0]).toMatchObject({ naver_place_url: 'https://naver.me/xYz123' });
  });

  it('좌표가 정상이 아니면 공개할 수 없다', async () => {
    const user = userEvent.setup();
    setup({ query: () => ({ data: [], error: null, count: 0 }) });
    await user.click(await screen.findByRole('tab', { name: '음식점·메뉴' }));
    await user.click(await screen.findByRole('button', { name: '+ 신규 등록' }));
    const form = screen.getByRole('region', { name: '음식점 신규 등록' });
    await user.type(within(form).getByLabelText('음식점명'), '새 식당');
    await user.click(within(form).getByLabelText('앱에 공개'));
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(within(form).getByRole('status')).toHaveTextContent('좌표가 정상이어야');
  });
});

describe('테스트 위치', () => {
  it('6가지 위치(실제 GPS·선릉·역삼·판교·여의도·김해 인제대)를 고를 수 있고, 100·200·300m 결과를 보여준다', async () => {
    const user = userEvent.setup();
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `r${i}`, name: `매장${i}`, category: '한식', road_address: null, lot_address: null, lat: 37.5, lng: 127.03,
        distance_m: (i + 1) * 60, dine_in: 'yes', delivery: 'no', takeout: 'no', delivery_radius_m: null,
        last_verified_at: null, updated_at: '2026-10-19T00:00:00Z', menus: [],
      }));
    const { client } = setup({
      rpc: (fn, args) =>
        fn === 'search_restaurants'
          ? { data: rows({ 100: 1, 200: 3, 300: 4 }[args.p_radius_m as number]!), error: null }
          : { data: null, error: { message: fn } },
    });
    await user.click(await screen.findByRole('tab', { name: '테스트 위치' }));
    const group = screen.getByRole('radiogroup', { name: '테스트 위치' });
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
    await user.click(within(group).getByLabelText(/서울 역삼역/));
    await user.click(screen.getByRole('button', { name: '여기서 100·200·300m 검색해 보기' }));
    const res = await screen.findByRole('region', { name: '반경별 검색 결과' });
    expect(res).toHaveTextContent('100m — 1곳');
    expect(res).toHaveTextContent('200m — 3곳 (+2)');
    expect(res).toHaveTextContent('300m — 4곳 (+1)');
    expect(client.rpc).toHaveBeenCalledWith(
      'search_restaurants',
      expect.objectContaining({ p_lat: STATIONS.yeoksam.point.lat, p_lng: STATIONS.yeoksam.point.lng, p_radius_m: 300 }),
    );
  });

  it('같은 테스트 위치로 사업자 상권 분석을 연다 (현장에 가지 않고 시험)', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    setup();
    await user.click(await screen.findByRole('tab', { name: '테스트 위치' }));
    await user.click(within(screen.getByRole('radiogroup', { name: '테스트 위치' })).getByLabelText(/판교역/));
    await user.click(screen.getByRole('button', { name: '이 위치로 상권 분석 보기' }));
    expect(sessionStorage.getItem('mwomeok.testLocation')).toBe('pangyo');
    expect(assign).toHaveBeenCalledWith('/business/market');
    vi.unstubAllGlobals();
  });
});
