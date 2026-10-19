import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminRestaurant } from '../adminApi';
import {
  CHANNEL_LABEL,
  fetchRestaurantOrderStats,
  PROVIDER_LABEL,
  refreshAggregates,
  STATUS_LABEL,
  type RestaurantOrderStats,
} from '../ordersApi';
import { RestaurantPicker } from './RestaurantPicker';
import { fmtTime, won } from './format';

const PROVIDERS = ['pos', 'baemin', 'coupangeats'] as const;

export function RestaurantOrders({ client, test }: { client: SupabaseClient; test: boolean }) {
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const [stats, setStats] = useState<RestaurantOrderStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!restaurant) return;
    setError(null);
    fetchRestaurantOrderStats(client, restaurant.id, test)
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, [client, restaurant, test]);
  useEffect(load, [load]);

  return (
    <section aria-label="매장별 주문 현황">
      <RestaurantPicker
        client={client}
        value={restaurant}
        onChange={(r) => {
          setRestaurant(r);
          setStats(null);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {restaurant && stats && (
        <>
          <div className="admin-card">
            <h2>연결 상태</h2>
            <table className="admin-table">
              <tbody>
                {PROVIDERS.map((p) => {
                  const c = stats.connections.find((x) => x.provider === p);
                  return (
                    <tr key={p}>
                      <th>{PROVIDER_LABEL[p]}</th>
                      <td>
                        {c ? STATUS_LABEL[c.status] : '미등록'}
                        {c?.last_error && <span className="admin-error"> · {c.last_error}</span>}
                      </td>
                      <td className="admin-muted">마지막 정상 수집 {fmtTime(c?.last_success_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-card">
            <h2>오늘 주문 (한국시간)</h2>
            <table className="admin-table">
              <tbody>
                <tr>
                  <th>홀 주문</th>
                  <td>{stats.today_by_channel.HALL?.count ?? 0}건</td>
                </tr>
                <tr>
                  <th>배민 주문</th>
                  <td>{stats.today_by_provider.baemin ?? 0}건</td>
                </tr>
                <tr>
                  <th>쿠팡이츠 주문</th>
                  <td>{stats.today_by_provider.coupangeats ?? 0}건</td>
                </tr>
                <tr>
                  <th>포장 주문</th>
                  <td>{stats.today_by_channel.PICKUP?.count ?? 0}건</td>
                </tr>
                {(['HALL', 'DELIVERY', 'PICKUP'] as const).map((ch) => (
                  <tr key={ch}>
                    <th>{CHANNEL_LABEL[ch]} 주문금액</th>
                    <td>
                      {won(stats.today_by_channel[ch]?.gross_amount)}{' '}
                      <span className="admin-muted">(할인·환불 반영 {won(stats.today_by_channel[ch]?.net_amount)})</span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <th>취소 · 환불</th>
                  <td>
                    {stats.cancelled_today}건 · {won(stats.refund_today)}
                  </td>
                </tr>
                <tr>
                  <th>중복 확인 필요</th>
                  <td>{stats.needs_review}건 (집계 제외)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="admin-card">
            <h2>최근 주문 (유효 건수)</h2>
            <table className="admin-table" aria-label="최근 주문 집계">
              <thead>
                <tr>
                  <th />
                  <th>홀</th>
                  <th>배달</th>
                  <th>포장</th>
                </tr>
              </thead>
              <tbody>
                {(['10m', '30m', '60m'] as const).map((w) => (
                  <tr key={w}>
                    <th>최근 {w.replace('m', '분')}</th>
                    <td>{stats.windows[w].HALL}</td>
                    <td>{stats.windows[w].DELIVERY}</td>
                    <td>{stats.windows[w].PICKUP}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-card">
            <h2>메뉴별 판매 수량 (오늘)</h2>
            {stats.menu_quantities.length === 0 ? (
              <p className="admin-muted">메뉴별 주문 자료가 없어요.</p>
            ) : (
              <ul>
                {stats.menu_quantities.map((m) => (
                  <li key={`${m.channel}-${m.name}`}>
                    [{CHANNEL_LABEL[m.channel]}] {m.name} {m.quantity}개{!m.matched && <span className="admin-muted"> (내부 메뉴 미연결)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="admin-btn" onClick={() => refreshAggregates(client, restaurant.id).then(load)}>
            다시 집계
          </button>
        </>
      )}
    </section>
  );
}
