import type { Mode, RestaurantResult } from '../types';
import { formatDistance, formatPrice, menusForChannel, ordersFor, walkMinutes } from '../lib/restaurants';

interface Props {
  restaurant: RestaurantResult;
  rank: number;
  mode: Mode;
  onOpen: () => void;
}

function modeMeta(r: RestaurantResult, mode: Mode): string {
  if (mode === 'delivery') {
    return `배달 ${r.deliveryMinutes}분 · 배달비 ${formatPrice(r.deliveryFee ?? 0)}`;
  }
  if (mode === 'takeout') return `포장 준비 약 ${r.takeoutMinutes}분`;
  return `도보 약 ${walkMinutes(r.distanceM)}분`;
}

export function RestaurantCard({ restaurant: r, rank, mode, onOpen }: Props) {
  const top = menusForChannel(r, mode)[0];
  return (
    <li className="card">
      <button type="button" className="card-head" aria-haspopup="dialog" onClick={onOpen}>
        <span className="rank">{rank}</span>
        <span className="card-main">
          <span className="card-title">
            <span className="name">{r.name}</span>
            <span className="category">{r.category}</span>
          </span>
          <span className="card-menu">
            {top ? (
              <>
                <span className="card-menu-name">{top.menu.name}</span>
                <span className="price">{formatPrice(top.price)}</span>
              </>
            ) : (
              <span className="muted">메뉴정보 준비 중</span>
            )}
          </span>
          <span className="card-sub">
            직선 {formatDistance(r.distanceM)} · ★ {r.rating.toFixed(1)} · {modeMeta(r, mode)}
          </span>
          <span className="live">🔥 최근 30분 주문 {ordersFor(r, mode)}건 (가상)</span>
        </span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
    </li>
  );
}
