import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOrderOverview, type OrderOverview as Overview } from '../ordersApi';
import { fmtTime } from './format';

export function OrderOverview({ client, test }: { client: SupabaseClient; test: boolean }) {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setO(null);
    fetchOrderOverview(client, test)
      .then(setO)
      .catch((e: Error) => setError(e.message));
  }, [client, test]);
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>;
  if (!o) return <p>불러오는 중…</p>;
  const tiles: [string, number][] = [
    ['연동된 매장', o.connected_restaurants],
    ['정상 연동 매장', o.healthy_restaurants],
    ['오류 발생 매장', o.error_restaurants],
    ['오늘 홀 주문', o.today.HALL],
    ['오늘 배달 주문', o.today.DELIVERY],
    ['오늘 포장 주문', o.today.PICKUP],
    ['최근 10분 전체 주문', o.last_10m],
    ['연동 준비 중 연결', o.preparing_connections],
    ['중복 확인 필요 주문', o.needs_review],
    ['메뉴 확인 필요', o.unmatched_items],
  ];
  return (
    <section aria-label="주문 데이터 현황">
      <div className="admin-tiles">
        {tiles.map(([label, n]) => (
          <div key={label} className="admin-tile">
            <span className="admin-tile-num">{n.toLocaleString('ko-KR')}</span>
            <span className="admin-tile-label">{label}</span>
          </div>
        ))}
      </div>
      <p className="admin-muted">
        마지막 데이터 수집: {fmtTime(o.last_collected_at)} · 마지막 정상 수집: {fmtTime(o.last_success_at)} · 오늘 기준은 한국시간 0시
        · 건수는 취소·중복 의심·통합된 주문을 뺀 유효 주문
      </p>
    </section>
  );
}
