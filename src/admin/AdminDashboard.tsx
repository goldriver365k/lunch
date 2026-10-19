import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDashboard, type DashboardStats } from './adminApi';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '없음';
}

export function AdminDashboard({ client }: { client: SupabaseClient }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard(client)
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, [client]);

  if (error) return <p role="alert">통계를 불러오지 못했어요: {error}</p>;
  if (!stats) return <p>불러오는 중…</p>;

  const tiles: [string, number][] = [
    ['등록 음식점', stats.total],
    ['공개 중', stats.public],
    ['메뉴 등록', stats.with_menu],
    ['메뉴 없음', stats.without_menu],
    ['좌표 오류·누락', stats.coord_problem],
    ['폐업·영업중단', stats.closed_or_suspended],
  ];
  return (
    <section aria-label="관리자 홈">
      <div className="admin-tiles">
        {tiles.map(([label, n]) => (
          <div key={label} className="admin-tile">
            <span className="admin-tile-num">{n.toLocaleString('ko-KR')}</span>
            <span className="admin-tile-label">{label}</span>
          </div>
        ))}
      </div>
      <div className="admin-card">
        <h2>지역별 등록 매장</h2>
        <table className="admin-table">
          <tbody>
            {stats.by_region.map((r) => (
              <tr key={r.region_id}>
                <th>{r.name}</th>
                <td>{r.count.toLocaleString('ko-KR')}곳</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="admin-muted">
          마지막 데이터 변경: {fmt(stats.last_updated_at)} · 마지막 공공데이터 반영: {fmt(stats.last_import_at)}
        </p>
      </div>
    </section>
  );
}
