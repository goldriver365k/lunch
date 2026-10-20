import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderProvider } from '../../../supabase/functions/_shared/canonicalOrder.ts';
import { listMenus, type AdminRestaurant } from '../adminApi';
import { generateTestScenario, type TestScenario } from '../../lib/orders/testOrders';
import {
  CHANNEL_LABEL,
  deleteTestOrders,
  ensureTestConnection,
  fetchAggregates,
  ingestOrders,
  PROVIDER_LABEL,
  updateConnection,
  type AggregateRow,
  type IngestResult,
} from '../ordersApi';
import { RestaurantPicker } from './RestaurantPicker';

type Run = {
  scenario: TestScenario;
  results: Partial<Record<OrderProvider, IngestResult>>;
  resend: IngestResult;
  aggregates: AggregateRow[];
};

/**
 * 가상 주문으로 수집·집계를 시험한다. 모든 주문은 테스트 연동(is_test)으로만 들어가
 * 소비자 공개·실제 통계에 섞이지 않는다.
 */
export function TestDataAdmin({ client }: { client: SupabaseClient }) {
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!restaurant) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteTestOrders(client); // 이전 시험과 섞이지 않게 새로 시작
      const menus = await listMenus(client, restaurant.id);
      const scenario = generateTestScenario(menus, new Date(), Date.now() % 100000);
      const results: Run['results'] = {};
      // 배달앱 → POS 순으로 넣어 POS 사본이 통합·중복 의심으로 분류되는지 본다
      for (const p of ['baemin', 'coupangeats', 'pos'] as const) {
        const conn = await ensureTestConnection(client, restaurant.id, p);
        if (conn.test_simulate_error) await updateConnection(client, conn.id, { test_simulate_error: false, status: 'active' });
        results[p] = await ingestOrders(client, conn.id, scenario.batches[p]);
      }
      // 같은 배치를 한 번 더 보내도 늘지 않아야 한다
      const posConn = await ensureTestConnection(client, restaurant.id, 'pos');
      const resend = await ingestOrders(client, posConn.id, scenario.batches.pos);
      const aggregates = await fetchAggregates(client, restaurant.id, 'test');
      setRun({ scenario, results, resend, aggregates });
    } catch (e) {
      setMessage(`시험하지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const simulateError = async () => {
    if (!restaurant) return;
    const conn = await ensureTestConnection(client, restaurant.id, 'baemin');
    await updateConnection(client, conn.id, { test_simulate_error: true });
    const r = await ingestOrders(client, conn.id, []);
    setMessage(r.ok ? '오류가 재현되지 않았어요.' : '배민 테스트 연동을 오류 상태로 만들었어요. ‘현황’·‘연동 관리’에서 오류 표시를 확인하세요.');
  };

  const actual = (w: string, ch: string) => run?.aggregates.find((a) => a.window_key === w && a.channel === ch)?.order_count ?? 0;

  return (
    <section aria-label="테스트 데이터">
      <div className="admin-card admin-form">
        <h2>
          가상 주문으로 시험 <span className="admin-test-badge">테스트 데이터</span>
        </h2>
        <p className="admin-muted">
          매장별 홀·배달·포장 주문, 메뉴별 수량, 취소·환불, 같은 주문 재전송, POS↔배달앱 통합·중복 의심, 최근 10·30·60분 집계, API 오류를
          가상 주문으로 확인해요. 실제 주문·소비자 화면·통계에는 들어가지 않아요.
        </p>
        <RestaurantPicker client={client} value={restaurant} onChange={setRestaurant} />
        <div className="admin-row">
          <button type="button" className="admin-btn primary" disabled={!restaurant || busy} onClick={generate}>
            {busy ? '시험 중…' : '가상 주문 만들고 집계 검증'}
          </button>
          <button type="button" className="admin-btn" disabled={!restaurant || busy} onClick={simulateError}>
            API 오류 상황 시험
          </button>
          <button
            type="button"
            className="admin-btn danger"
            onClick={async () => {
              const n = await deleteTestOrders(client);
              setRun(null);
              setMessage(`테스트 주문 ${n}건을 지웠어요. 실제 주문은 그대로예요.`);
            }}
          >
            테스트 주문 전체 삭제
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {run && (
        <section className="admin-card" aria-label="테스트 검증 결과">
          <h2>검증 결과</h2>
          <ul>
            {(Object.entries(run.results) as [OrderProvider, IngestResult][]).map(([p, r]) => (
              <li key={p}>
                {PROVIDER_LABEL[p]}: 신규 {r.inserted} · 갱신 {r.updated} · 통합 {r.merged} · 중복 확인 필요 {r.needs_review}
              </li>
            ))}
            <li>
              같은 POS 주문 재전송: 신규 {run.resend.inserted}건 (0이어야 정상) {run.resend.inserted === 0 ? '✓' : '✗'}
            </li>
          </ul>
          <table className="admin-table" aria-label="기대 집계와 DB 집계 비교">
            <thead>
              <tr>
                <th>창</th>
                {(['HALL', 'DELIVERY', 'PICKUP'] as const).map((ch) => (
                  <th key={ch}>{CHANNEL_LABEL[ch]} (기대/집계)</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['10m', '30m', '60m'] as const).map((w) => (
                <tr key={w}>
                  <th>최근 {w.replace('m', '분')}</th>
                  {(['HALL', 'DELIVERY', 'PICKUP'] as const).map((ch) => {
                    const exp = run.scenario.expected[w][ch];
                    const got = actual(w, ch);
                    return (
                      <td key={ch}>
                        {exp} / {got} {exp === got ? '✓' : '✗'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="admin-muted">포함한 상황: {run.scenario.notes.join(' · ')}</p>
        </section>
      )}
    </section>
  );
}
