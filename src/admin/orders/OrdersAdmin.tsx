import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderOverview } from './OrderOverview';
import { RestaurantOrders } from './RestaurantOrders';
import { ConnectionsAdmin } from './ConnectionsAdmin';
import { OrderCsvAdmin } from './OrderCsvAdmin';
import { ReviewAdmin } from './ReviewAdmin';
import { TestDataAdmin } from './TestDataAdmin';
import { OrderSettingsAdmin } from './OrderSettingsAdmin';

type Sub = 'overview' | 'restaurant' | 'connections' | 'csv' | 'review' | 'test' | 'settings';

const SUBS: { key: Sub; label: string }[] = [
  { key: 'overview', label: '현황' },
  { key: 'restaurant', label: '매장별' },
  { key: 'connections', label: '연동 관리' },
  { key: 'csv', label: '주문 CSV' },
  { key: 'review', label: '확인 필요' },
  { key: 'test', label: '테스트 데이터' },
  { key: 'settings', label: '설정' },
];

/** 관리자 → 주문 데이터 */
export function OrdersAdmin({ client }: { client: SupabaseClient }) {
  const [sub, setSub] = useState<Sub>('overview');
  const [test, setTest] = useState(false);
  return (
    <section aria-label="주문 데이터">
      <div className={test ? 'admin-scope test' : 'admin-scope'} role="radiogroup" aria-label="데이터 구분">
        <label className="admin-switch">
          <input type="radio" name="order-scope" checked={!test} onChange={() => setTest(false)} />
          실제 데이터
        </label>
        <label className="admin-switch">
          <input type="radio" name="order-scope" checked={test} onChange={() => setTest(true)} />
          테스트 데이터
        </label>
        <span className="admin-muted">{test ? '가상 주문만 보여요 — 소비자 화면·실제 통계와 무관' : '실제 수집 주문만 보여요'}</span>
      </div>
      <nav className="admin-subtabs" aria-label="주문 데이터 메뉴">
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
      {sub === 'overview' && <OrderOverview client={client} test={test} />}
      {sub === 'restaurant' && <RestaurantOrders client={client} test={test} />}
      {sub === 'connections' && <ConnectionsAdmin client={client} test={test} />}
      {sub === 'csv' && <OrderCsvAdmin client={client} test={test} />}
      {sub === 'review' && <ReviewAdmin client={client} test={test} />}
      {sub === 'test' && <TestDataAdmin client={client} />}
      {sub === 'settings' && <OrderSettingsAdmin client={client} />}
    </section>
  );
}
