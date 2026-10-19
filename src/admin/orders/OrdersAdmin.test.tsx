/// <reference types="node" />
import { File as NodeFile } from 'node:buffer';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeSupabase, type FakeOptions } from '../../test/fakeSupabase';
import { OrdersAdmin } from './OrdersAdmin';
import { estimateCost, kstMonth } from '../ordersApi';

const OVERVIEW = {
  connected_restaurants: 3,
  healthy_restaurants: 2,
  error_restaurants: 1,
  preparing_connections: 4,
  today: { HALL: 12, DELIVERY: 8, PICKUP: 3, UNKNOWN: 0 },
  last_10m: 5,
  needs_review: 1,
  unmatched_items: 2,
  last_collected_at: '2026-10-19T03:40:00Z',
  last_success_at: '2026-10-19T03:40:00Z',
};

const RESTAURANT = {
  id: 'r1', name: '시험 불백식당', road_address: '서울 강남구 테헤란로 1', lot_address: null, category: '한식',
};

function setup(opts: FakeOptions = {}) {
  const fake = fakeSupabase({
    ...opts,
    rpc: (fn, args) => {
      if (fn === 'admin_order_overview') return { data: { ...OVERVIEW, last_10m: args.p_test ? 30 : 5 }, error: null };
      if (fn === 'admin_order_settings') return { data: null, error: null };
      return opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: fn } };
    },
  });
  render(<OrdersAdmin client={fake.client as unknown as SupabaseClient} />);
  return fake;
}

