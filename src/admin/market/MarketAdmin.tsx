import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MarketDashboard } from '../../market/MarketDashboard';
import { fetchMarketCompare } from '../../lib/market/marketApi';
import { hhmm, kstTime, pct, PERIOD_LABEL, PUBLIC_SOURCE_LABEL, RELIABILITY_LABEL } from '../../lib/market/format';
import type { MarketCompare, MarketPeriod, MarketPublicData, PublicSource } from '../../lib/market/types';
import {
  addPublicData,
  deletePublicData,
  fetchMarketSettings,
  listAreas,
  listBusinessUsers,
  listPublicData,
  parseBoundary,
  parsePriceBands,
  rebuildMarketStats,
  saveArea,
  saveMarketSettings,
  setBusinessUser,
  type BusinessUser,
  type MarketArea,
  type MarketSettings,
} from './marketAdminApi';

type Sub = 'analysis' | 'areas' | 'coverage' | 'settings' | 'public' | 'business';

const SUBS: { key: Sub; label: string }[] = [
  { key: 'analysis', label: '분석 조회' },
  { key: 'coverage', label: '수집률·오류' },
  { key: 'areas', label: '분석지역' },
  { key: 'settings', label: '분석 설정' },
  { key: 'public', label: '공공데이터' },
  { key: 'business', label: '사업자 계정' },
];

