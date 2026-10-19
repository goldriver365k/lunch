import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOrderSettings, saveOrderSettings, type OrderSettings } from '../ordersApi';

export function OrderSettingsAdmin({ client }: { client: SupabaseClient }) {
  const [s, setS] = useState<OrderSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    fetchOrderSettings(client)
      .then(setS)
      .catch((e: Error) => setMessage(e.message));
  }, [client]);
  if (!s) return <p>{message ?? '불러오는 중…'}</p>;
  const num = (v: string, min: number) => Math.max(min, Math.round(Number(v) || 0));
  return (
    <form
      className="admin-card admin-form"
      aria-label="주문 데이터 설정"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await saveOrderSettings(client, s);
          setMessage('저장했어요.');
        } catch (err) {
          setMessage(`저장하지 못했어요: ${(err as Error).message}`);
        }
      }}
    >
      <h2>주문 데이터 설정</h2>
      <label>
        소비자 공개 최소 건수 (이보다 적으면 공개하지 않음)
        <input inputMode="numeric" value={s.min_public_count} onChange={(e) => setS({ ...s, min_public_count: num(e.target.value, 1) })} />
      </label>
      <label>
        월 API 요금 한도(원) — 0이면 유료 호출 안 함
        <input inputMode="numeric" value={s.monthly_budget_krw} onChange={(e) => setS({ ...s, monthly_budget_krw: num(e.target.value, 0) })} />
      </label>
      <label>
        집계가 이 시간(분)보다 오래되면 소비자에게 보이지 않음
        <input inputMode="numeric" value={s.stale_after_minutes} onChange={(e) => setS({ ...s, stale_after_minutes: num(e.target.value, 5) })} />
      </label>
      {message && <p role="status">{message}</p>}
      <button type="submit" className="admin-btn primary">
        저장
      </button>
    </form>
  );
}
