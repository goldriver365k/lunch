import { useEffect, useState } from 'react';
import type { Mode, RestaurantResult } from '../types';
import { CHANNEL_LABEL } from '../lib/channels';
import { MAP_PROVIDER_LABEL, routeDestinationOf, type MapProvider, type RoutePlace } from '../lib/mapLinks';
import { formatDistance, formatPrice, menusForChannel, ordersFor, walkMinutes } from '../lib/restaurants';

interface Props {
  restaurant: RestaurantResult;
  mode: Mode;
  /** 거리 기준점 이름 — 현재 위치·시범 위치·배달 주소 */
  originLabel: string;
  provider: MapProvider | null;
  onBack: () => void;
  onFindRoute: (dest: RoutePlace) => void;
  onKakaoApp: (dest: RoutePlace) => void;
  onChangeMap: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export function RestaurantDetail({ restaurant: r, mode, originLabel, provider, onBack, onFindRoute, onKakaoApp, onChangeMap }: Props) {
  const [routeError, setRouteError] = useState(false);
  const menus = menusForChannel(r, mode);
  const signatures = menus.filter((p) => p.menu.signature);
  // 대표메뉴가 지정되지 않았으면 첫 메뉴를 대표로 보여준다
  const head = signatures.length > 0 ? signatures : menus.slice(0, 1);
  const rest = menus.filter((p) => !head.includes(p));
  const channel = CHANNEL_LABEL[mode];
  const dest = routeDestinationOf(r);
  const canFindStore = mode !== 'delivery';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const findStore = () => {
    if (!dest) {
      setRouteError(true);
      return;
    }
    setRouteError(false);
    onFindRoute(dest);
  };

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={`${r.name} 상세정보`}>
      <div className="detail-inner">
        <header className="detail-top">
          <button type="button" className="back-button" onClick={onBack} aria-label="목록으로 돌아가기">
            ‹ 목록
          </button>
          <span className="mock-badge">가상 매장</span>
        </header>

        <h2 className="detail-name">{r.name}</h2>
        <p className="detail-category">{r.category}</p>

        <section className="signature" aria-label="대표메뉴">
          <p className="signature-label">대표메뉴 · {channel} 가격</p>
          {head.length === 0 ? (
            <p className="signature-empty">메뉴정보 준비 중</p>
          ) : (
            <ul className="signature-list">
              {head.map(({ menu, price }) => (
                <li key={menu.id}>
                  <span className="signature-name">{menu.name}</span>
                  <span className="signature-price">{formatPrice(price)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <dl className="detail-facts">
          <div>
            <dt>거리</dt>
            <dd>
              {originLabel}에서 직선 {formatDistance(r.distanceM)}
              {mode !== 'delivery' && ` · 도보 약 ${walkMinutes(r.distanceM)}분`}
            </dd>
          </div>
          <div>
            <dt>주소</dt>
            <dd>{r.address}</dd>
          </div>
          {mode === 'delivery' && (
            <div>
              <dt>배달</dt>
              <dd>
                약 {r.deliveryMinutes}분 · 배달비 {formatPrice(r.deliveryFee ?? 0)}
              </dd>
            </div>
          )}
          {mode === 'takeout' && (
            <div>
              <dt>포장</dt>
              <dd>준비 약 {r.takeoutMinutes}분</dd>
            </div>
          )}
          <div>
            <dt>주문</dt>
            <dd>
              최근 30분 {channel} 주문 {ordersFor(r, mode)}건{' '}
              <span className="muted">
                (가상 · {r.dataSource.realtime ? '실시간' : '실시간 아님'} · {formatTime(r.dataSource.updatedAt)} 기준)
              </span>
            </dd>
          </div>
        </dl>

        {rest.length > 0 && (
          <section aria-label="추가 메뉴">
            <p className="menu-title">추가 메뉴</p>
            <ul className="menu-list">
              {rest.map(({ menu, price }) => (
                <li key={menu.id}>
                  <span>{menu.name}</span>
                  <span className="price">{formatPrice(price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode === 'delivery' && <p className="detail-note">확인된 배달앱 링크가 없어 배달앱 연결은 제공하지 않아요.</p>}

        {canFindStore && (
          <div className="find-store">
            {routeError && (
              <p className="route-error" role="alert">
                매장 위치정보를 확인할 수 없습니다
              </p>
            )}
            <button type="button" className="find-store-button" onClick={findStore}>
              매장찾기
            </button>
            <p className="find-store-meta">
              {provider ? `${MAP_PROVIDER_LABEL[provider]} 도보 길찾기` : '처음 누르면 지도를 고를 수 있어요'}
              {provider && (
                <>
                  {' · '}
                  <button type="button" className="link-button inline" onClick={onChangeMap}>
                    지도 변경
                  </button>
                </>
              )}
              {provider === 'kakao' && dest && (
                <>
                  {' · '}
                  <button type="button" className="link-button inline" onClick={() => onKakaoApp(dest)}>
                    카카오맵 앱으로 열기
                  </button>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