describe('주문 데이터 — 관리자', () => {
  it('현황: 연동·오류 매장, 오늘 채널별 건수, 최근 10분, 마지막 수집시각 · 실제/테스트 구분', async () => {
    const user = userEvent.setup();
    const { client } = setup();
    const ov = await screen.findByRole('region', { name: '주문 데이터 현황' });
    for (const [label, n] of [
      ['연동된 매장', '3'],
      ['정상 연동 매장', '2'],
      ['오류 발생 매장', '1'],
      ['오늘 홀 주문', '12'],
      ['오늘 배달 주문', '8'],
      ['오늘 포장 주문', '3'],
      ['최근 10분 전체 주문', '5'],
    ]) {
      expect(within(ov).getByText(label).previousSibling).toHaveTextContent(n);
    }
    expect(ov).toHaveTextContent('마지막 데이터 수집');
    expect(client.rpc).toHaveBeenLastCalledWith('admin_order_overview', { p_test: false });

    await user.click(screen.getByLabelText('테스트 데이터'));
    await waitFor(() => expect(client.rpc).toHaveBeenLastCalledWith('admin_order_overview', { p_test: true }));
    expect(screen.getByText(/가상 주문만 보여요/)).toBeInTheDocument();
  });

  it('연동 등록은 항상 ‘연동 준비’로 시작하고, 인증정보 값 대신 서버 비밀값 이름만 저장한다', async () => {
    const user = userEvent.setup();
    const { queries } = setup({
      query: (c) => {
        if (c.table === 'restaurants') return { data: [RESTAURANT], error: null, count: 1 };
        if (c.table === 'order_settings') return { data: { min_public_count: 5, monthly_budget_krw: 0, stale_after_minutes: 15 }, error: null };
        if (c.table === 'order_connections' && c.ops[0][0] === 'select') return { data: [], error: null };
        return { data: { id: 'new' }, error: null };
      },
    });
    await user.click(screen.getByRole('button', { name: '연동 관리' }));
    expect(await screen.findByText(/한도 0원: 유료 호출을 하지 않아요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ 매장 연동 등록' }));
    const form = screen.getByRole('form', { name: '매장 연동 등록' });
    await user.click(await within(form).findByRole('button', { name: '시험 불백식당' }));
    await user.selectOptions(within(form).getByLabelText('제공처'), 'baemin');
    await user.type(within(form).getByLabelText(/서버 비밀값 이름/), 'baemin store-a');
    expect(within(form).queryByLabelText(/API 키|비밀번호/)).not.toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: '등록' }));
    const ins = queries.find((q) => q.table === 'order_connections' && q.ops[0][0] === 'insert')!;
    expect(ins.ops[0][1][0]).toMatchObject({
      restaurant_id: 'r1',
      provider: 'baemin',
      vendor: '하이픈',
      status: 'preparing',
      is_test: false,
      credential_ref: 'BAEMIN_STORE_A',
    });
  });

  it('계약 전 배민 연동의 연결 테스트는 외부 호출 없이 ‘연동 준비’를 알려준다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    setup({
      query: (c) => {
        if (c.table === 'order_settings') return { data: { min_public_count: 5, monthly_budget_krw: 0, stale_after_minutes: 15 }, error: null };
        return {
          data: [
            {
              id: 'c1', restaurant_id: 'r1', provider: 'baemin', vendor: '하이픈', external_store_id: null, ingest_mode: 'polling',
              status: 'preparing', store_consent: false, provider_permission: false, public_allowed: false, is_test: false,
              test_simulate_error: false, credential_ref: null, unit_cost_krw: 0, monthly_call_limit: null, calls_month: null,
              calls_this_month: 0, last_attempt_at: null, last_success_at: null, last_error: null, last_error_at: null,
              restaurants: { name: '시험 불백식당' },
            },
          ],
          error: null,
        };
      },
    });
    await user.click(screen.getByRole('button', { name: '연동 관리' }));
    const card = await screen.findByRole('article', { name: '시험 불백식당 배달의민족 연동' });
    expect(card).toHaveTextContent('연동 준비');
    await user.click(within(card).getByRole('button', { name: 'API 연결 테스트' }));
    expect(await screen.findByText(/연동 준비 — .*실제 연결 미검증.*외부 API 호출 없음/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('중복 가능성 주문을 같은 주문/별개 주문으로 판정한다', async () => {
    const user = userEvent.setup();
    const { client } = setup({
      query: (c) =>
        c.table === 'orders'
          ? {
              data: [
                {
                  id: 'o1', restaurant_id: 'r1', external_order_id: 'POS-9', provider: 'pos', channel: 'DELIVERY',
                  ordered_at: '2026-10-19T03:31:00Z', total_amount: 20000, restaurants: { name: '시험 불백식당' },
                  duplicate: { external_order_id: 'CE-9', provider: 'coupangeats', ordered_at: '2026-10-19T03:30:00Z', total_amount: 20000 },
                },
              ],
              error: null,
            }
          : { data: [], error: null },
      rpc: () => ({ data: null, error: null }),
    });
    await user.click(screen.getByRole('button', { name: '확인 필요' }));
    const box = await screen.findByRole('region', { name: '중복 가능성 확인 필요 주문' });
    await waitFor(() => expect(box).toHaveTextContent('비슷한 주문: 쿠팡이츠 CE-9'));
    await user.click(within(box).getByRole('button', { name: '같은 주문 (하나로 통합)' }));
    expect(client.rpc).toHaveBeenCalledWith('admin_resolve_duplicate', { p_order_id: 'o1', p_action: 'duplicate' });
  });

  it('테스트 보기에서 주문 CSV를 올리면 테스트 연동으로만 저장한다', async () => {
    const user = userEvent.setup();
    const { client, queries } = setup({
      query: (c) => {
        if (c.table === 'restaurants') return { data: [RESTAURANT], error: null, count: 1 };
        if (c.table === 'order_connections') return { data: { id: 'test-csv', test_simulate_error: false }, error: null };
        return { data: [], error: null };
      },
      rpc: (fn) =>
        fn === 'ingest_orders'
          ? { data: { ok: true, inserted: 2, updated: 0, merged: 0, needs_review: 0, items: 3, unmatched_items: 1 }, error: null }
          : { data: null, error: { message: fn } },
    });
    await user.click(screen.getByLabelText('테스트 데이터'));
    await user.click(screen.getByRole('button', { name: '주문 CSV' }));
    await user.click(await screen.findByRole('button', { name: '시험 불백식당' }));
    const csv = '주문번호,주문시각,채널,메뉴명,수량,단가,주문총금액,고객전화번호\nA1,2026-10-19 12:03,홀,돼지불백,2,9000,18000,010-1\nA1,2026-10-19 12:03,홀,공기밥,1,0,18000,010-1\nA2,2026-10-19 12:10,포장,간장불백,1,9000,9000,\n';
    await user.upload(screen.getByLabelText('주문 CSV 파일'), new NodeFile([csv], 'orders.csv', { type: 'text/csv' }) as unknown as File);
    const preview = await screen.findByRole('region', { name: '주문 CSV 미리보기' });
    expect(preview).toHaveTextContent('3행 → 주문 2건 · 오류 0건');
    expect(preview).toHaveTextContent('읽지 않은 열: 고객전화번호');
    await user.click(within(preview).getByRole('button', { name: '주문 2건 저장' }));
    expect(await screen.findByRole('status', { name: '주문 CSV 결과' })).toHaveTextContent('신규 2건');
    const up = queries.find((q) => q.table === 'order_connections' && q.ops[0][0] === 'upsert')!;
    expect(up.ops[0][1][0]).toMatchObject({ restaurant_id: 'r1', provider: 'csv', is_test: true });
    const sent = (client.rpc.mock.calls.find((c) => c[0] === 'ingest_orders')![1] as { p_orders: unknown[] }).p_orders;
    expect(JSON.stringify(sent)).not.toContain('010-1');
  });
});

describe('API 비용 추정', () => {
  it('이번 달 호출량 × 단가, 월말 예상', () => {
    const now = new Date('2026-10-10T03:00:00Z'); // 한국시간 10일
    expect(estimateCost({ calls_month: kstMonth(now), calls_this_month: 1000, unit_cost_krw: 2 }, now)).toEqual({
      calls: 1000,
      cost: 2000,
      projected: 6200,
    });
    expect(estimateCost({ calls_month: '2026-09', calls_this_month: 1000, unit_cost_krw: 2 }, now).calls).toBe(0);
  });
});
