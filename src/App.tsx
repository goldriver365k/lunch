import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, GeoPoint, Mode, Radius, SortKey } from './types';
import { pilotArea } from './data/pilotAreas';
import { ROUTE_TEST_PLACES } from './data/routeTestPlaces';
import { APP_NAME, DEFAULT_RADIUS, SLOGAN, usesRadius } from './lib/constants';
import { isValidRoutePoint, MAP_PROVIDER_LABEL, type RoutePlace } from './lib/mapLinks';
import { useCurrentLocation } from './hooks/useCurrentLocation';
import { useRestaurantData } from './hooks/useRestaurantData';
import { useRouteFinder } from './hooks/useRouteFinder';
import { useTestLocation } from './hooks/useTestLocation';
import { ModeTabs } from './components/ModeTabs';
import { RadiusSelector } from './components/RadiusSelector';
import { CategoryFilter } from './components/CategoryFilter';
import { SortToggle } from './components/SortToggle';
import { RestaurantCard } from './components/RestaurantCard';
import { LocationPanel } from './components/LocationPanel';
import { DeliveryAddressPanel, type DeliveryTarget } from './components/DeliveryAddressPanel';
import { RestaurantDetail } from './components/RestaurantDetail';
import { RouteSheets } from './components/RouteSheets';
import { BottomSheet } from './components/BottomSheet';

