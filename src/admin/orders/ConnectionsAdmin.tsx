import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderProvider } from '../../../supabase/functions/_shared/canonicalOrder.ts';
import type { AdminRestaurant } from '../adminApi';
import { baeminConnector, BAEMIN_VENDORS } from '../../lib/orders/baeminConnector';
import { coupangEatsConnector, COUPANGEATS_VENDORS } from '../../lib/orders/coupangEatsConnector';
import { posConnector } from '../../lib/orders/posConnector';
import { mockConnector } from '../../lib/orders/testOrders';
import type { OrderConnector } from '../../lib/orders/connector';
import {
  createConnection,
  estimateCost,
  fetchOrderSettings,
  listConnections,
  PROVIDER_LABEL,
  STATUS_LABEL,
  updateConnection,
  type ConnectionInput,
  type ConnectionStatus,
  type OrderConnection,
} from '../ordersApi';
import { RestaurantPicker } from './RestaurantPicker';
import { fmtTime, won } from './format';

function connectorFor(c: OrderConnection): OrderConnector {
  if (c.is_test) return mockConnector(c.provider, { simulateError: c.test_simulate_error });
  if (c.provider === 'baemin') return baeminConnector(c.vendor ?? '');
  if (c.provider === 'coupangeats') return coupangEatsConnector(c.vendor ?? '');
  if (c.provider === 'pos') return posConnector(c.vendor ?? '');
  return { ...posConnector('CSV'), provider: 'csv', label: '주문 CSV', kind: 'file' };
}

