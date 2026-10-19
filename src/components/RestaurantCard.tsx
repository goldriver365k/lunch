import type { Mode, RestaurantResult } from '../types';
import { formatDistance, formatMenuPrice, formatPrice, ordersFor, walkMinutes } from '../lib/restaurants';
import { activitySummary, asOfTime, featuredMenu } from '../lib/activity';

interface Props {
  restaurant: RestaurantResult;
  rank: number;
  mode: Mode;
  onOpen: () => void;
}

function modeMeta(r: RestaurantResult, mode: Mode): string {
  const status = r.channelStatus[mode];
  if (mode === 'delivery') {
    if (r.deliveryMinutes !== undefined) {
      return `배달 ${r.deliveryMinutes}분 · 배달비 ${formatPrice(r.deliveryFee ?? 0)}`;
    }
    return '배달 가능 지역 확인됨';
  }
  if (mode === 'takeout') {
    if (status === 'unknown') return '포장 운영 미확인';
    return r.takeoutMinutes !== undefined ? `포장 준비 약 ${r.takeoutMinutes}분` : '포장 가능';
  }
  const walk = `도보 약 ${walkMinutes(r.distanceM)}분`;
  return status === 'unknown' ? `${walk} · 홀 운영 미확인` : walk;
}

export function RestaurantCard({ restaurant: r, rank, mode, onOpen }: Props) {
  const featured = featuredMenu(r, mode);
  const top = featured?.priced;
  const orders = ordersFor(r, mode);
  const activity = r.activity ? activitySummary(r.activity, mode) : null;
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
            {featured && top ? (
              <>
                <span className="card-menu-name">
                  {featured.popular && <span className="popular-tag">인기</span>}
                  {top.menu.name}
                </span>
                <span className={top.price === null ? 'price muted' : 'price'}>{formatMenuPrice(top.price)}</span>
              </>
            ) : (
              <span className="muted">메뉴정보 준비 중</span>
            )}
          </span>
          <span className="card-sub">
            직선 {formatDistance(r.distanceM)}
            {r.rating !== undefined && ` · ★ ${r.rating.toFixed(1)}`} · {modeMeta(r, mode)}
          </span>
          {activity && r.activity ? (
            <span className="live">
              📈 {activity} · {asOfTime(r.activity.asOf)} 기준
              {r.activity.scope === 'test' && <span className="test-tag">테스트 데이터</span>}
            </span>
          ) : orders === undefined ? (
            <span className="live muted">주문정보 없음</span>
          ) : (
            <span className="live">🔥 최근 30분 주문 {orders}건 (가상)</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
    </li>
  );
}
