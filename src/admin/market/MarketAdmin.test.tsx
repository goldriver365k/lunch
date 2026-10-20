import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import AdminApp from '../AdminApp';
import { fakeSupabase, type FakeOptions } from '../../test/fakeSupabase';
import { parseBoundary, parsePriceBands, type MarketArea } from './marketAdminApi';

const area = (id: string, name: string, sido: string, over: Partial<MarketArea> = {}): MarketArea => ({
  id, name, sido, center_lat: 37.5, center_lng: 127, spatial_mode: 'radius', radius_m: 500, boundary_geojson: null, boundary_source: null,
  is_active: true, business_visible: true, sort_order: 1, seoul_realtime_place: null, seoul_realtime_verified: false, note: null, ...over,
});
const AREAS = [area('seolleung', '선릉역 주변', '서울특별시'), area('pangyo', '판교역 주변', '경기도')];

function setup(opts: FakeOptions = {}) {
  const fake = fakeSupabase({
    session: { user: { email: 'admin@example.com' } },
    query: (c) => {
      if (c.table === 'market_areas' && c.ops[0][0] === 'select') return { data: AREAS, error: null };
      if (c.table === 'market_settings' && c.ops[0][0] === 'select') {
        return { data: { lunch_start_min: 660, lunch_end_min: 840, price_bands: [7000, 9000, 12000, 15000], min_stores: 5, min_orders: 100 }, error: null };
      }
      if (c.table === 'market_public_data' && c.ops[0][0] === 'select') return { data: [], error: null };
      return { data: null, error: null };
    },
    ...opts,
    rpc: (fn, args) => {
      if (fn === 'is_admin') return { data: true, error: null };
      if (fn === 'admin_dashboard_stats') return { data: null, error: null };
      if (opts.rpc) return opts.rpc(fn, args);
      return { data: null, error: null };
    },
  });
  render(<AdminApp client={fake.client as unknown as SupabaseClient} />);
  return fake;
}

async function openSub(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('tab', { name: '상권 분석' }));
  await user.click(screen.getByRole('button', { name }));
}