export function ConnectionsAdmin({ client, test }: { client: SupabaseClient; test: boolean }) {
  const [rows, setRows] = useState<OrderConnection[] | null>(null);
  const [budget, setBudget] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    listConnections(client, test)
      .then(setRows)
      .catch((e: Error) => setMessage(e.message));
    fetchOrderSettings(client)
      .then((s) => setBudget(s.monthly_budget_krw))
      .catch(() => {});
  }, [client, test]);
  useEffect(load, [load]);

  /** 화면을 먼저 바꾸고 서버에 저장한다. 서버가 거부하면 목록을 다시 불러와 되돌린다 */
  const patch = (c: OrderConnection, change: Partial<OrderConnection>, ok: string) => {
    setRows((rs) => rs?.map((x) => (x.id === c.id ? { ...x, ...change } : x)) ?? rs);
    return act(() => updateConnection(client, c.id, change), ok);
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage(ok);
      load();
    } catch (e) {
      const msg = (e as Error).message;
      setMessage(msg.includes('active_needs_consent') ? '매장 동의와 제공업체 사용 허락을 모두 확인해야 수집을 시작할 수 있어요.' : msg);
      load(); // 화면에 먼저 반영한 변경을 서버 상태로 되돌린다
    }
  };

  const runTest = async (c: OrderConnection) => {
    const r = await connectorFor(c).testConnection();
    if (c.is_test) {
      await updateConnection(
        client,
        c.id,
        r.ok
          ? { last_attempt_at: new Date().toISOString(), last_success_at: new Date().toISOString(), status: 'active', last_error: null }
          : { last_attempt_at: new Date().toISOString(), last_error: r.message, last_error_at: new Date().toISOString(), status: 'error' },
      );
      load();
    }
    setMessage(`${PROVIDER_LABEL[c.provider]} 연결 테스트: ${r.message}${r.calledExternalApi ? '' : ' · 외부 API 호출 없음'}`);
  };

  const totals = (rows ?? []).filter((c) => !c.is_test).map((c) => estimateCost(c));
  const monthCost = totals.reduce((s, t) => s + t.cost, 0);
  const projected = totals.reduce((s, t) => s + t.projected, 0);

  return (
    <section aria-label="데이터 연결 관리">
      {!test && (
        <div className="admin-card">
          <h2>API 사용량·예상 비용 (이번 달, 한국시간)</h2>
          <p>
            사용 {won(monthCost)} · 월말 예상 {won(projected)} · 요금 한도 {won(budget)}
            {budget === 0 && <strong> — 한도 0원: 유료 호출을 하지 않아요</strong>}
          </p>
          <p className="admin-muted">한도를 넘으면 해당 연동을 자동으로 일시중지하고 추가 호출을 하지 않아요. 한도는 ‘설정’에서 바꿔요.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {!test && !adding && (
        <button type="button" className="admin-btn primary" onClick={() => setAdding(true)}>
          + 매장 연동 등록
        </button>
      )}
      {adding && (
        <NewConnectionForm
          client={client}
          onDone={(msg) => {
            setAdding(false);
            if (msg) setMessage(msg);
            load();
          }}
        />
      )}
      {!rows ? (
        <p>불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="admin-muted">{test ? '테스트 연동이 없어요. ‘테스트 데이터’에서 만들 수 있어요.' : '등록된 연동이 없어요.'}</p>
      ) : (
        rows.map((c) => {
          const cost = estimateCost(c);
          return (
            <article key={c.id} className="admin-card" aria-label={`${c.restaurants?.name ?? ''} ${PROVIDER_LABEL[c.provider]} 연동`}>
              <h3>
                {c.restaurants?.name} · {PROVIDER_LABEL[c.provider]} {c.vendor && <span className="admin-muted">({c.vendor})</span>}{' '}
                <span className={`admin-status ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                {c.is_test && <span className="admin-test-badge">테스트</span>}
              </h3>
              <p className="admin-muted">
                방식 {c.ingest_mode === 'webhook' ? '웹훅' : c.ingest_mode === 'polling' ? '주기 조회' : '파일·CSV'} · 매장 동의{' '}
                {c.store_consent ? '확인' : '미확인'} · 제공업체 허락 {c.provider_permission ? '확인' : '미확인'} · 소비자 공개{' '}
                {c.public_allowed ? '허용' : '불허(내부 분석만)'}
                {c.credential_ref && ` · 인증정보: 서버 비밀값 ${c.credential_ref}`}
              </p>
              <p className="admin-muted">
                마지막 정상 수집 {fmtTime(c.last_success_at)} · 마지막 시도 {fmtTime(c.last_attempt_at)}
                {!c.is_test && ` · 이번 달 호출 ${cost.calls.toLocaleString('ko-KR')}회 (${won(cost.cost)}, 예상 ${won(cost.projected)})`}
              </p>
              {c.last_error && (
                <p className="admin-error">
                  오류: {c.last_error} ({fmtTime(c.last_error_at)})
                </p>
              )}
              <div className="admin-row">
                <button type="button" className="admin-btn" onClick={() => runTest(c)}>
                  API 연결 테스트
                </button>
                {!c.is_test && (
                  <label>
                    승인 상태
                    <select
                      value={c.status}
                      aria-label="승인 상태"
                      onChange={(e) =>
                        patch(c, { status: e.target.value as ConnectionStatus }, '상태를 바꿨어요.')
                      }
                    >
                      {(Object.keys(STATUS_LABEL) as ConnectionStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {c.status === 'paused' ? (
                  <button type="button" className="admin-btn" onClick={() => patch(c, { status: 'active' }, '재개했어요.')}>
                    재개
                  </button>
                ) : (
                  <button type="button" className="admin-btn" onClick={() => patch(c, { status: 'paused' }, '중단했어요.')}>
                    중단
                  </button>
                )}
              </div>
              {!c.is_test && (
                <div className="admin-row">
                  {(
                    [
                      ['store_consent', '매장 동의'],
                      ['provider_permission', '제공업체 사용 허락'],
                      ['public_allowed', '소비자 공개 허용(제3자 재사용 범위 확인)'],
                    ] as const
                  ).map(([k, l]) => (
                    <label key={k} className="admin-switch">
                      <input
                        type="checkbox"
                        checked={c[k]}
                        onChange={(e) => patch(c, { [k]: e.target.checked }, '저장했어요.')}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              )}
              {c.is_test && (
                <label className="admin-switch">
                  <input
                    type="checkbox"
                    checked={c.test_simulate_error}
                    onChange={(e) => patch(c, { test_simulate_error: e.target.checked }, '저장했어요.')}
                  />
                  API 오류 상황 시뮬레이션
                </label>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

function NewConnectionForm({ client, onDone }: { client: SupabaseClient; onDone: (msg?: string) => void }) {
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const [v, setV] = useState<Omit<ConnectionInput, 'restaurant_id'>>({
    provider: 'pos',
    vendor: '',
    external_store_id: '',
    ingest_mode: 'webhook',
    store_consent: false,
    provider_permission: false,
    public_allowed: false,
    credential_ref: '',
    unit_cost_krw: 0,
    monthly_call_limit: null,
  });
  const [error, setError] = useState<string | null>(null);
  const vendors: Record<OrderProvider, readonly string[]> = {
    pos: ['POS 업체 미정'],
    baemin: BAEMIN_VENDORS,
    coupangeats: COUPANGEATS_VENDORS,
    csv: ['직접 CSV'],
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant) return setError('매장을 골라 주세요.');
    try {
      await createConnection(client, {
        ...v,
        restaurant_id: restaurant.id,
        vendor: v.vendor || vendors[v.provider][0],
        external_store_id: v.external_store_id || null,
        credential_ref: v.credential_ref?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || null,
        ingest_mode: v.provider === 'csv' ? 'file' : v.ingest_mode,
      });
      onDone('연동을 ‘연동 준비’ 상태로 등록했어요. 계약·동의를 확인한 뒤 수집을 시작하세요.');
    } catch (err) {
      const m = (err as Error).message;
      setError(m.includes('duplicate key') ? '이 매장에는 같은 제공처 연동이 이미 있어요.' : m);
    }
  };
  return (
    <form className="admin-card admin-form" onSubmit={submit} aria-label="매장 연동 등록">
      <h2>매장 연동 등록</h2>
      <RestaurantPicker client={client} value={restaurant} onChange={setRestaurant} />
      <div className="admin-row">
        <label>
          제공처
          <select value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as OrderProvider, vendor: '' })}>
            {(Object.keys(PROVIDER_LABEL) as OrderProvider[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          데이터 제공업체
          <select value={v.vendor ?? ''} onChange={(e) => setV({ ...v, vendor: e.target.value })}>
            {vendors[v.provider].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        {v.provider !== 'csv' && (
          <label>
            수집 방식
            <select value={v.ingest_mode} onChange={(e) => setV({ ...v, ingest_mode: e.target.value as ConnectionInput['ingest_mode'] })}>
              <option value="webhook">웹훅 (우선)</option>
              <option value="polling">주기 조회</option>
              <option value="file">POS 파일·CSV</option>
            </select>
          </label>
        )}
      </div>
      <div className="admin-row">
        <label>
          제공처 매장 ID
          <input value={v.external_store_id ?? ''} onChange={(e) => setV({ ...v, external_store_id: e.target.value })} />
        </label>
        <label>
          서버 비밀값 이름 (값은 입력하지 않음)
          <input
            placeholder="예: BAEMIN_STORE_A"
            value={v.credential_ref ?? ''}
            onChange={(e) => setV({ ...v, credential_ref: e.target.value })}
          />
        </label>
      </div>
      <p className="admin-muted">
        API 키·비밀번호는 이 화면에 넣지 마세요. Supabase Edge Function 비밀값(supabase secrets)에만 저장하고 여기에는 그 이름만 적어요.
      </p>
      <div className="admin-row">
        <label>
          호출 1회 예상 비용(원)
          <input inputMode="decimal" value={v.unit_cost_krw} onChange={(e) => setV({ ...v, unit_cost_krw: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label>
          월 호출 한도
          <input
            inputMode="numeric"
            value={v.monthly_call_limit ?? ''}
            onChange={(e) => setV({ ...v, monthly_call_limit: e.target.value ? Math.max(0, Math.round(Number(e.target.value))) : null })}
          />
        </label>
      </div>
      <div className="admin-row">
        {(
          [
            ['store_consent', '매장 동의 받음'],
            ['provider_permission', '제공업체 사용 허락 받음'],
            ['public_allowed', '소비자 공개 허용'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="admin-switch">
            <input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />
            {l}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="admin-row">
        <button type="submit" className="admin-btn primary">
          등록
        </button>
        <button type="button" className="admin-btn" onClick={() => onDone()}>
          취소
        </button>
      </div>
    </form>
  );
}
