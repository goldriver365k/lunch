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
  // DB 제약과 같은 범위 — 저장 전에 알려준다
  const invalid =
    s.rank_primary_minutes < 5 || s.rank_primary_minutes > 60
      ? '1차 집계시간은 5~60분이에요.'
      : s.rank_secondary_minutes < 10 || s.rank_secondary_minutes > 180
        ? '2차 집계시간은 10~180분이에요.'
        : s.rank_secondary_minutes <= s.rank_primary_minutes
          ? '2차 집계시간은 1차보다 길어야 해요.'
          : s.refresh_interval_seconds < 15 || s.refresh_interval_seconds > 600
            ? '자동 새로고침은 15~600초예요.'
            : null;
  return (
    <form
      className="admin-card admin-form"
      aria-label="주문 데이터 설정"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) return;
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
        마지막 정상 수집이 이 시간(분)보다 오래되면 ‘데이터 갱신 지연’ — 건수를 숨기고 순위에서 뺌
        <input inputMode="numeric" value={s.stale_after_minutes} onChange={(e) => setS({ ...s, stale_after_minutes: num(e.target.value, 5) })} />
      </label>
      <h3>실시간 인기매장 순위</h3>
      <label>
        1차 집계시간(분) — 이 시간 안의 주문 수로 먼저 줄 세움
        <input
          inputMode="numeric"
          value={s.rank_primary_minutes}
          onChange={(e) => setS({ ...s, rank_primary_minutes: num(e.target.value, 0) })}
        />
      </label>
      <label>
        2차 집계시간(분) — 1차가 같으면 이 시간 안의 주문 수로
        <input
          inputMode="numeric"
          value={s.rank_secondary_minutes}
          onChange={(e) => setS({ ...s, rank_secondary_minutes: num(e.target.value, 0) })}
        />
      </label>
      <label>
        소비자 화면 자동 새로고침(초) — 주문 수집 주기와 별개
        <input
          inputMode="numeric"
          value={s.refresh_interval_seconds}
          onChange={(e) => setS({ ...s, refresh_interval_seconds: num(e.target.value, 0) })}
        />
      </label>
      {invalid && <p role="alert">{invalid}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" className="admin-btn primary" disabled={!!invalid}>
        저장
      </button>
    </form>
  );
}
