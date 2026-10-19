import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMarketAnalysis, fetchMarketAreas, fetchMarketCompare } from '../lib/market/marketApi';
import {
  analysisToCsv,
  bandLabel,
  change,
  CHANNEL_NAME,
  count,
  DOW_LABEL,
  hhmm,
  kstTime,
  PERIOD_LABEL,
  periodRange,
  pct,
  PUBLIC_SOURCE_LABEL,
  RELIABILITY_LABEL,
  slotRange,
  won,
} from '../lib/market/format';
import type { MarketAnalysis, MarketAreaListItem, MarketChannel, MarketCompare, MarketPeriod } from '../lib/market/types';
import { Bars, StackBar } from './Bars';
import './market.css';

const PERIODS: MarketPeriod[] = ['today', '7d', '30d', '90d'];
const CHANNELS: MarketChannel[] = ['HALL', 'DELIVERY', 'PICKUP'];
const TEST_LOCATION_KEY = 'mwomeok.testLocation';

function readTestLocation(): string | null {
  try {
    return sessionStorage.getItem(TEST_LOCATION_KEY);
  } catch {
    return null;
  }
}

/**
 * 상권 분석 화면 — 사업자(/business/market)와 관리자(상권 분석 → 분석 조회)가 함께 쓴다.
 * 모든 수치는 서버에서 집계된 값이며, 실제 주문이 없으면 수치 대신 ‘분석할 데이터가 부족합니다’를 보여준다.
 */
