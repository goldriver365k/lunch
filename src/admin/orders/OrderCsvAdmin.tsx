import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminRestaurant } from '../adminApi';
import { readCsvRows } from '../../lib/publicData/csv';
import { OrderCsvFormatError, parseOrderCsv, type OrderCsvResult } from '../../lib/orders/orderCsv';
import { ensureTestConnection, ingestOrders, listConnections, PROVIDER_LABEL, STATUS_LABEL, type IngestResult, type OrderConnection } from '../ordersApi';
import { RestaurantPicker } from './RestaurantPicker';

/** POS 연결이 없는 매장의 주문 CSV 업로드 */
export function OrderCsvAdmin({ client, test }: { client: SupabaseClient; test: boolean }) {
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const [connections, setConnections] = useState<OrderConnection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [parsed, setParsed] = useState<OrderCsvResult | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!restaurant || test) return;
    listConnections(client, false).then((all) => {
      const mine = all.filter((c) => c.restaurant_id === restaurant.id && c.ingest_mode === 'file');
      setConnections(mine);
      setConnectionId(mine.find((c) => c.status === 'active')?.id ?? '');
    });
  }, [client, restaurant, test]);

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setResult(null);
    setMessage(null);
    if (!file) return;
    try {
      const rows: string[][] = [];
      for await (const r of readCsvRows(file)) rows.push(r);
      setParsed(parseOrderCsv(rows));
    } catch (e) {
      setMessage(e instanceof OrderCsvFormatError ? e.message : `파일을 읽지 못했어요: ${(e as Error).message}`);
    }
  };

  const save = async () => {
    if (!parsed || !restaurant) return;
    setBusy(true);
    try {
      const connId = test ? (await ensureTestConnection(client, restaurant.id, 'csv')).id : connectionId;
      setResult(await ingestOrders(client, connId, parsed.orders));
    } catch (e) {
      setMessage(`저장하지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const active = connections.find((c) => c.id === connectionId);
  return (
    <section aria-label="주문 CSV 업로드">
      <div className="admin-card admin-form">
        <h2>주문 CSV 업로드 {test && <span className="admin-test-badge">테스트 데이터로 저장</span>}</h2>
        <p className="admin-muted">
          한 행에 주문 메뉴 1개. 필수 열: 주문번호, 주문시각, 채널(홀/배달/포장), 메뉴명, 수량, 주문총금액. 선택: 연결번호, 결제시각, 단가,
          판매금액, 할인금액, 환불금액, 결제상태, 취소여부. 고객 이름·전화번호·주소 열은 읽지 않아요. 같은 파일을 다시 올려도 주문이 늘지 않아요.
        </p>
        <RestaurantPicker client={client} value={restaurant} onChange={setRestaurant} />
        {restaurant && !test && (
          <label>
            저장할 연동 (파일·CSV 방식, 수집 중인 것만)
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              <option value="">선택</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.status !== 'active'}>
                  {PROVIDER_LABEL[c.provider]} · {STATUS_LABEL[c.status]}
                </option>
              ))}
            </select>
          </label>
        )}
        {restaurant && !test && connections.length === 0 && (
          <p className="admin-muted">이 매장에 파일·CSV 방식 연동이 없어요. ‘연동 관리’에서 주문 CSV 연동을 등록하고 동의를 확인해 주세요.</p>
        )}
        <label>
          주문 CSV 파일
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      {message && <p role="alert">{message}</p>}
      {parsed && (
        <section className="admin-card" aria-label="주문 CSV 미리보기">
          <h2>미리보기</h2>
          <p>
            {parsed.rowCount}행 → 주문 {parsed.orders.length}건 · 오류 {parsed.errors.length}건
            {parsed.ignoredColumns.length > 0 && <span className="admin-muted"> · 읽지 않은 열: {parsed.ignoredColumns.join(', ')}</span>}
          </p>
          {parsed.errors.length > 0 && (
            <ul>
              {parsed.errors.slice(0, 20).map((e) => (
                <li key={e.row}>
                  {e.row}행: {e.message}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="admin-btn primary"
            disabled={busy || parsed.orders.length === 0 || !restaurant || (!test && !active)}
            onClick={save}
          >
            {busy ? '저장 중…' : `주문 ${parsed.orders.length}건 저장`}
          </button>
        </section>
      )}
      {result && (
        <section className="admin-card" role="status" aria-label="주문 CSV 결과">
          <h2>저장 결과</h2>
          {result.ok ? (
            <p>
              신규 {result.inserted}건 · 갱신 {result.updated}건 · POS↔배달앱 통합 {result.merged}건 · 중복 확인 필요 {result.needs_review}건 ·
              메뉴 {result.items}개 (내부 메뉴와 다른 이름 {result.unmatched_items}개)
            </p>
          ) : (
            <p className="admin-error">수집 오류: {result.error}</p>
          )}
        </section>
      )}
    </section>
  );
}
