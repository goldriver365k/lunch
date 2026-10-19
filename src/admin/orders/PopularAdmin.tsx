import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IMPORT_REGIONS } from '../../lib/publicData/regions';
import { CHANNEL_LABEL, fetchPopularRestaurants, PROVIDER_LABEL, STATUS_LABEL, type PopularRow } from '../ordersApi';
import { fmtTime } from './format';

type RankChannel = 'HALL' | 'DELIVERY' | 'PICKUP';
const CHANNELS: RankChannel[] = ['HALL', 'DELIVERY', 'PICKUP'];

/** 관리자 → 실시간 인기매장. 서버가 계산한 순위를 정확한 건수로 본다 (소비자 화면은 최소 공개 건수 적용) */
export function PopularAdmin({ client }: { client: SupabaseClient }) {
  const [region, setRegion] = useState<string>('seolleung_yeoksam');
  const [channel, setChannel] = useState<RankChannel>('HALL');
  const [test, setTest] = useState(false);
  const [rows, setRows] = useState<PopularRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchPopularRestaurants(client, region || null, channel, test)
      .then((r) => {
        setRows(r);
        setLoadedAt(new Date().toISOString());
      })
      .catch((e: Error) => setError(e.message));
  }, [client, region, channel, test]);
  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  const ranked = rows?.filter((r) => r.freshness !== 'none') ?? [];
  const noData = rows?.filter((r) => r.freshness === 'none') ?? [];

  return (
    <section aria-label="실시간 인기매장">
      <div className={test ? 'admin-scope test' : 'admin-scope'} role="radiogroup" aria-label="데이터 구분">
        <label className="admin-switch">
          <input type="radio" name="popular-scope" checked={!test} onChange={() => setTest(false)} />
          실제 데이터
        </label>
        <label className="admin-switch">
          <input type="radio" name="popular-scope" checked={test} onChange={() => setTest(true)} />
          테스트 데이터
        </label>
        <span className="admin-muted">
          {test ? '테스트 주문으로 순위를 검증해요 — 소비자 화면과 무관' : '실제 수집 주문만으로 계산한 순위예요'}
        </span>
      </div>
      <div className="admin-toolbar">
        <label>
          지역{' '}
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {IMPORT_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="">전체 지역</option>
          </select>
        </label>
        <nav className="admin-subtabs" aria-label="순위 채널">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              aria-current={channel === ch ? 'page' : undefined}
              className={channel === ch ? 'admin-subtab active' : 'admin-subtab'}
              onClick={() => setChannel(ch)}
            >
              {CHANNEL_LABEL[ch]} 순위
            </button>
          ))}
        </nav>
        <button type="button" className="admin-btn" onClick={load}>
          새로고침
        </button>
      </div>
      {error && <p role="alert">불러오지 못했어요: {error}</p>}
      {!rows && !error && <p>불러오는 중…</p>}
      {rows && (
        <>
          <div className="admin-card">
            <h2>
              {CHANNEL_LABEL[channel]} 인기 순위 <span className="admin-muted">조회 {fmtTime(loadedAt)}</span>
            </h2>
            {ranked.length === 0 ? (
              <p className="admin-muted">이 지역에 {CHANNEL_LABEL[channel]} 주문 데이터가 있는 매장이 없어요.</p>
            ) : (
              <div className="admin-scroll">
                <table className="admin-table" aria-label={`${CHANNEL_LABEL[channel]} 인기 순위`}>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>매장</th>
                      <th>10분</th>
                      <th>30분</th>
                      <th>60분</th>
                      <th>점심</th>
                      <th>인기메뉴 (오늘 수량)</th>
                      <th>마지막 갱신</th>
                      <th>연결 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => (
                      <tr key={r.restaurant_id} aria-label={r.name}>
                        <td>{r.freshness === 'fresh' ? i + 1 : '—'}</td>
                        <td>
                          {r.name}
                          {r.freshness === 'delayed' && <span className="admin-badge warn">데이터 갱신 지연</span>}
                          {!test && !r.public_rank_allowed && r.freshness === 'fresh' && (
                            <span className="admin-badge">소비자 순위 미반영</span>
                          )}
                          {channel === 'DELIVERY' && Object.keys(r.by_provider).length > 0 && (
                            <div className="admin-muted">
                              {Object.entries(r.by_provider)
                                .map(([p, n]) => `${PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] ?? p} ${n}`)
                                .join(' · ')}{' '}
                              (최근 60분)
                            </div>
                          )}
                        </td>
                        <td>{r.c10}</td>
                        <td>{r.c30}</td>
                        <td>{r.c60}</td>
                        <td>{r.c_lunch}</td>
                        <td>{r.top_menus.length ? r.top_menus.map((m) => `${m.name} ${m.quantity}`).join(', ') : '—'}</td>
                        <td className="admin-muted">
                          집계 {fmtTime(r.as_of)}
                          <br />
                          마지막 주문 {fmtTime(r.last_order_at)}
                        </td>
                        <td>
                          {r.connections.map((c) => (
                            <div key={c.provider}>
                              {PROVIDER_LABEL[c.provider]} {STATUS_LABEL[c.status]}
                              {!c.public_allowed && <span className="admin-muted"> (공개 불허)</span>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="admin-muted">
              유효 주문 건수(취소·결제실패·중복 제외). 관리자는 정확한 건수를 보고, 소비자 화면은 최소 공개 건수 미만을 숨겨요. 점심 = 오늘
              11~14시(한국시간).
            </p>
          </div>
          <div className="admin-card">
            <h2>주문 데이터가 없는 매장 ({noData.length})</h2>
            {noData.length === 0 ? (
              <p className="admin-muted">없어요.</p>
            ) : (
              <ul aria-label="주문 데이터가 없는 매장">
                {noData.map((r) => (
                  <li key={r.restaurant_id}>
                    {r.name}
                    <span className="admin-muted">
                      {' '}
                      ·{' '}
                      {r.connections.length
                        ? r.connections.map((c) => `${PROVIDER_LABEL[c.provider]} ${STATUS_LABEL[c.status]}`).join(', ')
                        : `${CHANNEL_LABEL[channel]} 연동 없음`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
