import { useEffect, useState } from 'react';
import type { Mode, RestaurantResult } from '../types';
import { CHANNEL_LABEL } from '../lib/channels';
import { MAP_PROVIDER_LABEL, routeDestinationOf, type MapProvider, type RoutePlace } from '../lib/mapLinks';
import { formatDistance, formatMenuPrice, formatPrice, menusForChannel, ordersFor, walkMinutes } from '../lib/restaurants';
import { activitySummary, activityWindows, asOfTime, popularMenus, providerNames } from '../lib/activity';

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
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  const orders = ordersFor(r, mode);
  const popular = popularMenus(r, mode);
  /** 다른 채널 가격 — 홀과 배달 가격을 따로 보여준다 */
  const otherPrices = (menuPrices: Record<string, number | null | undefined>) =>
    (['walk', 'delivery', 'takeout'] as Mode[])
      .filter((m) => m !== mode && menuPrices[m] != null)
      .map((m) => `${CHANNEL_LABEL[m]} ${formatMenuPrice(menuPrices[m])}`)
      .join(' · ');

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
          {r.dataSource.kind === 'mock' ? (
            <span className="mock-badge">가상 매장</span>
          ) : (
            <span className="db-badge">공공데이터·관리자 확인 정보</span>
          )}
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
                  <span className="signature-name">
                    {menu.name}
                    {otherPrices(menu.prices) && <small className="other-prices">{otherPrices(menu.prices)}</small>}
                  </span>
                  <span className={price === null ? 'signature-price muted' : 'signature-price'}>
                    {formatMenuPrice(price)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {popular.length > 0 && (
          <section className="popular" aria-label="인기메뉴">
            <p className="menu-title">
              오늘 {channel} 인기메뉴 <span className="muted">판매 수량 순</span>
              {r.activity?.scope === 'test' && <span className="test-tag">테스트 데이터</span>}
            </p>
            <ol className="popular-list">
              {popular.map(({ menu, price }, i) => (
                <li key={menu.id}>
                  <span className="popular-rank">{i + 1}</span>
                  <span className="popular-name">{menu.name}</span>
                  <span className={price === null ? 'price muted' : 'price'}>{formatMenuPrice(price)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

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
                {r.dataSource.kind === 'db' && <strong className="ok-tag">배달 가능 거리 안</strong>}
                {/* 배달비·예상시간은 확인된 값이 있을 때만 */}
                {[
                  r.deliveryMinutes !== undefined ? `예상 약 ${r.deliveryMinutes}분` : null,
                  r.deliveryFee !== undefined ? `배달비 ${formatPrice(r.deliveryFee)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || `매장 배달 거리 ${formatDistance(r.deliveryRadiusM ?? 0)} (확인됨)`}
                {r.dataSource.kind === 'db' && (
                  <span className="muted detail-note">이 주소로 실제 배달되는지는 주문할 때 배달앱에서 확인해 주세요.</span>
                )}
              </dd>
            </div>
          )}
          {mode === 'takeout' && (
            <div>
              <dt>포장</dt>
              <dd>
                {r.channelStatus.takeout === 'unknown'
                  ? '포장 운영 미확인'
                  : r.takeoutMinutes !== undefined
                    ? `준비 약 ${r.takeoutMinutes}분`
                    : '포장 가능'}
              </dd>
            </div>
          )}
          <div>
            <dt>주문</dt>
            <dd>
              {r.activity ? (
                <>
                  {activityWindows(r.activity).length > 0
                    ? activityWindows(r.activity).map((w) => `${w.label} ${channel} 주문 ${w.level}`).join(' · ')
                    : activitySummary(r.activity, mode)}
                  {r.activity.scope === 'test' && <span className="test-tag">테스트 데이터</span>}
                  <br />
                  {mode === 'delivery' && r.activity.status !== 'delayed' && providerNames(r.activity).length > 0 && (
                    <>
                      {providerNames(r.activity).join('·')} 주문 기준
                      <br />
                    </>
                  )}
                  <span className="muted">
                    {asOfTime(r.activity.asOf)} 기준 주문 집계 · 매장 안 손님 수나 대기시간이 아니에요
                    {r.activity.status === 'delayed' && ' · 최근 데이터가 들어오지 않아 순위에 반영하지 않았어요'}
                  </span>
                </>
              ) : orders === undefined ? (
                '주문정보 없음'
              ) : (
                <>
                  최근 30분 {channel} 주문 {orders}건{' '}
                  <span className="muted">
                    (가상 · {r.dataSource.realtime ? '실시간' : '실시간 아님'} · {formatTime(r.dataSource.updatedAt)} 기준)
                  </span>
                </>
              )}
            </dd>
          </div>
          {r.dataSource.kind === 'db' && (
            <div>
              <dt>확인</dt>
              <dd>
                {r.needsReview && <span className="warn-tag">정보 확인 필요</span>}
                {r.lastVerifiedAt ? `최종 확인 ${r.lastVerifiedAt}` : '현장 확인 전'}
                <span className="muted"> · 정보 갱신 {formatTime(r.dataSource.updatedAt)}</span>
              </dd>
            </div>
          )}
        </dl>

        {rest.length > 0 && (
          <section aria-label="추가 메뉴">
            <p className="menu-title">추가 메뉴</p>
            <ul className="menu-list">
              {rest.map(({ menu, price }) => (
                <li key={menu.id}>
                  <span>{menu.name}</span>
                  <span className={price === null ? 'price muted' : 'price'}>{formatMenuPrice(price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode === 'delivery' &&
          (r.orderLinks?.baemin || r.orderLinks?.coupangeats ? (
            <div className="order-links" aria-label="배달앱에서 주문">
              {r.orderLinks.baemin && (
                <a className="order-link" href={r.orderLinks.baemin} target="_blank" rel="noopener noreferrer">
                  배민에서 주문
                </a>
              )}
              {r.orderLinks.coupangeats && (
                <a className="order-link" href={r.orderLinks.coupangeats} target="_blank" rel="noopener noreferrer">
                  쿠팡이츠에서 주문
                </a>
              )}
            </div>
          ) : (
            <p className="detail-note">확인된 배달앱 링크가 없어 배달앱 연결은 제공하지 않아요.</p>
          ))}

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
