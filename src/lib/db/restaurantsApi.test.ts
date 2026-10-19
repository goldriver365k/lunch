import { describe, expect, it } from 'vitest';
import { formatMenuPrice, menusForChannel, ordersFor } from '../restaurants';
import { routeDestinationOf } from '../mapLinks';
import { mapDbRow, searchRestaurantsDb, type DbSearchRow } from './restaurantsApi';
import { fakeSupabase } from '../../test/fakeSupabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dbRow = (over: Partial<DbSearchRow> = {}): DbSearchRow => ({
  id: 'r1',
  name: '실DB 식당',
  category: '한식',
  road_address: '서울특별시 강남구 테헤란로 1',
  lot_address: null,
  lat: 37.5046,
  lng: 127.0491,
  distance_m: 42,
  dine_in: 'yes',
  delivery: 'unknown',
  takeout: 'no',
  delivery_radius_m: null,
  last_verified_at: '2026-10-18',
  updated_at: '2026-10-19T03:00:00Z',
  menus: [
    { id: 'm1', name: '김치찌개', is_signature: true, price_dine_in: 9000, price_delivery: null, price_takeout: null, price_verified_at: '2026-10-18' },
  ],
  ...over,
});

describe('mapDbRow', () => {
  it('DB 행을 앱 형식으로 바꾸고, 가격이 없으면 가격정보 없음으로 둔다', () => {
    const r = mapDbRow(dbRow());
    expect(r.distanceM).toBe(42);
    expect(r.modes).toEqual(['walk', 'delivery']); // 포장 '운영 안 함' 제외, 배달 미확인은 포함(검색 함수가 확정 여부를 거름)
    expect(r.channelStatus.takeout).toBe('no');
    expect(menusForChannel(r, 'walk')[0]).toMatchObject({ price: 9000 });
    expect(formatMenuPrice(menusForChannel(r, 'delivery')[0].price)).toBe('가격정보 없음');
    expect(ordersFor(r, 'walk')).toBeUndefined(); // 주문정보 없음 ≠ 0건
    expect(r.dataSource).toMatchObject({ kind: 'db', realtime: false });
    expect(routeDestinationOf(r)).toEqual({ name: '실DB 식당', point: { lat: 37.5046, lng: 127.0491 } });
  });

  it('모르는 음식 종류는 기타', () => {
    expect(mapDbRow(dbRow({ category: '호프' })).category).toBe('기타');
  });
});

describe('searchRestaurantsDb', () => {
  it('서버 RPC에 기준 좌표·반경·탭을 넘긴다 (전체 데이터를 내려받지 않음)', async () => {
    const { client } = fakeSupabase({ rpc: () => ({ data: [dbRow()], error: null }) });
    const rows = await searchRestaurantsDb(client as unknown as SupabaseClient, {
      origin: { lat: 37.5045, lng: 127.049 },
      mode: 'walk',
      radius: 200,
      category: '한식',
      keyword: ' 찌개 ',
    });
    expect(client.rpc).toHaveBeenCalledWith('search_restaurants', {
      p_lat: 37.5045,
      p_lng: 127.049,
      p_mode: 'walk',
      p_radius_m: 200,
      p_category: '한식',
      p_keyword: '찌개',
    });
    expect(rows).toHaveLength(1);
    expect(client.from).not.toHaveBeenCalled();
  });
});
