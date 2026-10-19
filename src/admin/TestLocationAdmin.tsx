import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STATIONS, type StationId } from '../data/stations';
import { RADII } from '../lib/constants';
import { searchRestaurantsDb } from '../lib/db/restaurantsApi';
import { requestTestLocation } from '../hooks/useTestLocation';
import type { RestaurantResult } from '../types';

type Choice = 'gps' | StationId;

const CHOICES: { key: Choice; label: string }[] = [
  { key: 'gps', label: '내 실제 GPS 위치' },
  { key: 'seolleung', label: '서울 선릉역' },
  { key: 'yeoksam', label: '서울 역삼역' },
  { key: 'pangyo', label: '경기 판교역' },
  { key: 'yeouido', label: '서울 여의도역' },
];

/**
 * 관리자 전용 테스트 위치.
 * 현지에 가지 않고 역 좌표 기준으로 100·200·300m 검색을 확인한다.
 * 실제 GPS 정확도를 검증하는 기능이 아니다.
 */
export function TestLocationAdmin({ client }: { client: SupabaseClient }) {
  const [choice, setChoice] = useState<Choice>('seolleung');
  const [results, setResults] = useState<Record<number, RestaurantResult[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const station = choice === 'gps' ? null : STATIONS[choice];

  const runCheck = async () => {
    if (!station) return;
    setError(null);
    setResults(null);
    try {
      const entries = await Promise.all(
        RADII.map(async (radius) => {
          const rows = await searchRestaurantsDb(client, { origin: station.point, mode: 'walk', radius, category: null, keyword: '' });
          return [radius, rows] as const;
        }),
      );
      setResults(Object.fromEntries(entries));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-label="테스트 위치 선택">
      <div className="admin-card admin-form">
        <h2>테스트 위치 선택</h2>
        <p className="admin-muted">
          현장에 가지 않고 역 기준으로 음식점 거리 검색을 확인하는 관리자 기능이에요. 실제 GPS 정확도를 검증하는 기능은
          아니에요. 테스트 위치는 소비자 화면에서 실제 위치로 표시되지 않고, 매장찾기 출발지로도 쓰이지 않아요.
        </p>
        <div role="radiogroup" aria-label="테스트 위치" className="admin-radios">
          {CHOICES.map((c) => (
            <label key={c.key} className="admin-switch">
              <input
                type="radio"
                name="test-location"
                checked={choice === c.key}
                onChange={() => {
                  setChoice(c.key);
                  setResults(null);
                }}
              />
              {c.label}
              {c.key !== 'gps' && (
                <span className="admin-muted">
                  {' '}
                  ({STATIONS[c.key].point.lat}, {STATIONS[c.key].point.lng})
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="admin-row">
          <button type="button" className="admin-btn" disabled={!station} onClick={runCheck}>
            여기서 100·200·300m 검색해 보기
          </button>
          <button
            type="button"
            className="admin-btn primary"
            onClick={() => {
              requestTestLocation(station ? station.id : null);
              window.location.assign('/');
            }}
          >
            {station ? '소비자 화면에서 테스트' : '실제 GPS로 소비자 화면 열기'}
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
      {results && station && (
        <section className="admin-card" aria-label="반경별 검색 결과">
          <h2>{station.name} 기준 도보 식사 검색</h2>
          {RADII.map((r) => {
            const prev = r === 100 ? [] : results[r === 200 ? 100 : 200];
            const added = results[r].filter((x) => !prev.some((p) => p.id === x.id));
            return (
              <div key={r}>
                <h3>
                  {r}m — {results[r].length}곳{r !== 100 && ` (+${added.length})`}
                </h3>
                {results[r].length === 0 ? (
                  <p className="admin-muted">등록된 공개 매장이 없어요.</p>
                ) : (
                  <ul>
                    {added.map((x) => (
                      <li key={x.id}>
                        {x.name} · {x.category} · {x.distanceM}m
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}
    </section>
  );
}
