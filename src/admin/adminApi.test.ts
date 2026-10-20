import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeSupabase } from '../test/fakeSupabase';
import { coordStatusOf, fetchExisting, parsePrice, sanitizeSearch, saveRestaurant, stageAndCommit } from './adminApi';
import type { PlannedRow } from '../lib/publicData/importPlan';

const row = (i: number): PlannedRow => ({
  licenseNo: `L-${i}`,
  sourceRef: null,
  name: `매장 ${i}`,
  category: '한식',
  categoryRaw: '한식',
  roadAddress: null,
  lotAddress: null,
  lat: 37.5,
  lng: 127.04,
  coordStatus: 'valid',
  businessStatus: 'open',
  businessStatusRaw: '영업/정상',
  centerDistanceM: 10,
});

describe('입력 검사', () => {
  it.each([
    ['', null],
    ['9,000원', 9000],
    ['0', 'invalid'],
    ['-100', 'invalid'],
    ['9000.5', 'invalid'],
    ['abc', 'invalid'],
  ])('가격 %j → %j (0원으로 저장하지 않는다)', (input, want) => {
    expect(parsePrice(input)).toBe(want);
  });

  it('좌표 상태', () => {
    expect(coordStatusOf(null, null)).toBe('missing');
    expect(coordStatusOf(37.5, null)).toBe('invalid');
    expect(coordStatusOf(127.04, 37.5)).toBe('invalid');
    expect(coordStatusOf(37.5, 127.04)).toBe('valid');
  });

  it('검색어의 필터 문법 문자를 지운다', () => {
    expect(sanitizeSearch('a,b(c)*%')).toBe('a b c');
  });
});

describe('DB 작업', () => {
  it('수정하면 admin_edited를 표시하고 좌표 상태를 다시 계산한다', async () => {
    const { client, queries } = fakeSupabase({ query: () => ({ data: { id: 'x' }, error: null }) });
    await saveRestaurant(client as unknown as SupabaseClient, 'x', {
      name: 'A', category: '한식', road_address: null, lot_address: null, lat: null, lng: null,
      business_status: 'open', dine_in: 'yes', delivery: 'no', takeout: 'unknown', delivery_radius_m: null,
      delivery_fee_krw: null, delivery_eta_minutes: null, baemin_order_url: null, coupangeats_order_url: null, naver_place_url: null, market_category: null,
      verify_status: 'verified', last_verified_at: '2026-10-19', is_public: false, region_id: null,
    });
    const update = queries[0].ops.find(([op]) => op === 'update')![1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ admin_edited: true, coord_status: 'missing', name: 'A' });
  });

  it('기존 매장은 관리번호 200개씩 나눠 조회한다', async () => {
    const { client, queries } = fakeSupabase({ query: () => ({ data: [], error: null }) });
    await fetchExisting(client as unknown as SupabaseClient, Array.from({ length: 450 }, (_, i) => `L-${i}`));
    expect(queries).toHaveLength(3);
    expect((queries[2].ops.find(([op]) => op === 'in')![1][1] as string[]).length).toBe(50);
  });

  it('500행씩 스테이징한 뒤 한 번에 반영한다', async () => {
    const { client, queries } = fakeSupabase({
      query: (c) => ({ data: c.table === 'import_batches' ? { id: 'b1' } : null, error: null }),
      rpc: () => ({ data: { inserted: 1200, updated: 0, unchanged: 0, staged: 1200, closed_skipped: 0, success: 1200 }, error: null }),
    });
    const res = await stageAndCommit(
      client as unknown as SupabaseClient,
      { fileName: 'f.csv', regionId: 'seolleung_yeoksam', sourceName: 's', collectedAt: '2026-10-19', clientStats: {} },
      Array.from({ length: 1200 }, (_, i) => row(i)),
    );
    expect(queries.filter((q) => q.table === 'import_staging')).toHaveLength(3);
    expect(client.rpc).toHaveBeenCalledWith('admin_commit_import', { p_batch_id: 'b1' });
    expect(res.success).toBe(1200);
  });

  it('스테이징 중 실패하면 반영하지 않고 배치를 실패로 표시한다', async () => {
    let n = 0;
    const { client, queries } = fakeSupabase({
      query: (c) => {
        if (c.table === 'import_batches') return { data: { id: 'b1' }, error: null };
        if (c.ops[0][0] === 'insert' && ++n === 2) return { data: null, error: { message: 'network' } };
        return { data: null, error: null };
      },
    });
    await expect(
      stageAndCommit(
        client as unknown as SupabaseClient,
        { fileName: 'f.csv', regionId: 'seolleung_yeoksam', sourceName: 's', collectedAt: '2026-10-19', clientStats: {} },
        Array.from({ length: 1200 }, (_, i) => row(i)),
      ),
    ).rejects.toThrow('network');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(queries.some((q) => q.table === 'import_staging' && q.ops[0][0] === 'delete')).toBe(true);
    expect(
      queries.some((q) => q.table === 'import_batches' && JSON.stringify(q.ops).includes('"failed"')),
    ).toBe(true);
  });
});