/** 관리자 → 상권 분석 */
export function MarketAdmin({ client }: { client: SupabaseClient }) {
  const [sub, setSub] = useState<Sub>('analysis');
  return (
    <section aria-label="상권 분석 관리">
      <nav className="admin-subtabs" aria-label="상권 분석 메뉴">
        {SUBS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-current={sub === s.key ? 'page' : undefined}
            className={sub === s.key ? 'admin-subtab active' : 'admin-subtab'}
            onClick={() => setSub(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {sub === 'analysis' && <MarketDashboard client={client} role="admin" />}
      {sub === 'coverage' && <CoverageAdmin client={client} />}
      {sub === 'areas' && <AreasAdmin client={client} />}
      {sub === 'settings' && <SettingsAdmin client={client} />}
      {sub === 'public' && <PublicDataAdmin client={client} />}
      {sub === 'business' && <BusinessUsersAdmin client={client} />}
    </section>
  );
}

// ───────── 수집률·오류 ─────────
function CoverageAdmin({ client }: { client: SupabaseClient }) {
  const [period, setPeriod] = useState<MarketPeriod>('7d');
  const [test, setTest] = useState(false);
  const [c, setC] = useState<MarketCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setC(null);
    listAreas(client)
      .then((areas) => fetchMarketCompare(client, areas.filter((a) => a.is_active).map((a) => a.id), { period, test }))
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [client, period, test]);
  useEffect(load, [load]);

  const rebuild = async () => {
    const today = new Date(Date.now() + 9 * 3600000);
    const to = today.toISOString().slice(0, 10);
    const from = new Date(today.getTime() - 180 * 86400000).toISOString().slice(0, 10);
    try {
      const n = await rebuildMarketStats(client, from, to);
      setMessage(`최근 180일을 다시 집계했어요 (집계 행 ${n}개).`);
      load();
    } catch (e) {
      setMessage(`다시 집계하지 못했어요: ${(e as Error).message}`);
    }
  };

  return (
    <section aria-label="지역별 수집률">
      <div className={test ? 'admin-scope test' : 'admin-scope'}>
        <label className="admin-switch">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> 테스트 데이터
        </label>
        <select aria-label="기간" value={period} onChange={(e) => setPeriod(e.target.value as MarketPeriod)} style={{ width: 'auto' }}>
          {(['today', '7d', '30d', '90d'] as MarketPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL[p]}
            </option>
          ))}
        </select>
        <button type="button" className="admin-btn" onClick={rebuild}>
          통계 다시 집계
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">불러오지 못했어요: {error}</p>}
      {!c && !error && <p>불러오는 중…</p>}
      {c && (
        <>
          <div className="admin-card admin-scroll">
            <h2>지역별 주문 수집률</h2>
            <table className="admin-table" aria-label="지역별 수집률">
              <thead>
                <tr>
                  <th>지역</th>
                  <th>등록</th>
                  <th>영업 확인</th>
                  <th>제공 동의</th>
                  <th>최근 정상 수집</th>
                  <th>기간 내 제공</th>
                  <th>자료 있는 날</th>
                  <th>지연·오류</th>
                  <th>마지막 수집</th>
                  <th>제공 비율</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {c.areas.map((r) => (
                  <tr key={r.area.id} aria-label={r.area.name}>
                    <th>
                      {r.area.name}
                      <div className="admin-muted">{r.area.label}</div>
                    </th>
                    <td>{r.coverage.registered}</td>
                    <td>{r.coverage.operating}</td>
                    <td>{r.coverage.consented}</td>
                    <td>{r.coverage.collecting_recent}</td>
                    <td>{r.coverage.providing_stores}</td>
                    <td>
                      {r.coverage.data_days}/{r.coverage.period_days}일
                    </td>
                    <td>{r.coverage.delayed_stores}</td>
                    <td className="admin-muted">{kstTime(r.coverage.last_collected_at)}</td>
                    <td>{pct(r.coverage.rate)}</td>
                    <td>{RELIABILITY_LABEL[r.reliability.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="admin-muted">제공 비율 = 영업 중으로 확인된 음식점 중 기간 내 주문 자료를 제공한 매장. 음식점 목록이 완전하지 않으면 참고 지표예요.</p>
          </div>
          <div className="admin-card">
            <h2>데이터 오류·갱신 지연</h2>
            {c.areas.map((r) => (
              <div key={r.area.id}>
                <h3>{r.area.name}</h3>
                <p className="admin-muted">
                  메뉴 연결 필요 {r.coverage.unmatched_items ?? 0}개 · 중복 확인 필요 {r.coverage.needs_review ?? 0}건
                  {r.totals.excluded_amount_orders > 0 && ` · 금액 기준 미확인 ${r.totals.excluded_amount_orders}건 (연동 관리에서 금액 기준 지정)`}
                </p>
                {(r.coverage.delayed_list ?? []).length === 0 ? (
                  <p className="admin-muted">지연·오류 연결 없음</p>
                ) : (
                  <ul>
                    {(r.coverage.delayed_list ?? []).map((d) => (
                      <li key={`${d.name}-${d.provider}`}>
                        {d.name} · {d.provider} ·{' '}
                        {d.status === 'error' ? <span className="admin-error">오류 {d.last_error}</span> : `마지막 수집 ${kstTime(d.last_success_at)}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ───────── 분석지역 ─────────
const EMPTY_AREA: MarketArea = {
  id: '',
  name: '',
  sido: '서울특별시',
  center_lat: 37.5,
  center_lng: 127.0,
  spatial_mode: 'radius',
  radius_m: 500,
  boundary_geojson: null,
  boundary_source: null,
  is_active: true,
  business_visible: true,
  sort_order: 100,
  seoul_realtime_place: null,
  seoul_realtime_verified: false,
  note: null,
};

function AreasAdmin({ client }: { client: SupabaseClient }) {
  const [areas, setAreas] = useState<MarketArea[] | null>(null);
  const [editing, setEditing] = useState<{ area: MarketArea; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    listAreas(client)
      .then(setAreas)
      .catch((e: Error) => setError(e.message));
  }, [client]);
  useEffect(load, [load]);

  if (editing) {
    return (
      <AreaForm
        client={client}
        area={editing.area}
        isNew={editing.isNew}
        onClose={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }
  return (
    <section aria-label="분석지역 관리">
      {error && <p role="alert">{error}</p>}
      <button type="button" className="admin-btn primary" onClick={() => setEditing({ area: EMPTY_AREA, isNew: true })}>
        + 분석지역 추가
      </button>
      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>지역</th>
              <th>분석 범위</th>
              <th>사업자 공개</th>
              <th>서울시 실시간 상권</th>
            </tr>
          </thead>
          <tbody>
            {(areas ?? []).map((a) => (
              <tr key={a.id}>
                <td>
                  <button type="button" className="admin-link strong" onClick={() => setEditing({ area: a, isNew: false })}>
                    {a.name}
                  </button>
                  <div className="admin-muted">
                    {a.id} · {a.sido}
                    {!a.is_active && ' · 사용 안 함'}
                  </div>
                </td>
                <td>{a.spatial_mode === 'boundary' ? `확인된 경계${a.boundary_source ? ` (${a.boundary_source})` : ''}` : `반경 ${a.radius_m}m`}</td>
                <td>{a.business_visible ? '공개' : '비공개'}</td>
                <td>{a.seoul_realtime_verified ? a.seoul_realtime_place : '확인 전'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="admin-muted">지역을 비교할 때는 같은 반경(또는 비교 가능한 경계)을 쓰세요. 범위가 다르면 비교 화면에 표시돼요.</p>
      </div>
    </section>
  );
}

function AreaForm({ client, area, isNew, onClose }: { client: SupabaseClient; area: MarketArea; isNew: boolean; onClose: () => void }) {
  const [v, setV] = useState<MarketArea>(area);
  const [boundaryText, setBoundaryText] = useState(area.boundary_geojson ? JSON.stringify(area.boundary_geojson) : '');
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof MarketArea>(k: K, val: MarketArea[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-z0-9_]{2,40}$/.test(v.id)) return setMessage('지역 ID는 영문 소문자·숫자·밑줄 2~40자예요.');
    if (!v.name.trim()) return setMessage('지역 이름을 넣어 주세요.');
    const b = parseBoundary(boundaryText);
    if (!b.ok) return setMessage(b.error);
    if (v.spatial_mode === 'boundary' && !b.value) return setMessage('경계 방식은 확인된 상권 경계(GeoJSON)가 필요해요.');
    if (v.seoul_realtime_verified && v.sido !== '서울특별시') return setMessage('서울시 실시간 상권현황은 서울 지역만 해당돼요.');
    if (v.seoul_realtime_verified && !v.seoul_realtime_place?.trim()) return setMessage('공식 장소명을 넣어 주세요.');
    try {
      await saveArea(client, { ...v, name: v.name.trim(), boundary_geojson: b.value }, isNew);
      setMessage('저장했어요.');
      onClose();
    } catch (err) {
      setMessage(`저장하지 못했어요: ${(err as Error).message}`);
    }
  };

  return (
    <form className="admin-card admin-form" onSubmit={submit} aria-label={isNew ? '분석지역 추가' : `${area.name} 수정`}>
      <button type="button" className="admin-link" onClick={onClose}>
        ‹ 목록
      </button>
      <div className="admin-row">
        <label>
          지역 ID
          <input value={v.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.trim())} placeholder="gangnam" />
        </label>
        <label>
          지역 이름
          <input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="강남역 주변" />
        </label>
        <label>
          시·도
          <select value={v.sido} onChange={(e) => set('sido', e.target.value)}>
            {['서울특별시', '경기도', '인천광역시', '부산광역시', '기타'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="admin-row">
        <label>
          중심 위도
          <input inputMode="decimal" value={v.center_lat} onChange={(e) => set('center_lat', Number(e.target.value))} />
        </label>
        <label>
          중심 경도
          <input inputMode="decimal" value={v.center_lng} onChange={(e) => set('center_lng', Number(e.target.value))} />
        </label>
      </div>
      <div className="admin-row">
        <label>
          분석 범위
          <select value={v.spatial_mode} onChange={(e) => set('spatial_mode', e.target.value as MarketArea['spatial_mode'])}>
            <option value="radius">기준점 반경</option>
            <option value="boundary">확인된 상권 경계</option>
          </select>
        </label>
        <label>
          반경(m)
          <select value={[500, 1000].includes(v.radius_m) ? v.radius_m : 'custom'} onChange={(e) => e.target.value !== 'custom' && set('radius_m', Number(e.target.value))}>
            <option value={500}>500m (기본)</option>
            <option value={1000}>1km</option>
            <option value="custom">직접 입력</option>
          </select>
        </label>
        <label>
          반경 직접 입력(m)
          <input inputMode="numeric" value={v.radius_m} onChange={(e) => set('radius_m', Math.round(Number(e.target.value) || 0))} />
        </label>
      </div>
      <label>
        상권 경계 GeoJSON (Polygon·MultiPolygon, 경도·위도 순)
        <textarea rows={3} value={boundaryText} onChange={(e) => setBoundaryText(e.target.value)} />
      </label>
      <label>
        경계 출처 (예: 서울시 상권분석서비스 상권 코드)
        <input value={v.boundary_source ?? ''} onChange={(e) => set('boundary_source', e.target.value || null)} />
      </label>
      <label>
        서울시 실시간 상권현황 공식 장소명 (공식 제공 장소 목록에서 확인한 경우만)
        <input value={v.seoul_realtime_place ?? ''} onChange={(e) => set('seoul_realtime_place', e.target.value || null)} />
      </label>
      <label className="admin-switch">
        <input type="checkbox" checked={v.seoul_realtime_verified} onChange={(e) => set('seoul_realtime_verified', e.target.checked)} />
        공식 제공 장소 목록에서 확인함
      </label>
      <label className="admin-switch">
        <input type="checkbox" checked={v.business_visible} onChange={(e) => set('business_visible', e.target.checked)} />
        사업자 화면에 공개
      </label>
      <label className="admin-switch">
        <input type="checkbox" checked={v.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        사용
      </label>
      {message && <p role="status">{message}</p>}
      <button type="submit" className="admin-btn primary">
        저장
      </button>
    </form>
  );
}

// ───────── 분석 설정 ─────────
const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i * 30);

function SettingsAdmin({ client }: { client: SupabaseClient }) {
  const [s, setS] = useState<MarketSettings | null>(null);
  const [bands, setBands] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    fetchMarketSettings(client)
      .then((x) => {
        setS(x);
        setBands(x.price_bands.join(', '));
      })
      .catch((e: Error) => setMessage(e.message));
  }, [client]);
  if (!s) return <p>{message ?? '불러오는 중…'}</p>;
  const parsed = parsePriceBands(bands);
  const invalid = !parsed
    ? '가격 구간은 오름차순 금액을 쉼표로 넣어 주세요 (최대 9개).'
    : s.lunch_end_min <= s.lunch_start_min
      ? '점심 분석시간 끝은 시작보다 늦어야 해요.'
      : s.min_stores < 1 || s.min_orders < 1
        ? '표본 기준은 1 이상이에요.'
        : null;
  return (
    <form
      className="admin-card admin-form"
      aria-label="상권 분석 설정"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid || !parsed) return;
        try {
          await saveMarketSettings(client, { ...s, price_bands: parsed });
          setMessage('저장했어요. 다음 분석부터 반영돼요.');
        } catch (err) {
          setMessage(`저장하지 못했어요: ${(err as Error).message}`);
        }
      }}
    >
      <h2>상권 분석 설정</h2>
      <div className="admin-row">
        <label>
          점심 분석 시작 (한국시간)
          <select value={s.lunch_start_min} onChange={(e) => setS({ ...s, lunch_start_min: Number(e.target.value) })}>
            {HALF_HOURS.slice(0, 48).map((m) => (
              <option key={m} value={m}>
                {hhmm(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          점심 분석 끝
          <select value={s.lunch_end_min} onChange={(e) => setS({ ...s, lunch_end_min: Number(e.target.value) })}>
            {HALF_HOURS.slice(1).map((m) => (
              <option key={m} value={m}>
                {hhmm(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        가격 구간 상한(원, 쉼표로) — 예: 7000, 9000, 12000, 15000 → 7,000원 이하 … 15,000원 초과
        <input value={bands} onChange={(e) => setBands(e.target.value)} />
      </label>
      <div className="admin-row">
        <label>
          내부 기준: 데이터 제공 매장 수
          <input inputMode="numeric" value={s.min_stores} onChange={(e) => setS({ ...s, min_stores: Math.round(Number(e.target.value) || 0) })} />
        </label>
        <label>
          내부 기준: 기간 내 유효 주문 수
          <input inputMode="numeric" value={s.min_orders} onChange={(e) => setS({ ...s, min_orders: Math.round(Number(e.target.value) || 0) })} />
        </label>
      </div>
      <p className="admin-muted">표본 기준은 개발 초기 품질 점검용이며 통계적 대표성을 보장하지 않아요. 기준 미만이면 ‘표본 부족 · 참고용’으로 표시돼요.</p>
      {invalid && <p role="alert">{invalid}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" className="admin-btn primary" disabled={!!invalid}>
        저장
      </button>
    </form>
  );
}

// ───────── 공공데이터 ─────────
const EMPTY_PUBLIC: MarketPublicData = {
  source: 'seoul_golmok',
  dataset: '',
  metric: '',
  category: null,
  value: null,
  unit: null,
  period_label: '',
  base_date: null,
  source_updated_at: null,
  source_url: null,
  note: null,
};

function PublicDataAdmin({ client }: { client: SupabaseClient }) {
  const [areas, setAreas] = useState<MarketArea[]>([]);
  const [areaId, setAreaId] = useState('');
  const [rows, setRows] = useState<MarketPublicData[] | null>(null);
  const [v, setV] = useState<MarketPublicData>(EMPTY_PUBLIC);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    listAreas(client).then((a) => {
      setAreas(a);
      setAreaId((x) => x || a[0]?.id || '');
    });
  }, [client]);
  const load = useCallback(() => {
    if (areaId) listPublicData(client, areaId).then(setRows);
  }, [client, areaId]);
  useEffect(load, [load]);

  const area = areas.find((a) => a.id === areaId);
  const allowed = (src: PublicSource) =>
    src.startsWith('seoul') ? area?.sido === '서울특별시' && (src !== 'seoul_realtime' || area.seoul_realtime_verified)
    : src === 'other_public' ? true
    : area?.sido === '경기도';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowed(v.source)) return setMessage(`${area?.name}에는 ${PUBLIC_SOURCE_LABEL[v.source]} 자료를 등록할 수 없어요.`);
    if (!v.dataset.trim() || !v.metric.trim() || !v.period_label.trim()) return setMessage('자료명·항목·기준 시점은 꼭 넣어 주세요.');
    if (v.source_url && !v.source_url.startsWith('https://')) return setMessage('출처 주소는 https://만 넣을 수 있어요.');
    try {
      await addPublicData(client, { ...v, area_id: areaId });
      setV(EMPTY_PUBLIC);
      setMessage('등록했어요.');
      load();
    } catch (err) {
      setMessage(`등록하지 못했어요: ${(err as Error).message}`);
    }
  };

  return (
    <section aria-label="공공데이터 관리">
      <div className="admin-toolbar">
        <select aria-label="지역" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.sido})
            </option>
          ))}
        </select>
      </div>
      <div className="admin-card">
        <h2>{area?.name} 공공 상권 자료</h2>
        <p className="admin-muted">
          공식 공개 자료의 항목·기준 분기를 확인한 뒤 등록하세요. 분기 자료는 실시간 자료로 표시되지 않아요. 서울시 자료는 서울 지역에만, 경기·성남 자료는 경기
          지역에만 등록돼요.
        </p>
        {rows && rows.length === 0 && <p className="admin-muted">등록된 자료가 없어요 (화면에는 ‘자료 없음’).</p>}
        <ul>
          {(rows ?? []).map((r) => (
            <li key={r.id}>
              {PUBLIC_SOURCE_LABEL[r.source]} · {r.dataset} · {r.metric}
              {r.category ? ` (${r.category})` : ''}: {r.value ?? '—'}
              {r.unit ?? ''} · 기준 {r.period_label}
              {r.source_updated_at ? ` · 갱신 ${r.source_updated_at}` : ''}{' '}
              <button type="button" className="admin-link" onClick={() => r.id && deletePublicData(client, r.id).then(load)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form className="admin-card admin-form" onSubmit={submit} aria-label="공공데이터 등록">
        <h2>자료 등록</h2>
        <label>
          출처
          <select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as PublicSource })}>
            {(Object.keys(PUBLIC_SOURCE_LABEL) as PublicSource[]).map((s) => (
              <option key={s} value={s} disabled={!allowed(s)}>
                {PUBLIC_SOURCE_LABEL[s]}
                {!allowed(s) ? ' (이 지역 해당 없음)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-row">
          <label>
            자료명
            <input value={v.dataset} onChange={(e) => setV({ ...v, dataset: e.target.value })} placeholder="상권분석서비스(추정매출-상권)" />
          </label>
          <label>
            항목
            <input value={v.metric} onChange={(e) => setV({ ...v, metric: e.target.value })} placeholder="업종별 점포 수" />
          </label>
          <label>
            업종
            <input value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value || null })} placeholder="한식음식점" />
          </label>
        </div>
        <div className="admin-row">
          <label>
            값
            <input inputMode="decimal" value={v.value ?? ''} onChange={(e) => setV({ ...v, value: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label>
            단위
            <input value={v.unit ?? ''} onChange={(e) => setV({ ...v, unit: e.target.value || null })} placeholder="개, 원, 명" />
          </label>
          <label>
            기준 시점
            <input value={v.period_label} onChange={(e) => setV({ ...v, period_label: e.target.value })} placeholder="2026년 2분기" />
          </label>
          <label>
            원자료 최종 갱신일
            <input type="date" value={v.source_updated_at ?? ''} onChange={(e) => setV({ ...v, source_updated_at: e.target.value || null })} />
          </label>
        </div>
        <label>
          출처 주소 (https://)
          <input value={v.source_url ?? ''} onChange={(e) => setV({ ...v, source_url: e.target.value || null })} />
        </label>
        {message && <p role="status">{message}</p>}
        <button type="submit" className="admin-btn primary">
          등록
        </button>
      </form>
    </section>
  );
}

// ───────── 사업자 계정 ─────────
function BusinessUsersAdmin({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<BusinessUser[] | null>(null);
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    listBusinessUsers(client)
      .then(setRows)
      .catch((e: Error) => setMessage(e.message));
  }, [client]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMessage(ok);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <section aria-label="사업자 계정 관리">
      <form
        className="admin-card admin-form"
        aria-label="사업자 계정 지정"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim() || !org.trim()) return setMessage('이메일과 사업자명을 넣어 주세요.');
          act(() => setBusinessUser(client, email, org, true), '사업자 분석 권한을 줬어요.');
        }}
      >
        <h2>사업자 계정 지정</h2>
        <p className="admin-muted">이미 가입한 계정에 사업자 분석(/business/market) 권한을 줘요. 결제 기능은 아직 없어요.</p>
        <div className="admin-row">
          <label>
            이메일
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            사업자명
            <input value={org} onChange={(e) => setOrg(e.target.value)} />
          </label>
        </div>
        {message && <p role="status">{message}</p>}
        <button type="submit" className="admin-btn primary">
          권한 주기
        </button>
      </form>
      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>계정</th>
              <th>사업자명</th>
              <th>상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((u) => (
              <tr key={u.user_id}>
                <td>{u.email}</td>
                <td>{u.org_name}</td>
                <td>{u.is_active ? '사용 중' : '중지'}</td>
                <td>
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => act(() => setBusinessUser(client, u.email, u.org_name, !u.is_active), u.is_active ? '중지했어요.' : '다시 켰어요.')}
                  >
                    {u.is_active ? '중지' : '다시 사용'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
