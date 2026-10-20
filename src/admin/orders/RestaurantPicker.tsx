import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listRestaurants, type AdminRestaurant } from '../adminApi';

/** 관리자용 음식점 검색·선택 */
export function RestaurantPicker({
  client,
  value,
  onChange,
}: {
  client: SupabaseClient;
  value: AdminRestaurant | null;
  onChange: (r: AdminRestaurant | null) => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminRestaurant[]>([]);

  useEffect(() => {
    if (value) return;
    const h = setTimeout(() => {
      listRestaurants(client, { q, filter: 'all', page: 0 })
        .then((r) => setRows(r.rows.slice(0, 8)))
        .catch(() => setRows([]));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [client, q, value]);

  if (value) {
    return (
      <p className="admin-picked">
        <strong>{value.name}</strong> <span className="admin-muted">{value.road_address ?? value.lot_address ?? ''}</span>{' '}
        <button type="button" className="admin-link" onClick={() => onChange(null)}>
          다른 매장
        </button>
      </p>
    );
  }
  return (
    <div className="admin-picker">
      <input type="search" aria-label="매장 검색" placeholder="매장 이름·주소 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="admin-link strong" onClick={() => onChange(r)}>
              {r.name}
            </button>{' '}
            <span className="admin-muted">{r.road_address ?? r.lot_address ?? ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
