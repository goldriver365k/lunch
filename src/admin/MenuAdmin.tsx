import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteMenu, listMenus, parsePrice, saveMenu, today, type AdminMenu, type MenuEditable } from './adminApi';

const PRICE_FIELDS = [
  ['price_dine_in', '홀'],
  ['price_delivery', '배달'],
  ['price_takeout', '포장'],
] as const;

const NEW_MENU: MenuEditable = {
  name: '',
  is_signature: false,
  price_dine_in: null,
  price_delivery: null,
  price_takeout: null,
  sort_order: 0,
  is_available: true,
  is_public: true,
  price_verified_at: null,
};

export function MenuAdmin({ client, restaurantId }: { client: SupabaseClient; restaurantId: string }) {
  const [menus, setMenus] = useState<AdminMenu[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listMenus(client, restaurantId)
      .then(setMenus)
      .catch((e: Error) => setError(e.message));
  }, [client, restaurantId]);
  useEffect(load, [load]);

  return (
    <section className="admin-card" aria-label="대표메뉴와 가격">
      <h2>대표메뉴와 가격</h2>
      <p className="admin-muted">가격을 모르면 비워 두세요 — 앱에 ‘가격정보 없음’으로 표시돼요. 홀·배달·포장 가격은 따로 저장돼요.</p>
      {error && <p role="alert">{error}</p>}
      {!menus ? (
        <p>불러오는 중…</p>
      ) : (
        <>
          {menus.map((m) => (
            <MenuRow key={m.id} client={client} restaurantId={restaurantId} menu={m} onChanged={load} />
          ))}
          <MenuRow
            key={`new-${menus.length}`}
            client={client}
            restaurantId={restaurantId}
            menu={null}
            nextOrder={menus.length + 1}
            onChanged={load}
          />
        </>
      )}
    </section>
  );
}

function MenuRow({
  client,
  restaurantId,
  menu,
  nextOrder = 0,
  onChanged,
}: {
  client: SupabaseClient;
  restaurantId: string;
  menu: AdminMenu | null;
  nextOrder?: number;
  onChanged: () => void;
}) {
  const base: MenuEditable = menu ?? { ...NEW_MENU, sort_order: nextOrder };
  const [v, setV] = useState<MenuEditable>(base);
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(PRICE_FIELDS.map(([k]) => [k, base[k]?.toString() ?? ''])),
  );
  const [message, setMessage] = useState<string | null>(null);
  const label = menu ? menu.name : '새 메뉴';

  const save = async () => {
    if (!v.name.trim()) return setMessage('메뉴명을 입력해 주세요.');
    const parsed = Object.fromEntries(PRICE_FIELDS.map(([k]) => [k, parsePrice(prices[k])]));
    if (Object.values(parsed).includes('invalid')) return setMessage('가격은 1원 이상의 정수로 입력하거나 비워 두세요.');
    const next = { ...v, ...(parsed as Pick<MenuEditable, 'price_dine_in' | 'price_delivery' | 'price_takeout'>) };
    const priceChanged = PRICE_FIELDS.some(([k]) => next[k] !== base[k]);
    if (priceChanged) next.price_verified_at = today();
    try {
      await saveMenu(client, restaurantId, menu?.id ?? null, { ...next, name: next.name.trim() });
      setMessage(null);
      onChanged();
    } catch (e) {
      setMessage(`저장하지 못했어요: ${(e as Error).message}`);
    }
  };

  return (
    <fieldset className="admin-menu-row" aria-label={label}>
      <div className="admin-row">
        <label>
          메뉴명
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        <label className="admin-switch">
          <input type="checkbox" checked={v.is_signature} onChange={(e) => setV({ ...v, is_signature: e.target.checked })} />
          대표메뉴
        </label>
      </div>
      <div className="admin-row three">
        {PRICE_FIELDS.map(([k, l]) => (
          <label key={k}>
            {l} 가격
            <input
              inputMode="numeric"
              placeholder="가격정보 없음"
              value={prices[k]}
              onChange={(e) => setPrices({ ...prices, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="admin-row">
        <label>
          노출 순서
          <input
            inputMode="numeric"
            value={v.sort_order}
            onChange={(e) => setV({ ...v, sort_order: Math.round(Number(e.target.value) || 0) })}
          />
        </label>
        <label className="admin-switch">
          <input type="checkbox" checked={v.is_available} onChange={(e) => setV({ ...v, is_available: e.target.checked })} />
          판매 중
        </label>
        <label className="admin-switch">
          <input type="checkbox" checked={v.is_public} onChange={(e) => setV({ ...v, is_public: e.target.checked })} />
          메뉴 공개
        </label>
      </div>
      {menu?.price_verified_at && <p className="admin-muted">가격 확인일 {menu.price_verified_at}</p>}
      {message && <p role="alert">{message}</p>}
      <div className="admin-row">
        <button type="button" className="admin-btn primary" onClick={save}>
          {menu ? '메뉴 저장' : '메뉴 추가'}
        </button>
        {menu && (
          <button
            type="button"
            className="admin-btn danger"
            onClick={async () => {
              if (!window.confirm(`‘${menu.name}’ 메뉴를 삭제할까요?`)) return;
              await deleteMenu(client, restaurantId, menu.id);
              onChanged();
            }}
          >
            삭제
          </button>
        )}
      </div>
    </fieldset>
  );
}