export function MarketDashboard({ client, role }: { client: SupabaseClient; role: 'admin' | 'business' }) {
  const admin = role === 'admin';
  const [areas, setAreas] = useState<MarketAreaListItem[] | null>(null);
  const [areaId, setAreaId] = useState<string>('');
  const [period, setPeriod] = useState<MarketPeriod>('7d');
  const [test, setTest] = useState(false);
  const [asBusiness, setAsBusiness] = useState(false);
  const [data, setData] = useState<MarketAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [halfHour, setHalfHour] = useState(false);
  const [compare, setCompare] = useState<MarketCompare | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareBusy, setCompareBusy] = useState(false);
  const testLocation = admin ? readTestLocation() : null;

  useEffect(() => {
    fetchMarketAreas(client)
      .then((list) => {
        setAreas(list);
        setCompareIds(list.map((a) => a.id));
        // 관리자 테스트 위치(선릉·역삼·판교·여의도)를 골라 두었으면 그 상권부터
        const preferred = testLocation && list.some((a) => a.id === testLocation) ? testLocation : list[0]?.id;
        setAreaId((cur) => cur || preferred || '');
      })
      .catch((e: Error) => setError(e.message));
  }, [client, testLocation]);

  const load = useCallback(() => {
    if (!areaId) return;
    setLoading(true);
    setError(null);
    fetchMarketAnalysis(client, { areaId, period, test, asBusiness })
      .then(setData)
      .catch((e: Error) => {
        setData(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [client, areaId, period, test, asBusiness]);
  useEffect(load, [load]);
  useEffect(() => setCompare(null), [period, test, asBusiness]);

  const runCompare = () => {
    setCompareBusy(true);
    fetchMarketCompare(client, compareIds, { period, test, asBusiness })
      .then(setCompare)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCompareBusy(false));
  };

  const downloadCsv = () => {
    if (!data) return;
    const blob = new Blob([analysisToCsv(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `상권분석_${data.area.name}_${PERIOD_LABEL[data.period.key]}${data.scope === 'test' ? '_테스트' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const areaName = areas?.find((a) => a.id === areaId)?.name ?? '';

  return (
    <div className="mk">
      <section className="mk-controls" aria-label="분석 조건">
        <div className="mk-chips" role="radiogroup" aria-label="분석지역">
          {(areas ?? []).map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={areaId === a.id}
              className={areaId === a.id ? 'mk-chip active' : 'mk-chip'}
              onClick={() => setAreaId(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
        <div className="mk-seg" role="radiogroup" aria-label="분석 기간">
          {PERIODS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        {admin && (
          <div className={test ? 'mk-admin-row test' : 'mk-admin-row'}>
            <label>
              <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> 테스트 데이터
            </label>
            {!test && (
              <label>
                <input type="checkbox" checked={asBusiness} onChange={(e) => setAsBusiness(e.target.checked)} /> 사업자 화면과 같은 범위로 보기
              </label>
            )}
            {testLocation && areaName && <span className="mk-muted">테스트 위치 기준으로 열었어요</span>}
            <button type="button" className="mk-btn" onClick={downloadCsv} disabled={!data}>
              CSV 통계 다운로드
            </button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="mk-error">
          불러오지 못했어요: {error}
        </p>
      )}
      {!data && !error && <p className="mk-muted">{areas && areas.length === 0 ? '볼 수 있는 분석지역이 없어요.' : '불러오는 중…'}</p>}
      {data && <Analysis a={data} loading={loading} halfHour={halfHour} setHalfHour={setHalfHour} admin={admin} />}

      {data && (
        <section className="mk-card" aria-label="다른 지역과 비교">
          <h2>다른 지역과 비교</h2>
          <div className="mk-chips small">
            {(areas ?? []).map((a) => (
              <label key={a.id} className="mk-check">
                <input
                  type="checkbox"
                  checked={compareIds.includes(a.id)}
                  onChange={(e) => setCompareIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                />
                {a.name}
              </label>
            ))}
          </div>
          <button type="button" className="mk-btn" onClick={runCompare} disabled={compareBusy || compareIds.length < 2}>
            {compareBusy ? '계산 중…' : `${PERIOD_LABEL[period]} 지역 비교`}
          </button>
          {compare && <CompareTable c={compare} />}
        </section>
      )}
    </div>
  );
}

function Analysis({
  a,
  loading,
  halfHour,
  setHalfHour,
  admin,
}: {
  a: MarketAnalysis;
  loading: boolean;
  halfHour: boolean;
  setHalfHour: (v: boolean) => void;
  admin: boolean;
}) {
  const none = a.reliability.status === 'none';
  const lunch = `${hhmm(a.lunch.start_min)}~${hhmm(a.lunch.end_min)}`;
  const known = a.channels.reduce((s, c) => s + c.orders, 0);
  const peak = [...a.slots_hour].filter((h) => h.orders > 0).sort((x, y) => y.orders - x.orders)[0];
  const topCat = a.categories[0];
  const delivery = a.channels.find((c) => c.channel === 'DELIVERY');

  return (
    <div className={loading ? 'mk-body loading' : 'mk-body'} aria-busy={loading}>
      <section className="mk-card mk-head" aria-label="분석 개요">
        <h2>
          {a.area.name}
          {a.scope === 'test' && <span className="mk-tag test">테스트 데이터</span>}
          {a.scope === 'internal' && <span className="mk-tag">내부 전체 데이터</span>}
        </h2>
        <dl className="mk-facts">
          <div>
            <dt>상권 범위</dt>
            <dd>
              {a.area.label} · 약 {a.area.area_km2}㎢
            </dd>
          </div>
          <div>
            <dt>분석 기간</dt>
            <dd>
              {PERIOD_LABEL[a.period.key]} · {periodRange(a)} · 점심 {lunch}(한국시간)
            </dd>
          </div>
          <div>
            <dt>데이터 기준시각</dt>
            <dd>
              마지막 수집 {kstTime(a.as_of)} · 집계 {kstTime(a.refreshed_at)}
            </dd>
          </div>
          <div>
            <dt>데이터 수집상태</dt>
            <dd>
              <span className={`mk-status ${a.reliability.status}`}>{RELIABILITY_LABEL[a.reliability.status]}</span>
              {a.reliability.reasons.length > 0 && <span className="mk-muted"> {a.reliability.reasons.join(' · ')}</span>}
            </dd>
          </div>
        </dl>
        {a.reliability.warnings.length > 0 && (
          <ul className="mk-warnings" aria-label="분석 시 주의">
            {a.reliability.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {none ? (
        <section className="mk-card mk-empty" aria-label="분석 결과">
          <p className="mk-empty-title">분석할 데이터가 부족합니다</p>
          <p className="mk-muted">
            이 상권·기간에 확인된 실제 주문이 없어요. 가상 수치로 채우지 않아요. 데이터 제공 매장이 늘거나 기간을 넓히면 분석할 수 있어요.
          </p>
        </section>
      ) : (
        <>
          <section className="mk-tiles" aria-label="핵심 지표">
            <Tile label="데이터 제공 매장" value={count(a.coverage.providing_stores, '곳')} sub={`영업 확인 ${a.coverage.operating}곳 중`} />
            <Tile label="유효 주문" value={count(a.totals.orders)} sub={`${a.period.compare_label} ${change(a.totals.orders_change_pct)}`} />
            <Tile label="평균 주문금액" value={won(a.totals.avg)} sub={`중앙값 ${won(a.totals.median)}`} />
            {CHANNELS.map((ch) => {
              const c = a.channels.find((x) => x.channel === ch);
              return <Tile key={ch} label={`${CHANNEL_NAME[ch]} 주문 비중`} value={pct(c?.share)} sub={count(c?.orders)} />;
            })}
            <Tile label="가장 많이 팔린 음식 종류" value={topCat?.category ?? '—'} sub={topCat ? `${count(topCat.orders)} · ${topCat.stores}곳` : ''} />
            <Tile label="주문 집중 시간" value={peak ? slotRange(peak.from_slot, peak.to_slot) : '—'} sub={peak ? count(peak.orders) : ''} />
            <Tile label="데이터 수집률" value={pct(a.coverage.rate)} sub="참고 지표" />
          </section>

          <section className="mk-card" aria-label="평균 주문금액">
            <h2>점심 평균 주문금액</h2>
            <p className="mk-muted">
              금액 기준: 메뉴 판매금액 기준 순결제금액(할인·환불 반영, 배달비 제외). 주문 1건의 금액이며 1인당 식사비가 아니에요 (한 주문에 여러
              인분이 있을 수 있어요).
            </p>
            <div className="mk-scroll">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>채널</th>
                    <th>유효 주문</th>
                    <th>평균</th>
                    <th>중앙값</th>
                    <th>평균 변화</th>
                  </tr>
                </thead>
                <tbody>
                  {a.channels.map((c) => (
                    <tr key={c.channel}>
                      <th>{CHANNEL_NAME[c.channel]}</th>
                      <td>{count(c.orders)}</td>
                      <td>{won(c.avg)}</td>
                      <td>{won(c.median)}</td>
                      <td>{change(c.avg_change_pct)}</td>
                    </tr>
                  ))}
                  <tr className="mk-total">
                    <th>전체 유효 주문금액</th>
                    <td>{count(a.totals.orders)}</td>
                    <td colSpan={3}>
                      합계 {won(a.totals.amount_sum)} · 평균 변화 {change(a.totals.avg_change_pct)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {a.totals.excluded_amount_orders > 0 && (
              <p className="mk-muted">금액 기준을 확인할 수 없는 주문 {count(a.totals.excluded_amount_orders)}은 건수에만 넣고 금액 분석에서는 뺐어요.</p>
            )}
            {a.reliability.status === 'insufficient' && <p className="mk-note">표본이 부족해 이 금액을 상권 전체 평균으로 볼 수 없어요.</p>}
          </section>

          <section className="mk-card" aria-label="홀·배달·포장 비교">
            <h2>홀·배달·포장 주문 구성</h2>
            <StackBar
              label="채널별 주문 구성"
              parts={a.channels.map((c) => ({ key: c.channel, label: CHANNEL_NAME[c.channel], value: c.orders, className: c.channel.toLowerCase() }))}
            />
            <p className="mk-muted">
              데이터를 제공한 매장의 주문 구성이에요. 채널마다 자료를 주는 매장이 달라 이 상권 전체의 홀·배달·포장 점유율이 아니에요.
            </p>
            <div className="mk-grid3">
              {a.channels.map((c) => (
                <div key={c.channel} className="mk-sub" aria-label={`${CHANNEL_NAME[c.channel]} 분석`}>
                  <h3>{c.channel === 'DELIVERY' ? `${a.area.name.replace(/ 주변$/, '')} 소재 매장의 배달 주문` : `${CHANNEL_NAME[c.channel]} 주문`}</h3>
                  <p>
                    {count(c.orders)} · 평균 {won(c.avg)} · 주문 있는 매장 {c.stores}곳
                  </p>
                  <p className="mk-muted">
                    주문 변화 {change(c.orders_change_pct)} · 집중 시간 {c.peak_slot !== null ? slotRange(c.peak_slot) : '—'}
                  </p>
                  {c.top_menus.length > 0 && <p className="mk-muted">인기메뉴 {c.top_menus.map((m) => `${m.name} ${m.quantity}`).join(', ')}</p>}
                  {c.channel === 'DELIVERY' && known > 0 && (
                    <p className="mk-muted">
                      주문 출처{' '}
                      {(['baemin', 'coupangeats', 'pos', 'csv'] as const)
                        .filter((p) => c.providers[p])
                        .map((p) => `${{ baemin: '배민', coupangeats: '쿠팡이츠', pos: 'POS', csv: '매장 자료' }[p]} ${c.providers[p]}`)
                        .join(' · ') || '없음'}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {delivery && delivery.orders > 0 && (
              <p className="mk-muted">배달 주문은 이 상권 안 매장에서 나간 주문이에요. 받는 고객의 위치는 알 수 없어요.</p>
            )}
          </section>

          <section className="mk-card" aria-label="가격대별 주문">
            <h2>가격대별 주문 비중 (주문금액)</h2>
            <Bars
              label="가격대별 주문 비중"
              items={a.price_bands.map((b) => ({
                key: `${b.lo}`,
                label: bandLabel(b.lo, b.hi),
                value: b.orders,
                display: `${pct(b.pct)} · ${count(b.orders)}`,
                sub: `${a.period.key === '7d' ? '전주' : '비교 기간'} 대비 ${b.change_pp === null ? '비교 자료 없음' : `${b.change_pp > 0 ? '+' : ''}${b.change_pp}%p`} · ${CHANNELS.map((ch) => `${CHANNEL_NAME[ch]} ${pct(b.by_channel[ch]?.pct)}`).join(' · ')}`,
              }))}
            />
            <h3>메뉴 판매단가 분포 (메뉴 1개 단가)</h3>
            {a.menu_unit_prices ? (
              <Bars
                label="메뉴 판매단가 분포"
                items={a.menu_unit_prices.bands.map((b) => ({
                  key: `${b.lo}`,
                  label: bandLabel(b.lo, b.hi),
                  value: b.quantity,
                  display: `${pct(b.pct)} · ${count(b.quantity, '개')}`,
                }))}
              />
            ) : (
              <p className="mk-muted">메뉴별 단가·수량 자료가 없어 판매단가 분석을 제공하지 않아요.</p>
            )}
            <p className="mk-muted">주문금액(한 번에 낸 금액)과 메뉴 단가는 따로 봐요. 2인분 20,000원 주문은 주문금액 구간에, 메뉴는 10,000원 단가로 들어가요.</p>
          </section>

          <section className="mk-card" aria-label="시간대별 주문">
            <h2>시간대별 주문</h2>
            <div className="mk-seg small" role="radiogroup" aria-label="시간 단위">
              <button type="button" role="radio" aria-checked={!halfHour} className={!halfHour ? 'active' : ''} onClick={() => setHalfHour(false)}>
                1시간
              </button>
              <button type="button" role="radio" aria-checked={halfHour} className={halfHour ? 'active' : ''} onClick={() => setHalfHour(true)}>
                30분
              </button>
            </div>
            <Bars
              label="시간대별 주문 건수"
              items={(halfHour ? a.slots_half.map((s) => ({ ...s, from_slot: s.slot, to_slot: s.slot + 1 })) : a.slots_hour).map((s) => ({
                key: `${s.from_slot}`,
                label: slotRange(s.from_slot, s.to_slot),
                value: s.orders,
                display: count(s.orders),
                highlight: !!peak && s.from_slot === peak.from_slot && !halfHour,
                sub: `금액 ${won(s.amount_sum)} · 평균 ${won(s.avg)}${s.top_menu ? ` · 인기 ${s.top_menu}` : ''} · ${CHANNELS.map((ch) => `${CHANNEL_NAME[ch]} ${s.channels[ch] ?? 0}`).join(' / ')}`,
              }))}
            />
            <p className="mk-muted">주문 건수는 주문 발생시각 기준이에요. 착석 인원·대기시간은 수집하지 않아 표시하지 않아요.</p>
          </section>

          <section className="mk-card" aria-label="인기 음식 종류">
            <h2>인기 음식 종류</h2>
            <Bars
              label="음식 종류별 주문"
              items={a.categories.map((c) => ({
                key: c.category,
                label: c.category,
                value: c.orders,
                display: `${pct(c.pct)} · ${count(c.orders)}`,
                sub: `데이터 제공 매장 ${c.stores}곳 · 평균 ${won(c.avg)}`,
              }))}
            />
            <p className="mk-muted">
              {CHANNELS.map((ch) => {
                const best = [...a.categories].sort((x, y) => (y.by_channel[ch] ?? 0) - (x.by_channel[ch] ?? 0))[0];
                return `${CHANNEL_NAME[ch]} 인기: ${best && (best.by_channel[ch] ?? 0) > 0 ? best.category : '—'}`;
              }).join(' · ')}
            </p>
            <p className="mk-muted">제공 매장이 많은 업종은 주문 건수가 크게 보일 수 있어 매장 수와 함께 보세요.</p>
          </section>

          <section className="mk-card" aria-label="인기메뉴">
            <h2>인기메뉴 (판매 수량)</h2>
            {a.menus.items.length === 0 ? (
              <p className="mk-muted">메뉴별 판매 자료가 아직 없어요.</p>
            ) : (
              <ol className="mk-menus">
                {a.menus.items.map((m) => (
                  <li key={m.name}>
                    <span className="mk-menu-name">
                      {m.name}
                      {m.grouped && <span className="mk-tag">공통 분류</span>}
                    </span>
                    <span className="mk-menu-qty">{count(m.quantity, '개')}</span>
                    <span className="mk-muted mk-menu-sub">
                      평균 단가 {won(m.avg_unit_price)} · 판매금액 {won(m.amount_sum)} · {m.stores}곳 ·{' '}
                      {CHANNELS.filter((ch) => m.by_channel[ch]).map((ch) => `${CHANNEL_NAME[ch]} ${m.by_channel[ch]}`).join(' / ')} · 많이 팔린 시간{' '}
                      {m.peak_slot !== null ? slotRange(m.peak_slot) : '—'} · 변화 {change(m.change_pct)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {a.menus.unclassified_quantity > 0 && (
              <p className="mk-muted">분류 미확인 메뉴 {count(a.menus.unclassified_quantity, '개')}는 순위에서 뺐어요 (매장 메뉴와 연결되지 않음).</p>
            )}
            <p className="mk-muted">이름이 비슷해도 다른 메뉴는 합치지 않아요. 같은 이름이거나 관리자가 확인한 공통 분류만 묶어요.</p>
          </section>

          <section className="mk-card" aria-label="요일별 주문">
            <h2>요일별 주문</h2>
            <TodayVsLastWeek a={a} />
            {a.weekdays ? (
              <>
                <Bars
                  label="요일별 평균 주문 건수"
                  items={a.weekdays.map((d) => ({
                    key: `${d.dow}`,
                    label: `${DOW_LABEL[d.dow]}요일`,
                    value: d.avg_orders ?? 0,
                    display: d.observed_days === 0 ? '자료 없음' : `하루 평균 ${count(d.avg_orders)}`,
                    sub:
                      d.observed_days === 0
                        ? '수집된 날이 없어요 (0건으로 보지 않음)'
                        : `자료 있는 날 ${d.observed_days}일 · 평균 ${won(d.avg)}${d.top_menu ? ` · 인기 ${d.top_menu}` : ''} · ${CHANNELS.map((ch) => `${CHANNEL_NAME[ch]} ${d.channels[ch] ?? 0}`).join(' / ')}`,
                  }))}
                />
                <WeekdayWeekend a={a} />
              </>
            ) : (
              <p className="mk-muted">요일별 비교는 최근 7일 이상을 고르면 볼 수 있어요.</p>
            )}
          </section>
        </>
      )}

      <section className="mk-card" aria-label="데이터 수집률">
        <h2>데이터 수집률·신뢰도</h2>
        <dl className="mk-facts">
          <div>
            <dt>등록 음식점</dt>
            <dd>{count(a.coverage.registered, '곳')}</dd>
          </div>
          <div>
            <dt>영업 중으로 확인</dt>
            <dd>{count(a.coverage.operating, '곳')}</dd>
          </div>
          {admin && (
            <div>
              <dt>데이터 제공 동의</dt>
              <dd>{count(a.coverage.consented, '곳')}</dd>
            </div>
          )}
          <div>
            <dt>최근 하루 정상 수집</dt>
            <dd>{count(a.coverage.collecting_recent, '곳')}</dd>
          </div>
          <div>
            <dt>기간 내 자료 제공 매장</dt>
            <dd>{count(a.coverage.providing_stores, '곳')}</dd>
          </div>
          <div>
            <dt>자료가 있는 날</dt>
            <dd>
              {a.coverage.data_days}일 / {a.coverage.period_days}일
            </dd>
          </div>
          <div>
            <dt>수집 지연 매장</dt>
            <dd>{count(a.coverage.delayed_stores, '곳')}</dd>
          </div>
          <div>
            <dt>마지막 수집</dt>
            <dd>{kstTime(a.coverage.last_collected_at)}</dd>
          </div>
        </dl>
        <p>
          <strong>{pct(a.coverage.rate)}</strong> <span className="mk-muted">— {a.coverage.rate_label}. 음식점 목록이 완전하지 않을 수 있어 참고 지표예요.</span>
        </p>
        <p className="mk-muted">
          내부 품질 기준: 데이터 제공 매장 {a.reliability.min_stores}곳 이상 · 유효 주문 {a.reliability.min_orders}건 이상 (통계적 대표성을 보장하는 기준은 아니에요)
        </p>
        {admin && a.coverage.delayed_list && (
          <div className="mk-admin-only" aria-label="관리자 확인 항목">
            <h3>관리자 확인</h3>
            <p className="mk-muted">
              메뉴 연결 필요 {count(a.coverage.unmatched_items, '개')} · 중복 확인 필요 {count(a.coverage.needs_review)}
            </p>
            {a.coverage.delayed_list.length === 0 ? (
              <p className="mk-muted">갱신 지연·오류 연결 없음</p>
            ) : (
              <ul>
                {a.coverage.delayed_list.map((d) => (
                  <li key={`${d.name}-${d.provider}`}>
                    {d.name} · {d.provider} · {d.status === 'error' ? `오류 ${d.last_error ?? ''}` : `마지막 수집 ${kstTime(d.last_success_at)}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="mk-card" aria-label="데이터 출처">
        <h2>데이터 출처</h2>
        <p>
          <strong>자체 주문 자료</strong> — 매장·제공업체가 분석 사용을 허락한 홀 POS·배달의민족·쿠팡이츠·포장 주문의 지역 집계. 개별 주문·고객 정보는
          쓰지 않아요.
        </p>
        <h3>공공 상권 자료</h3>
        {a.public_data.length === 0 ? (
          <p className="mk-muted">
            등록된 공공 상권 자료가 없어요{a.area.sido !== '서울특별시' ? ` (${a.area.sido} 지역은 서울시 상권 자료 대상이 아니에요)` : ''}.
          </p>
        ) : (
          <ul className="mk-public" aria-label="공공 상권 자료">
            {a.public_data.map((p, i) => (
              <li key={i}>
                <strong>{PUBLIC_SOURCE_LABEL[p.source]}</strong> · {p.dataset} · {p.metric}
                {p.category ? ` (${p.category})` : ''}: {p.value === null ? '—' : `${Number(p.value).toLocaleString('ko-KR')}${p.unit ?? ''}`}
                <span className="mk-muted">
                  {' '}
                  · 기준 {p.period_label}
                  {p.source_updated_at ? ` · 원자료 갱신 ${p.source_updated_at}` : ''} · 실시간 자료 아님
                  {p.source === 'seoul_realtime' ? ' · 카드사 표본 기반 지역 통계' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mk-muted">공공 자료와 자체 주문 자료는 기준·범위가 달라 합산하지 않아요.</p>
      </section>

      <section className="mk-card" aria-label="분석 시 주의사항">
        <h2>분석 시 주의사항</h2>
        <ul className="mk-cautions">
          <li>데이터를 제공한 매장의 주문만 집계해요. 수집이 적은 지역을 소비력이 낮은 지역으로 판단하지 마세요.</li>
          <li>평균 주문금액은 주문 1건 기준이에요. 고객 수를 알 수 없어 1인당 소비금액이 아니에요.</li>
          <li>배달은 상권 안 매장에서 나간 주문이며, 그 지역 고객의 배달 소비가 아니에요.</li>
          <li>자료가 없는 날은 0건으로 계산하지 않아요. 오늘은 진행 중인 자료라 지난주와는 같은 시각까지만 비교해요.</li>
          <li>표본이 부족하면 상권 순위나 구매력 평가를 하지 않아요.</li>
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mk-tile" aria-label={label}>
      <span className="mk-tile-label">{label}</span>
      <span className="mk-tile-value">{value}</span>
      {sub && <span className="mk-tile-sub">{sub}</span>}
    </div>
  );
}

function TodayVsLastWeek({ a }: { a: MarketAnalysis }) {
  const t = a.today_vs_last_week;
  const cut = hhmm(t.cutoff_slot * 30);
  const lunchStarted = t.cutoff_slot * 30 > a.lunch.start_min;
  return (
    <div className="mk-sub" aria-label="오늘과 지난주 같은 요일">
      <h3>오늘 vs 지난주 같은 요일 ({cut}까지)</h3>
      {!lunchStarted ? (
        <p className="mk-muted">오늘 점심 분석시간이 아직 시작되지 않았어요.</p>
      ) : !t.today_observed || !t.last_week_observed ? (
        <p className="mk-muted">{!t.today_observed ? '오늘' : '지난주 같은 요일'} 자료가 없어 비교하지 않아요 (0건으로 보지 않음).</p>
      ) : (
        <p>
          오늘 {count(t.today_orders)}(매장 {t.today_stores}곳, 평균 {won(t.today_avg)}) · 지난주 {count(t.last_week_orders)}(매장{' '}
          {t.last_week_stores}곳, 평균 {won(t.last_week_avg)})
        </p>
      )}
    </div>
  );
}

function WeekdayWeekend({ a }: { a: MarketAnalysis }) {
  const sum = (dows: number[]) => {
    const ds = (a.weekdays ?? []).filter((d) => dows.includes(d.dow));
    const days = ds.reduce((s, d) => s + d.observed_days, 0);
    return days ? ds.reduce((s, d) => s + d.orders, 0) / days : null;
  };
  const wk = sum([1, 2, 3, 4, 5]);
  const we = sum([6, 7]);
  return (
    <p className="mk-muted">
      평일 하루 평균 {count(wk)} · 주말 하루 평균 {we === null ? '자료 없음' : count(we)}
    </p>
  );
}

function CompareTable({ c }: { c: MarketCompare }) {
  return (
    <div aria-label="지역 비교 결과">
      {!c.comparable && (
        <p className="mk-note" role="note">
          지역마다 분석 범위가 달라요 ({c.units.join(' / ')}). 수치를 직접 비교하지 마세요.
        </p>
      )}
      <p className="mk-muted">
        같은 기간 · {c.comparable ? c.units[0] : '서로 다른 범위'} 기준. 데이터 제공 매장 수가 달라 주문 건수로 순위를 매기지 않아요.
      </p>
      <div className="mk-scroll">
        <table className="mk-table mk-compare">
          <thead>
            <tr>
              <th>지표</th>
              {c.areas.map((r) => (
                <th key={r.area.id}>{r.area.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="신뢰상태" cells={c.areas.map((r) => RELIABILITY_LABEL[r.reliability.status])} />
            <Row label="분석 범위" cells={c.areas.map((r) => r.area.label)} />
            <Row label="수집된 음식점" cells={c.areas.map((r) => count(r.coverage.registered, '곳'))} />
            <Row label="데이터 제공 매장" cells={c.areas.map((r) => count(r.coverage.providing_stores, '곳'))} />
            <Row label="데이터 수집률" cells={c.areas.map((r) => pct(r.coverage.rate))} />
            <Row label="유효 주문" cells={c.areas.map((r) => count(r.totals.orders))} />
            <Row label="매장·수집일당 주문 (보조)" cells={c.areas.map((r) => (r.totals.orders_per_store_day === null ? '—' : `${r.totals.orders_per_store_day}건`))} />
            <Row label="평균 주문금액" cells={c.areas.map((r) => won(r.totals.avg))} />
            <Row label="주문금액 중앙값" cells={c.areas.map((r) => won(r.totals.median))} />
            <Row label="인기 음식 종류" cells={c.areas.map((r) => r.top_category ?? '—')} />
            <Row label="인기메뉴" cells={c.areas.map((r) => r.top_menu ?? '—')} />
            <Row label="점심 주문 집중 시간" cells={c.areas.map((r) => (r.peak_hour ? slotRange(r.peak_hour.from_slot, r.peak_hour.to_slot) : '—'))} />
            {CHANNELS.map((ch) => (
              <Row key={ch} label={`${CHANNEL_NAME[ch]} 주문 비중`} cells={c.areas.map((r) => pct(r.channels.find((x) => x.channel === ch)?.share))} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr>
      <th>{label}</th>
      {cells.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  );
}
