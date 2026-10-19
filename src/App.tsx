import { useEffect, useMemo, useState } from 'react';
import type { Category, GeoPoint, Mode, Radius, SortKey } from './types';
import { mockDatasetFor } from './data/mockRestaurants';
import { pilotArea } from './data/pilotAreas';
import { APP_NAME, DEFAULT_RADIUS, SLOGAN, usesRadius } from './lib/constants';
import { applyLiveOrders, queryRestaurants } from './lib/restaurants';
import { useCurrentLocation } from './hooks/useCurrentLocation';
import { ModeTabs } from './components/ModeTabs';
import { RadiusSelector } from './components/RadiusSelector';
import { CategoryFilter } from './components/CategoryFilter';
import { SortToggle } from './components/SortToggle';
import { RestaurantCard } from './components/RestaurantCard';
import { LocationPanel } from './components/LocationPanel';
import { DeliveryAddressPanel, type DeliveryTarget } from './components/DeliveryAddressPanel';

/** 가상 실시간 주문 갱신 주기 (ms) */
const LIVE_TICK_MS = 15000;

export default function App() {
  const { state: locationState, locate, choosePilot } = useCurrentLocation();
  const [mode, setMode] = useState<Mode>('walk');
  const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
  const [category, setCategory] = useState<Category | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>('current');
  const [deliveryDetail, setDeliveryDetail] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const currentPoint = locationState.status === 'ready' ? locationState.location.point : null;
  const delivery = mode === 'delivery';
  // 도보·포장은 현재 위치, 배달은 배달 주소를 기준으로 한다.
  const origin: GeoPoint | null = delivery
    ? deliveryTarget === 'current'
      ? currentPoint
      : pilotArea(deliveryTarget).center
    : currentPoint;

  const dataset = useMemo(() => (origin ? mockDatasetFor(origin) : null), [origin]);
  const currentAreaName = useMemo(() => (currentPoint ? mockDatasetFor(currentPoint).areaName : null), [currentPoint]);

  const results = useMemo(
    () =>
      dataset && origin
        ? queryRestaurants(applyLiveOrders(dataset.restaurants, tick), { mode, radius, category, keyword, sort, origin })
        : [],
    [dataset, origin, tick, mode, radius, category, keyword, sort],
  );

  const changeMode = (next: Mode) => {
    setMode(next);
    setExpandedId(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="logo">{APP_NAME}</h1>
        <p className="slogan">{SLOGAN}</p>
      </header>

      <div className="mock-notice" role="note">
        ⚠️ <strong>가상 데이터</strong> — 위치는 실제 GPS를 쓰지만, 음식점·가격·주문 수는 시연용으로 만든
        예시이며 실제 정보가 아닙니다.
      </div>

      <ModeTabs value={mode} onChange={changeMode} />

      {delivery ? (
        <DeliveryAddressPanel
          target={deliveryTarget}
          currentAvailable={currentPoint !== null}
          detail={deliveryDetail}
          onTargetChange={setDeliveryTarget}
          onDetailChange={setDeliveryDetail}
        />
      ) : (
        <LocationPanel
          state={locationState}
          areaName={currentAreaName}
          onRetry={locate}
          onPickPilot={(id) => choosePilot(pilotArea(id))}
        />
      )}

      <section className="controls" aria-label="검색 조건">
        <input
          type="search"
          className="search"
          placeholder="음식 종류·메뉴·가게 이름 검색"
          aria-label="음식 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <CategoryFilter value={category} onChange={setCategory} />
        {usesRadius(mode) ? (
          <RadiusSelector value={radius} onChange={setRadius} />
        ) : (
          <p className="filter-hint">배달은 검색 반경 없이, 배달 주소로 배달 가능한 가게를 보여줘요.</p>
        )}
      </section>

      {origin === null ? (
        <p className="empty">
          {delivery ? '배달 주소를 선택해 주세요.' : '위치를 확인하면 주변 가게를 보여드릴게요.'}
        </p>
      ) : (
        <>
          <div className="list-head">
            <span className="count">{results.length}곳</span>
            <SortToggle value={sort} onChange={setSort} />
          </div>
          {results.length === 0 ? (
            <p className="empty">
              조건에 맞는 가게가 없어요.
              {usesRadius(mode) && radius < 300 && ' 반경을 넓혀 보세요.'}
            </p>
          ) : (
            <ol className="list">
              {results.map((r, i) => (
                <RestaurantCard
                  key={r.id}
                  restaurant={r}
                  rank={i + 1}
                  mode={mode}
                  expanded={expandedId === r.id}
                  onToggle={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                />
              ))}
            </ol>
          )}
        </>
      )}

      <footer className="app-footer">
        2단계 프로토타입 · 거리는 좌표 기준 직선거리 · 실제 지도·음식점 DB·배달앱·POS 미연동
      </footer>
    </div>
  );
}