export default function App() {
  const { state: locationState, locate, choosePilot } = useCurrentLocation();
  const testLocation = useTestLocation();
  const [mode, setMode] = useState<Mode>('walk');
  const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
  const [category, setCategory] = useState<Category | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routeTestOpen, setRouteTestOpen] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>('current');
  const [deliveryDetail, setDeliveryDetail] = useState('');

  // 상세화면은 history 항목으로 열어서 브라우저·기기 뒤로 가기로 닫히게 한다.
  // 목록은 그대로 둔 채 위에 덮으므로 검색조건과 스크롤 위치가 유지된다.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setSelectedId((e.state as { mwomeokStore?: string } | null)?.mwomeokStore ?? null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openDetail = (id: string) => {
    window.history.pushState({ mwomeokStore: id }, '');
    setSelectedId(id);
  };
  const closeDetail = useCallback(() => {
    if ((window.history.state as { mwomeokStore?: string } | null)?.mwomeokStore) window.history.back();
    else setSelectedId(null);
  }, []);

  // 관리자 테스트 모드면 테스트 위치를 검색 기준으로 쓴다 (실제 위치로 표시하지 않음)
  const testPoint = testLocation.station?.point ?? null;
  const currentPoint = testPoint ?? (locationState.status === 'ready' ? locationState.location.point : null);
  const delivery = mode === 'delivery';
  // 도보·포장은 현재 위치, 배달은 배달 주소를 기준으로 한다.
  const origin: GeoPoint | null = delivery
    ? deliveryTarget === 'current'
      ? currentPoint
      : pilotArea(deliveryTarget).center
    : currentPoint;

  const data = useRestaurantData({ origin, mode, radius, category, keyword, sort, includeTest: !!testLocation.station });
  const results = data.results;

  // 상세화면은 고유 ID로 해당 매장 한 곳만 찾아 보여준다
  const selected = selectedId ? data.find(selectedId) : null;

  // 길찾기 출발지는 실제 GPS 위치일 때만 쓴다 (시범 위치는 출발지로 쓰지 않음)
  const gpsOrigin: RoutePlace | null = useMemo(
    () =>
      locationState.status === 'ready' &&
      locationState.location.source === 'gps' &&
      isValidRoutePoint(locationState.location.point)
        ? { name: '현재 위치', point: locationState.location.point }
        : null,
    [locationState],
  );
  const route = useRouteFinder(gpsOrigin);

  const originLabel = delivery
    ? '배달 주소'
    : testLocation.station
      ? `${testLocation.station.name}(테스트 위치)`
      : locationState.status === 'ready'
        ? locationState.location.label
        : '현재 위치';

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="logo">{APP_NAME}</h1>
        <p className="slogan">{SLOGAN}</p>
      </header>

      {testLocation.station && (
        <div className="test-mode-bar" role="status">
          <span>
            <strong>테스트 모드 — {testLocation.station.name} 기준</strong>
            <br />
            <small>관리자 전용 · 실제 위치가 아니며 거리 검색 확인용이에요</small>
          </span>
          <button type="button" className="link-button" onClick={testLocation.exit}>
            종료
          </button>
        </div>
      )}

      {data.source === 'mock' && (
        <div className="mock-notice" role="note">
          ⚠️ <strong>가상 데이터</strong> — 위치는 실제 GPS를 쓰지만, 음식점·가격·주문 수는 시연용으로 만든
          예시이며 실제 정보가 아닙니다.
        </div>
      )}

      <ModeTabs value={mode} onChange={setMode} />

      {delivery ? (
        <DeliveryAddressPanel
          target={deliveryTarget}
          currentAvailable={currentPoint !== null}
          detail={deliveryDetail}
          onTargetChange={setDeliveryTarget}
          onDetailChange={setDeliveryDetail}
        />
      ) : testLocation.station ? null : (
        <LocationPanel
          state={locationState}
          areaName={data.source === 'mock' ? data.mockAreaName : ''}
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
            <span className="count">{data.loading ? '검색 중…' : `${results.length}곳`}</span>
            <SortToggle value={sort} onChange={setSort} />
          </div>
          {!data.loading && results.length > 0 && sort === 'popular' && !data.hasOrders && (
            <p className="list-note">주문 활발도 순 정렬은 준비 중이에요 · 가까운 순으로 보여드려요</p>
          )}
          {data.error ? (
            <p className="empty" role="alert">
              {data.error}{' '}
              <button type="button" className="link-button inline" onClick={data.retry}>
                다시 시도
              </button>
            </p>
          ) : data.loading && results.length === 0 ? (
            <p className="empty">주변 가게를 찾는 중…</p>
          ) : results.length === 0 ? (
            <p className="empty">
              조건에 맞는 가게가 없어요.{usesRadius(mode) && radius < 300 ? ' 검색 범위를 넓혀보세요.' : ''}
            </p>
          ) : (
            <ol className="list">
              {results.map((r, i) => (
                <RestaurantCard key={r.id} restaurant={r} rank={i + 1} mode={mode} onOpen={() => openDetail(r.id)} />
              ))}
            </ol>
          )}
        </>
      )}

      <footer className="app-footer">
        <p>거리는 좌표 기준 직선거리 · 실제 도보 거리·시간은 외부 지도에서 확인</p>
        <p>
          <button type="button" className="link-button inline" onClick={() => setRouteTestOpen(true)}>
            길찾기 연결 시험 · 지도 설정
          </button>
        </p>
      </footer>

      {selected && (
        <RestaurantDetail
          key={selected.id}
          restaurant={selected}
          mode={mode}
          originLabel={originLabel}
          provider={route.provider}
          onBack={closeDetail}
          onFindRoute={(dest) => route.findRoute(dest)}
          onKakaoApp={(dest) => route.findRoute(dest, 'kakao-app')}
          onChangeMap={route.changeProvider}
        />
      )}

      {routeTestOpen && (
        <BottomSheet title="길찾기 연결 시험" onClose={() => setRouteTestOpen(false)}>
          <p className="sheet-text">
            가상 매장 좌표는 길찾기에 쓰지 않아요. 아래 공공 장소(역)로 외부 지도 연결만 시험할 수 있어요.
            <br />
            <span className="muted">역 중심 좌표 (위키백과·위키데이터 대조)</span>
          </p>
          <div className="sheet-actions">
            {ROUTE_TEST_PLACES.map((place) => (
              <button
                key={place.name}
                type="button"
                className="sheet-option"
                onClick={() => {
                  setRouteTestOpen(false);
                  route.findRoute(place);
                }}
              >
                {place.name}까지 도보 길찾기
              </button>
            ))}
          </div>
          {route.provider === 'kakao' && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setRouteTestOpen(false);
                route.findRoute(ROUTE_TEST_PLACES[0], 'kakao-app');
              }}
            >
              카카오맵 앱으로 {ROUTE_TEST_PLACES[0].name} 길찾기 (앱 설치 시)
            </button>
          )}
          <p className="sheet-note">
            길찾기 지도: {route.provider ? MAP_PROVIDER_LABEL[route.provider] : '아직 고르지 않음'} ·{' '}
            <button
              type="button"
              className="link-button inline"
              onClick={() => {
                setRouteTestOpen(false);
                route.changeProvider();
              }}
            >
              지도 변경
            </button>
          </p>
        </BottomSheet>
      )}

      <RouteSheets
        step={route.step}
        provider={route.provider}
        onChoose={route.chooseProvider}
        onLocate={locate}
        onOpenWithoutOrigin={route.openWithoutOrigin}
        onKakaoWeb={route.switchToKakaoWeb}
        onClose={route.close}
      />
    </div>
  );
}