describe('관리자 — 상권 분석', () => {
  it('분석 설정: 점심 분석시간·가격 구간·표본 기준을 저장하고, 잘못된 가격 구간은 막는다', async () => {
    const user = userEvent.setup();
    const { queries } = setup();
    await openSub(user, '분석 설정');
    const form = await screen.findByRole('form', { name: '상권 분석 설정' });
    await user.selectOptions(within(form).getByLabelText(/점심 분석 시작/), '690');
    const bands = within(form).getByLabelText(/가격 구간 상한/);
    await user.clear(bands);
    await user.type(bands, '9000, 8000');
    expect(within(form).getByRole('alert')).toHaveTextContent('오름차순');
    expect(within(form).getByRole('button', { name: '저장' })).toBeDisabled();
    await user.clear(bands);
    await user.type(bands, '8000, 10000, 13000');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('저장했어요');
    const upd = queries.find((q) => q.table === 'market_settings' && q.ops[0][0] === 'update')!;
    expect(upd.ops[0][1][0]).toMatchObject({ lunch_start_min: 690, lunch_end_min: 840, price_bands: [8000, 10000, 13000], min_stores: 5, min_orders: 100 });
  });

  it('공공데이터: 판교에는 서울시 자료를 고를 수 없고, 기준 시점과 함께 등록한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup();
    await openSub(user, '공공데이터');
    await user.selectOptions(await screen.findByLabelText('지역'), 'pangyo');
    const form = screen.getByRole('form', { name: '공공데이터 등록' });
    const source = within(form).getByLabelText('출처');
    expect(within(source).getByRole('option', { name: /서울시 상권분석서비스/ })).toBeDisabled();
    expect(within(source).getByRole('option', { name: /서울시 실시간 상권현황/ })).toBeDisabled();
    await user.selectOptions(source, 'gyeonggi');
    await user.type(within(form).getByLabelText('자료명'), '경기도 상가업소 현황');
    await user.type(within(form).getByLabelText('항목'), '업종별 점포 수');
    await user.type(within(form).getByLabelText('값'), '85');
    await user.type(within(form).getByLabelText('기준 시점'), '2026년 2분기');
    await user.click(within(form).getByRole('button', { name: '등록' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('등록했어요');
    const ins = queries.find((q) => q.table === 'market_public_data' && q.ops[0][0] === 'insert')!;
    expect(ins.ops[0][1][0]).toMatchObject({ area_id: 'pangyo', source: 'gyeonggi', value: 85, period_label: '2026년 2분기' });
  });

  it('분석지역: 새 지역을 반경 1km로 추가하고, 경계 방식은 GeoJSON 다각형이 있어야 한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup();
    await openSub(user, '분석지역');
    await user.click(await screen.findByRole('button', { name: '+ 분석지역 추가' }));
    const form = screen.getByRole('form', { name: '분석지역 추가' });
    await user.type(within(form).getByLabelText('지역 ID'), 'gangnam');
    await user.type(within(form).getByLabelText('지역 이름'), '강남역 주변');
    await user.selectOptions(within(form).getByLabelText('분석 범위'), 'boundary');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    expect(within(form).getByRole('status')).toHaveTextContent('경계 방식은 확인된 상권 경계(GeoJSON)가 필요해요');
    await user.selectOptions(within(form).getByLabelText('분석 범위'), 'radius');
    await user.selectOptions(within(form).getByLabelText('반경(m)'), '1000');
    await user.click(within(form).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(queries.some((q) => q.table === 'market_areas' && q.ops[0][0] === 'insert')).toBe(true));
    const ins = queries.find((q) => q.table === 'market_areas' && q.ops[0][0] === 'insert')!;
    expect(ins.ops[0][1][0]).toMatchObject({ id: 'gangnam', name: '강남역 주변', spatial_mode: 'radius', radius_m: 1000, boundary_geojson: null });
  });

  it('사업자 계정: 가입한 이메일에 사업자 분석 권한을 준다 (결제 없음)', async () => {
    const user = userEvent.setup();
    const { client } = setup({
      rpc: (fn) => ({ data: fn === 'admin_set_business_user' ? 'uid' : fn === 'market_area_list' ? [] : fn === 'admin_list_business_users' ? [] : null, error: null }),
    });
    await openSub(user, '사업자 계정');
    const form = await screen.findByRole('form', { name: '사업자 계정 지정' });
    await user.type(within(form).getByLabelText('이메일'), 'biz@example.com');
    await user.type(within(form).getByLabelText('사업자명'), '시험 창업컨설팅');
    await user.click(within(form).getByRole('button', { name: '권한 주기' }));
    expect(client.rpc).toHaveBeenCalledWith('admin_set_business_user', { p_email: 'biz@example.com', p_org_name: '시험 창업컨설팅', p_active: true });
  });

  it('수집률·오류: 지역별 분모를 밝힌 수집률과 지연 연결을 보여준다', async () => {
    const user = userEvent.setup();
    const cov = {
      registered: 40, operating: 30, consented: 8, collecting_recent: 6, providing_stores: 6, store_days: 36, data_days: 6, period_days: 7,
      last_collected_at: null, delayed_stores: 1, rate: 0.2, rate_label: '', unmatched_items: 3, needs_review: 1,
      delayed_list: [{ name: '시험 식당', provider: 'baemin', status: 'error', last_success_at: null, last_error: '인증 실패' }],
    };
    const { client } = setup({
      rpc: (fn) =>
        fn === 'market_compare'
          ? {
              data: {
                comparable: true, units: ['기준점 반경 500m'],
                areas: [{ area: { id: 'seolleung', name: '선릉역 주변', label: '기준점 반경 500m' }, coverage: cov, reliability: { status: 'ok' }, totals: { excluded_amount_orders: 2 } }],
              },
              error: null,
            }
          : { data: null, error: null },
    });
    await openSub(user, '수집률·오류');
    const row = await screen.findByRole('row', { name: '선릉역 주변' });
    expect(row).toHaveTextContent('403086');
    expect(row).toHaveTextContent('6/7일');
    expect(row).toHaveTextContent('20%');
    expect(screen.getByText(/영업 중으로 확인된 음식점 중 기간 내 주문 자료를 제공한 매장/)).toBeInTheDocument();
    expect(screen.getByText(/메뉴 연결 필요 3개 · 중복 확인 필요 1건 · 금액 기준 미확인 2건/)).toBeInTheDocument();
    expect(screen.getByText(/오류 인증 실패/)).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith('market_compare', { p_area_ids: ['seolleung', 'pangyo'], p_period: '7d', p_test: false, p_as_business: false });
  });
});

describe('입력 검사', () => {
  it('가격 구간은 오름차순 양수만', () => {
    expect(parsePriceBands('7000, 9000,12000 15000')).toEqual([7000, 9000, 12000, 15000]);
    expect(parsePriceBands('9000, 8000')).toBeNull();
    expect(parsePriceBands('')).toBeNull();
    expect(parsePriceBands('0')).toBeNull();
  });

  it('상권 경계는 Polygon·MultiPolygon만 (Feature는 geometry를 꺼냄)', () => {
    const poly = { type: 'Polygon', coordinates: [[[127, 37.5], [127.01, 37.5], [127.01, 37.51], [127, 37.5]]] };
    expect(parseBoundary(JSON.stringify({ type: 'Feature', geometry: poly }))).toEqual({ ok: true, value: poly });
    expect(parseBoundary('{"type":"Point","coordinates":[127,37.5]}')).toMatchObject({ ok: false });
    expect(parseBoundary('nope')).toMatchObject({ ok: false });
    expect(parseBoundary('')).toEqual({ ok: true, value: null });
  });
});
