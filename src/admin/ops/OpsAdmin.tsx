import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtTime, won } from '../orders/format';
import { PROVIDER_LABEL, STATUS_LABEL } from '../ordersApi';
import {
  bytes,
  fetchDataQuality,
  fetchDeployedVersion,
  fetchSystemStatus,
  fetchUsage,
  FREE_DB_LIMIT_BYTES,
  listAudit,
  saveAppSettings,
  setRegionPublic,
  type AuditRow,
  type BuildInfo,
  type RegionQuality,
  type SystemStatus,
  type UsageOverview,
} from './opsApi';

type Sub = 'usage' | 'system' | 'manage' | 'quality' | 'audit';
const SUBS: { key: Sub; label: string }[] = [
  { key: 'usage', label: '이용 현황' },
  { key: 'system', label: '서버·API' },
  { key: 'manage', label: '서비스 관리' },
  { key: 'quality', label: '데이터 점검' },
  { key: 'audit', label: '작업 이력' },
];

const AREA_LABEL: Record<string, string> = {
  seolleung: '선릉',
  yeoksam: '역삼',
  pangyo: '판교',
  yeouido: '여의도',
  other: '그 밖의 지역',
  unknown: '위치 없음',
};

/** 관리자 → 운영 현황 */
export function OpsAdmin({ client }: { client: SupabaseClient }) {
  const [sub, setSub] = useState<Sub>('usage');
  return (
    <section aria-label="운영 현황">
      <nav className="admin-subtabs" aria-label="운영 현황 메뉴">
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
      {sub === 'usage' && <Usage client={client} />}
      {sub === 'system' && <System client={client} />}
      {sub === 'manage' && <Manage client={client} />}
      {sub === 'quality' && <Quality client={client} />}
      {sub === 'audit' && <Audit client={client} />}
    </section>
  );
}

