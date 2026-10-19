import type { Mode, RestaurantResult } from '../types';
import { WALK_M_PER_MIN } from '../lib/constants';
import { formatDistance, formatPrice } from '../lib/restaurants';

interface Props {
  restaurant: RestaurantResult;
  rank: number;
  mode: Mode;
  expanded: boolean;
  onToggle: () => void;
}

function modeMeta(r: RestaurantResult, mode: Mode): string {
  if (mode === 'delivery') {
    return `배달 ${r.deliveryMinutes}분 · 배달비 ${formatPrice(r.deliveryFee ?? 0)}`;
  }
  if (mode === 'takeout') return `포장 준비 약 ${r.takeoutMinutes}분`;
  return `도보 약 ${Math.max(1, Math.ceil(r.distanceM / WALK_M_PER_MIN))}분`;
}

export function RestaurantCard({ restaurant: r, rank, mode, expanded, onToggle }: Props) {
  const panelId = `menu-${r.id}`;
  return (
    <li className={expanded ? 'card expanded' : 'card'}>
      <button
        type="button"
        className="card-head"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="rank">{rank}</span>
        <span className="card-main">
          <span className="card-title">
            <span className="name">{r.name}</span>
            <span className="category">{r.category}</span>
          </span>
          <span className="card-sub">
            직선 {formatDistance(r.distanceM)} · ★ {r.rating.toFixed(1)} · {modeMeta(r, mode)}
          </span>
          <span className="live">🔥 최근 30분 주문 {r.recentOrders}건 (가상)</span>
        </span>
        <span className="chevron" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div id={panelId} className="menu-panel">
          <p className="menu-title">대표메뉴</p>
          <ul className="menu-list">
            {r.menus.map((m) => (
              <li key={m.name}>
                <span>{m.name}</span>
                <span className="price">{formatPrice(m.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
