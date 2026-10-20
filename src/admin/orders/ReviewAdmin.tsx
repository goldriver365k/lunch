import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listMenus, type AdminMenu } from '../adminApi';
import {
  CHANNEL_LABEL,
  listReviewOrders,
  listUnmatchedMenus,
  mapMenu,
  PROVIDER_LABEL,
  resolveDuplicate,
  type ReviewOrder,
  type UnmatchedMenu,
} from '../ordersApi';
import { fmtTime, won } from './format';

/** 중복 주문 확인 · 외부 메뉴명 확인 */
export function ReviewAdmin({ client, test }: { client: SupabaseClient; test: boolean }) {
  const [dups, setDups] = useState<ReviewOrder[] | null>(null);
  const [menus, setMenus] = useState<UnmatchedMenu[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listReviewOrders(client, test)
      .then(setDups)
      .catch((e: Error) => setError(e.message));
    listUnmatchedMenus(client, test)
      .then(setMenus)
      .catch((e: Error) => setError(e.message));
  }, [client, test]);
  useEffect(load, [load]);

  return (
    <section aria-label="확인 필요">
      {error && <p role="alert">{error}</p>}
      <section className="admin-card" aria-label="중복 가능성 확인 필요 주문">
        <h2>중복 가능성 확인 필요 {dups ? `${dups.length}건` : ''}</h2>
        <p className="admin-muted">
          POS와 배달앱에 같은 주문이 연결번호 없이 들어온 것으로 보이는 주문이에요. 판정 전에는 집계에 넣지 않아요.
        </p>
        {dups?.map((d) => (
          <div key={d.id} className="admin-menu-row">
            <p>
              <strong>{d.restaurants?.name}</strong> · {PROVIDER_LABEL[d.provider]} {d.external_order_id} · {CHANNEL_LABEL[d.channel]} ·{' '}
              {won(d.total_amount)} · {fmtTime(d.ordered_at)}
            </p>
            {d.duplicate && (
              <p className="admin-muted">
                비슷한 주문: {PROVIDER_LABEL[d.duplicate.provider]} {d.duplicate.external_order_id} · {won(d.duplicate.total_amount)} ·{' '}
                {fmtTime(d.duplicate.ordered_at)}
              </p>
            )}
            <div className="admin-row">
              <button type="button" className="admin-btn" onClick={() => resolveDuplicate(client, d.id, 'duplicate').then(load)}>
                같은 주문 (하나로 통합)
              </button>
              <button type="button" className="admin-btn" onClick={() => resolveDuplicate(client, d.id, 'separate').then(load)}>
                별개 주문 (집계 포함)
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="admin-card" aria-label="메뉴 확인 필요">
        <h2>내부 메뉴와 이름이 다른 주문 메뉴 {menus ? `${menus.length}개` : ''}</h2>
        <p className="admin-muted">연결하면 메뉴별 판매 수량·인기메뉴에 반영돼요. 연결 전에는 소비자 인기메뉴에 쓰지 않아요.</p>
        {menus?.map((m) => (
          <MenuMatchRow key={`${m.restaurant_id}-${m.external_menu_name}`} client={client} item={m} onDone={load} />
        ))}
      </section>
    </section>
  );
}

function MenuMatchRow({ client, item, onDone }: { client: SupabaseClient; item: UnmatchedMenu; onDone: () => void }) {
  const [options, setOptions] = useState<AdminMenu[]>([]);
  const [menuId, setMenuId] = useState('');
  useEffect(() => {
    listMenus(client, item.restaurant_id).then(setOptions).catch(() => setOptions([]));
  }, [client, item.restaurant_id]);
  return (
    <div className="admin-row" role="group" aria-label={`${item.restaurant_name} ${item.external_menu_name}`}>
      <span>
        <strong>{item.restaurant_name}</strong> · ‘{item.external_menu_name}’ ({item.count}건)
      </span>
      <select aria-label="연결할 내부 메뉴" value={menuId} onChange={(e) => setMenuId(e.target.value)}>
        <option value="">내부 메뉴 선택</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="admin-btn"
        disabled={!menuId}
        onClick={() => mapMenu(client, item.restaurant_id, item.external_menu_name, menuId).then(onDone)}
      >
        연결
      </button>
      <button type="button" className="admin-btn" onClick={() => mapMenu(client, item.restaurant_id, item.external_menu_name, null).then(onDone)}>
        집계 제외
      </button>
    </div>
  );
}