function Tiles({ items }: { items: [string, number | string][] }) {
  return (
    <div className="admin-tiles">
      {items.map(([label, n]) => (
        <div key={label} className="admin-tile">
          <span className="admin-tile-num">{typeof n === 'number' ? n.toLocaleString('ko-KR') : n}</span>
          <span className="admin-tile-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ───────── 이용 현황 ─────────
function Usage({ client }: { client: SupabaseClient }) {
  const [day, setDay] = useState('');
  const [test, setTest] = useState(false);
  const [u, setU] = useState<UsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setU(null);
    fetchUsage(client, day || null, test)
      .then(setU)
      .catch((e: Error) => setError(e.message));
  }, [client, day, test]);
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>;
  if (!u) return <p>불러오는 중…</p>;
  const maxHour = Math.max(1, ...u.by_hour.map((h) => h.searches));
  return (
    <section aria-label="서비스 이용 현황">
      <div className="admin-toolbar">
        <label>
          날짜 <input type="date" value={day || u.day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="admin-switch">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> 관리자 테스트 위치 기록 포함
        </label>
      </div>
      <Tiles
        items={[
          ['방문자 수 (기기 기준)', u.visitors],
          ['세션 수', u.sessions],
          ['검색 실행', u.searches],
          ['도보 식사 검색', u.searches_by_mode.walk ?? 0],
          ['배달 검색', u.searches_by_mode.delivery ?? 0],
          ['포장 검색', u.searches_by_mode.takeout ?? 0],
          ['매장 상세 조회', u.detail_views],
          ['매장찾기 클릭', u.find_route],
          ['홈 화면 설치', u.installs],
          ['위치 권한 거부', u.gps_denied],
          ['위치 확인 실패', u.gps_error],
          ['화면 오류', u.errors],
        ]}
      />
      <p className="admin-muted">
        방문자 = 기기에 저장한 임의 번호 기준(브라우저 저장소를 지우면 새 방문자), 세션 = 탭을 연 횟수, 검색 = 조건을 바꿔 결과를 받은 횟수(자동
        새로고침 제외). 좌표·IP는 기록하지 않아요. 관리자 테스트 위치 기록은 기본으로 빠져요. 기록은 180일 보관해요.
      </p>
      <div className="admin-card">
        <h2>지역별 이용</h2>
        <table className="admin-table" aria-label="지역별 이용">
          <thead>
            <tr>
              <th>지역 (1.5km 안)</th>
              <th>방문자</th>
              <th>검색</th>
            </tr>
          </thead>
          <tbody>
            {u.by_area.map((a) => (
              <tr key={a.area}>
                <td>{AREA_LABEL[a.area] ?? a.area}</td>
                <td>{a.visitors}</td>
                <td>{a.searches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-card">
        <h2>시간대별 검색</h2>
        <ul className="ops-hours" aria-label="시간대별 검색">
          {u.by_hour.map((h) => (
            <li key={h.hour} title={`${h.hour}시 검색 ${h.searches}건 · 방문자 ${h.visitors}`}>
              <span className="ops-bar" style={{ height: `${(h.searches / maxHour) * 100}%` }} />
              <span className="ops-hour">{h.hour}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="admin-card">
        <h2>최근 7일</h2>
        <table className="admin-table">
          <tbody>
            {u.last7.map((d) => (
              <tr key={d.day}>
                <th>{d.day}</th>
                <td>방문자 {d.visitors}</td>
                <td>검색 {d.searches}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {u.error_details.length > 0 && (
          <p className="admin-muted">오류 내용: {u.error_details.map((e) => `${e.detail} ${e.count}건`).join(' · ')}</p>
        )}
      </div>
    </section>
  );
}

// ───────── 서버·API ─────────
function System({ client }: { client: SupabaseClient }) {
  const [s, setS] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<BuildInfo | null | undefined>(undefined);
  useEffect(() => {
    fetchSystemStatus(client)
      .then(setS)
      .catch((e: Error) => setError(e.message));
    fetchDeployedVersion().then(setDeployed);
  }, [client]);
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>;
  if (!s) return <p>불러오는 중…</p>;
  const build = __APP_BUILD__;
  return (
    <section aria-label="서버·API 현황">
      <Tiles
        items={[
          ['DB 사용량', bytes(s.db_size_bytes)],
          ['무료 한도 대비 (참고)', `${((s.db_size_bytes / FREE_DB_LIMIT_BYTES) * 100).toFixed(1)}%`],
          ['최근 24시간 이용 기록', s.usage_24h],
          ['이번 달 외부 API 호출', s.api_calls_month],
          ['이번 달 예상 API 비용', won(s.api_cost_month_krw)],
          ['월 API 요금 한도', won(s.monthly_budget_krw)],
        ]}
      />
      <p className="admin-muted">
        예상 비용 = 호출 수 × 연동에 등록한 단가로 계산한 <strong>예상치</strong>이며 확정 청구액이 아니에요. 실제 청구·요청량·전송량은 Supabase·
        호스팅 대시보드에서 확인해야 해요(이 화면에 연결되지 않음). 무료 한도 500MB는 Supabase 무료 플랜 참고값으로, 요금표가 바뀔 수 있어요.
      </p>
      <div className="admin-card">
        <h2>데이터 연동·수집</h2>
        <p>
          마지막 정상 수집 {fmtTime(s.last_success_at)} ·{' '}
          {s.connections.length === 0
            ? '실제 연동 없음'
            : s.connections
                .map((c) => `${PROVIDER_LABEL[c.provider as keyof typeof PROVIDER_LABEL] ?? c.provider} ${STATUS_LABEL[c.status as keyof typeof STATUS_LABEL] ?? c.status} ${c.count}`)
                .join(' · ')}
        </p>
        <h3>최근 7일 외부 API 오류</h3>
        {s.errors.length === 0 ? (
          <p className="admin-muted">없음</p>
        ) : (
          <ul>
            {s.errors.map((e, i) => (
              <li key={i}>
                {e.restaurant} · {PROVIDER_LABEL[e.provider as keyof typeof PROVIDER_LABEL] ?? e.provider} · <span className="admin-error">{e.error}</span> ·{' '}
                {fmtTime(e.at)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="admin-card">
        <h2>테이블 크기</h2>
        <table className="admin-table">
          <tbody>
            {s.tables.map((t) => (
              <tr key={t.table}>
                <th>{t.table}</th>
                <td>{bytes(t.bytes)}</td>
                <td className="admin-muted">약 {Math.max(0, t.rows).toLocaleString('ko-KR')}행</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-card" aria-label="앱 버전">
        <h2>앱 버전·배포</h2>
        <p>
          보고 있는 화면: v{build.version} · {build.commit} · 빌드 {fmtTime(build.builtAt)}
        </p>
        <p>
          지금 배포된 버전:{' '}
          {deployed === undefined
            ? '확인 중…'
            : deployed
              ? `v${deployed.version} · ${deployed.commit} · 빌드 ${fmtTime(deployed.builtAt)}${deployed.buildId !== build.buildId ? ' — 새로고침하면 새 버전이 보여요' : ' (같음)'}`
              : '확인할 수 없음 (개발 서버이거나 version.json 없음)'}
        </p>
      </div>
    </section>
  );
}

// ───────── 서비스 관리 ─────────
function Manage({ client }: { client: SupabaseClient }) {
  const [s, setS] = useState<SystemStatus | null>(null);
  const [regions, setRegions] = useState<RegionQuality[] | null>(null);
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchSystemStatus(client)
      .then((x) => {
        setS(x);
        setNotice(x.settings.notice_message ?? '');
      })
      .catch((e: Error) => setMessage(e.message));
    fetchDataQuality(client)
      .then(setRegions)
      .catch((e: Error) => setMessage(e.message));
  }, [client]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMessage(ok);
      load();
    } catch (e) {
      setMessage(`저장하지 못했어요: ${(e as Error).message}`);
    }
  };
  if (!s) return <p>{message ?? '불러오는 중…'}</p>;
  const st = s.settings;
  return (
    <section aria-label="서비스 관리">
      {message && <p role="status">{message}</p>}
      <form
        className="admin-card admin-form"
        aria-label="서비스 점검 안내"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => saveAppSettings(client, { notice_message: notice.trim() || null }), notice.trim() ? '공지를 게시했어요.' : '공지를 내렸어요.');
        }}
      >
        <h2>서비스 점검·공지</h2>
        <label>
          소비자 화면 맨 위에 보여줄 문구 (비우면 표시 안 함, 200자)
          <input value={notice} maxLength={200} onChange={(e) => setNotice(e.target.value)} placeholder="예: 오늘 13시~13시 30분 점검으로 주문정보가 늦을 수 있어요" />
        </label>
        <button type="submit" className="admin-btn primary">
          저장
        </button>
      </form>
      <div className="admin-card">
        <h2>기능 일시중단</h2>
        <label className="admin-switch">
          <input
            type="checkbox"
            checked={st.live_orders_public}
            onChange={(e) =>
              act(() => saveAppSettings(client, { live_orders_public: e.target.checked }), e.target.checked ? '실시간 주문정보 표시를 켰어요.' : '실시간 주문정보 표시를 멈췄어요. 거리순 검색은 계속돼요.')
            }
          />
          소비자 화면에 실시간 주문정보 표시
        </label>
        <p className="admin-muted">끄면 모든 매장이 ‘주문정보 없음’ + 거리순으로 보여요 (가상 수치로 대체하지 않음). 주문 집계에 문제가 있을 때 써요.</p>
        <label className="admin-switch">
          <input
            type="checkbox"
            checked={st.collection_paused}
            onChange={(e) =>
              act(() => saveAppSettings(client, { collection_paused: e.target.checked }), e.target.checked ? '실제 주문 수집을 일시중지했어요.' : '주문 수집을 다시 시작했어요.')
            }
          />
          실제 주문 데이터 수집 일시중지
        </label>
        <p className="admin-muted">켜면 실제 주문을 받지 않고 외부 API도 부르지 않아요. 테스트 주문 검증은 계속할 수 있어요. 소비자 화면에는 ‘데이터 갱신 지연’으로 보여요.</p>
        <p className="admin-muted">테스트 모드: ‘테스트 위치’ 메뉴에서 관리자 전용 위치로 소비자 화면·상권 분석을 확인해요 (일반 이용 통계에서 빠짐).</p>
      </div>
      <div className="admin-card">
        <h2>지역별 공개 범위</h2>
        <table className="admin-table" aria-label="지역별 공개 범위">
          <thead>
            <tr>
              <th>지역</th>
              <th>음식점 검색</th>
              <th>실시간 인기매장</th>
            </tr>
          </thead>
          <tbody>
            {(regions ?? []).map((r) => (
              <tr key={r.region_id}>
                <th>{r.region}</th>
                <td>
                  <label className="admin-switch">
                    <input
                      type="checkbox"
                      aria-label={`${r.region} 음식점 검색 공개`}
                      checked={r.search_public}
                      onChange={(e) => act(() => setRegionPublic(client, r.region_id, { search_public: e.target.checked }), '저장했어요.')}
                    />
                    공개
                  </label>
                </td>
                <td>
                  <label className="admin-switch">
                    <input
                      type="checkbox"
                      aria-label={`${r.region} 실시간 인기매장 공개`}
                      checked={r.live_public}
                      onChange={(e) => act(() => setRegionPublic(client, r.region_id, { live_public: e.target.checked }), '저장했어요.')}
                    />
                    공개
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="admin-muted">
          비공개 지역은 일반 이용자에게 검색되지 않고, 관리자 테스트 위치로만 확인돼요. 사업자 상권 분석 공개는 ‘상권 분석 → 분석지역’에서 지역마다
          정해요.
        </p>
      </div>
    </section>
  );
}

// ───────── 데이터 점검 ─────────
function Quality({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<RegionQuality[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchDataQuality(client)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [client]);
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>;
  if (!rows) return <p>불러오는 중…</p>;
  const lines: [string, (r: RegionQuality) => string | number][] = [
    ['서비스 가능 (검색)', (r) => (r.search_ready ? `가능 · ${r.searchable}곳` : '불가')],
    ['메뉴정보 제공 매장', (r) => r.menu_ready],
    ['실시간 인기매장 준비 매장', (r) => r.live_ready],
    ['등록 / 공개', (r) => `${r.total} / ${r.public}`],
    ['영업 아님(폐업·휴업·불명)', (r) => r.not_open],
    ['좌표 문제', (r) => r.coord_problem],
    ['정보 확인 필요', (r) => r.needs_review],
    ['미확인 상태', (r) => r.unverified],
    ['공개 중 최종 확인일 없음', (r) => r.no_verified_date],
    ['이름·위치 중복 의심', (r) => r.possible_duplicates],
    ['공개 중 메뉴 없음', (r) => r.without_menu],
    ['가격 확인일 없는 메뉴가 있는 매장', (r) => r.price_unverified],
    ['음식 종류 ‘기타’', (r) => r.category_other],
    ['홀·배달·포장 운영 미확인', (r) => r.channel_unknown],
  ];
  return (
    <section aria-label="데이터 점검">
      <div className="admin-card admin-scroll">
        <h2>지역별 데이터 점검</h2>
        <table className="admin-table" aria-label="지역별 데이터 점검">
          <thead>
            <tr>
              <th>항목</th>
              {rows.map((r) => (
                <th key={r.region_id}>{r.region}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(([label, f]) => (
              <tr key={label}>
                <th>{label}</th>
                {rows.map((r) => (
                  <td key={r.region_id}>{f(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="admin-muted">
          공공데이터에 영업 중이어도 현재 영업이 확실하지 않으면 ‘음식점·메뉴’에서 데이터 확인 상태를 ‘정보 확인 필요’로 두세요 (소비자 화면에 표시돼요).
          기존 매장 정보는 자동으로 지우지 않아요. 실제 영업·위치·가격은 현장 확인이 필요해요.
        </p>
      </div>
    </section>
  );
}

// ───────── 작업 이력 ─────────
function Audit({ client }: { client: SupabaseClient }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listAudit(client)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [client]);
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>;
  if (!rows) return <p>불러오는 중…</p>;
  return (
    <section aria-label="관리 작업 이력" className="admin-card admin-scroll">
      <h2>최근 관리 작업 50건</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>시각</th>
            <th>계정</th>
            <th>대상</th>
            <th>작업</th>
            <th>행 수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtTime(r.at)}</td>
              <td className="admin-muted">{r.actor ? r.actor.slice(0, 8) : '서버'}</td>
              <td>{r.table_name}</td>
              <td>{{ INSERT: '추가', UPDATE: '수정', DELETE: '삭제' }[r.op] ?? r.op}</td>
              <td>{r.row_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-muted">바뀐 값 자체는 남기지 않고, 누가·언제·어느 표를 몇 행 바꿨는지만 기록해요 (직접 수정·삭제 불가).</p>
    </section>
  );
}
