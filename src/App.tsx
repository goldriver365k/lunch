import { useEffect, useMemo, useState } from 'react';
import type { Category, Mode, Radius, SortKey } from './types';
import { MOCK_RESTAURANTS } from './data/mockRestaurants';
import { APP_NAME, DEFAULT_RADIUS, SLOGAN, usesRadius } from './lib/constants';
import { queryRestaurants, simulateLiveOrders } from './lib/restaurants';
import { ModeTabs } from './components/ModeTabs';
import { RadiusSelector } from './components/RadiusSelector';
import { CategoryFilter } from './components/CategoryFilter';
import { SortToggle } from './components/SortToggle';
import { RestaurantCard } from './components/RestaurantCard';

/** 가상 실시간 인기 갱신 주기 (ms) */
const LIVE_TICK_MS = 15000;

export default function App() {
  const [mode, setMode] = useState<Mode>('walk');
  const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
  const [category, setCategory] = useState<Category | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState(MOCK_RESTAURANTS);

  useEffect(() => {
    const id = setInterval(() => setRestaurants((prev) => simulateLiveOrders(prev)), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const results = useMemo(
    () => queryRestaurants(restaurants, { mode, radius, category, keyword, sort }),
    [restaurants, mode, radius, category, keyword, sort],
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
        ⚠️ <strong>가상 데이터</strong> — 화면의 음식점·가격·주문 수는 시연용으로 만든 예시이며 실제 정보가 아닙니다.
      </div>

      <ModeTabs value={mode} onChange={changeMode} />

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
          <p className="filter-hint">배달은 반경 제한 없이 배달 가능한 가게를 보여줘요.</p>
        )}
      </section>

      <div className="list-head">
        <span className="count">
          {results.length}곳
        </span>
        <SortToggle value={sort} onChange={setSort} />
      </div>

      {results.length === 0 ? (
        <p className="empty">
          조건에 맞는 가게가 없어요.
          {usesRadius(mode) && radius < 100 && ' 반경을 넓혀 보세요.'}
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

      <footer className="app-footer">
        1단계 프로토타입 · 실제 지도·POS·배달앱·카드사 데이터 미연동
      </footer>
    </div>
  );
}
