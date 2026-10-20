import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATEGORIES } from '../lib/constants';
import { IMPORT_REGIONS } from '../lib/publicData/regions';
import {
  coordStatusOf,
  findDuplicates,
  listRestaurants,
  PAGE_SIZE,
  saveRestaurant,
  setRestaurantPublic,
  today,
  type AdminRestaurant,
  type DuplicatePair,
  type RestaurantEditable,
  type RestaurantFilter,
} from './adminApi';
import { kakaoMapPinUrl } from '../lib/mapLinks';
import { MenuAdmin } from './MenuAdmin';

const FILTERS: { key: RestaurantFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'public', label: '공개 중' },
  { key: 'hidden', label: '비공개' },
  { key: 'coord', label: '좌표 오류·누락' },
  { key: 'nomenu', label: '대표메뉴 없음' },
  { key: 'closed', label: '폐업·영업중단' },
];

const CHANNEL_STATUS_LABEL = { yes: '확인됨', no: '운영 안 함', unknown: '미확인' } as const;
const BUSINESS_LABEL = { open: '영업', suspended: '영업중단(휴업 등)', closed: '폐업', unknown: '미확인' } as const;
const COORD_LABEL = { valid: '정상', missing: '누락', invalid: '오류' } as const;
const VERIFY_LABEL = { unverified: '미확인', verified: '확인 완료', needs_review: '재확인 필요' } as const;

const MARKET_CATEGORIES = ['한식', '중식', '일식', '양식', '면류', '분식', '패스트푸드', '기타'];

const EMPTY: RestaurantEditable = {
  name: '',
  category: '한식',
  road_address: '',
  lot_address: '',
  lat: null,
  lng: null,
  business_status: 'open',
  dine_in: 'unknown',
  delivery: 'unknown',
  takeout: 'unknown',
  delivery_radius_m: null,
  delivery_fee_krw: null,
  delivery_eta_minutes: null,
  baemin_order_url: null,
  coupangeats_order_url: null,
  market_category: null,
  verify_status: 'unverified',
  last_verified_at: null,
  is_public: false,
  region_id: 'seolleung_yeoksam',
};

function editableOf(r: AdminRestaurant): RestaurantEditable {
  return {
    name: r.name,
    category: r.category,
    road_address: r.road_address ?? '',
    lot_address: r.lot_address ?? '',
    lat: r.lat,
    lng: r.lng,
    business_status: r.business_status,
    dine_in: r.dine_in,
    delivery: r.delivery,
    takeout: r.takeout,
    delivery_radius_m: r.delivery_radius_m,
    delivery_fee_krw: r.delivery_fee_krw ?? null,
    delivery_eta_minutes: r.delivery_eta_minutes ?? null,
    baemin_order_url: r.baemin_order_url ?? null,
    coupangeats_order_url: r.coupangeats_order_url ?? null,
    market_category: r.market_category ?? null,
    verify_status: r.verify_status,
    last_verified_at: r.last_verified_at,
    is_public: r.is_public,
    region_id: r.region_id,
  };
}

export function RestaurantAdmin({ client }: { client: SupabaseClient }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RestaurantFilter>('all');
  const [page, setPage] = useState(0);
  const [list, setList] = useState<{ rows: AdminRestaurant[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminRestaurant | 'new' | null>(null);
  const [dups, setDups] = useState<DuplicatePair[] | null>(null);

  const load = useCallback(() => {
    setError(null);
    listRestaurants(client, { q, filter, page })
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [client, q, filter, page]);

  useEffect(() => {
    const h = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [load, q]);

  if (editing) {
    return (
      <RestaurantForm
        client={client}
        restaurant={editing === 'new' ? null : editing}
        onClose={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <section aria-label="음식점 관리">
      <div className="admin-toolbar">
        <input
          type="search"
          placeholder="이름·주소·관리번호 검색"
          aria-label="음식점 검색"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="필터"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as RestaurantFilter);
            setPage(0);
          }}
        >
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" className="admin-btn primary" onClick={() => setEditing('new')}>
          + 신규 등록
        </button>
        <button
          type="button"
          className="admin-btn"
          onClick={() =>
            findDuplicates(client)
              .then(setDups)
              .catch((e: Error) => setError(e.message))
          }
        >
          중복 확인
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {dups && (
        <section className="admin-card" aria-label="중복 의심 매장">
          <h2>중복 의심 {dups.length}쌍</h2>
          {dups.length === 0 ? (
            <p className="admin-muted">같은 이름이 30m 안이나 같은 주소에 있는 매장이 없어요.</p>
          ) : (
            <ul className="admin-dups">
              {dups.map((d) => (
                <li key={`${d.a_id}-${d.b_id}`}>
                  {d.a_name} ↔ {d.b_name} <span className="admin-muted">({d.reason}, {d.distance_m ?? '?'}m)</span>{' '}
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => setRestaurantPublic(client, d.b_id, false).then(load)}
                  >
                    뒤 매장 비공개
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="admin-link" onClick={() => setDups(null)}>
            닫기
          </button>
        </section>
      )}

      {!list ? (
        <p>불러오는 중…</p>
      ) : (
        <>
          <p className="admin-muted">{list.total.toLocaleString('ko-KR')}곳</p>
          <table className="admin-table admin-list">
            <thead>
              <tr>
                <th>음식점</th>
                <th>상태</th>
                <th>공개</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="admin-link strong" onClick={() => setEditing(r)}>
                      {r.name}
                    </button>
                    <div className="admin-muted">
                      {r.category} · {r.road_address ?? r.lot_address ?? '주소 없음'}
                    </div>
                  </td>
                  <td className="admin-muted">
                    {BUSINESS_LABEL[r.business_status]} · 좌표 {COORD_LABEL[r.coord_status]}
                    {r.has_signature_menu ? '' : ' · 대표메뉴 없음'}
                  </td>
                  <td>
                    <label className="admin-switch">
                      <input
                        type="checkbox"
                        checked={r.is_public}
                        aria-label={`${r.name} 앱 공개`}
                        onChange={(e) => setRestaurantPublic(client, r.id, e.target.checked).then(load)}
                      />
                      {r.is_public ? '공개' : '비공개'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-pager">
            <button type="button" className="admin-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
              이전
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(list.total / PAGE_SIZE))}
            </span>
            <button
              type="button"
              className="admin-btn"
              disabled={(page + 1) * PAGE_SIZE >= list.total}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function RestaurantForm({
  client,
  restaurant,
  onClose,
}: {
  client: SupabaseClient;
  restaurant: AdminRestaurant | null;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<AdminRestaurant | null>(restaurant);
  const [v, setV] = useState<RestaurantEditable>(restaurant ? editableOf(restaurant) : EMPTY);
  const [latText, setLatText] = useState(restaurant?.lat?.toString() ?? '');
  const [lngText, setLngText] = useState(restaurant?.lng?.toString() ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lat = numOrNull(latText);
  const lng = numOrNull(lngText);
  const coord = Number.isNaN(lat) || Number.isNaN(lng) ? 'invalid' : coordStatusOf(lat, lng);
  const set = <K extends keyof RestaurantEditable>(k: K, val: RestaurantEditable[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return setMessage('음식점명을 입력해 주세요.');
    if (Number.isNaN(lat) || Number.isNaN(lng)) return setMessage('위도·경도는 숫자로 입력해 주세요.');
    if (v.is_public && coord !== 'valid') return setMessage('좌표가 정상이어야 앱에 공개할 수 있어요.');
    const baemin = v.baemin_order_url?.trim() || null;
    const coupang = v.coupangeats_order_url?.trim() || null;
    if ([baemin, coupang].some((u) => u && !/^https:\/\/\S+$/.test(u))) return setMessage('배달앱 주문 링크는 https:// 주소만 넣을 수 있어요.');
    if (v.delivery_eta_minutes !== null && (v.delivery_eta_minutes < 1 || v.delivery_eta_minutes > 240))
      return setMessage('배달 예상시간은 1~240분이에요.');
    setBusy(true);
    setMessage(null);
    try {
      const row = await saveRestaurant(client, saved?.id ?? null, {
        ...v,
        name: v.name.trim(),
        road_address: v.road_address?.trim() || null,
        lot_address: v.lot_address?.trim() || null,
        lat,
        lng,
        baemin_order_url: baemin,
        coupangeats_order_url: coupang,
      });
      setSaved(row);
      setMessage('저장했어요. 소비자 앱 검색에 바로 반영돼요.');
    } catch (err) {
      setMessage(`저장하지 못했어요: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={saved ? `${saved.name} 수정` : '음식점 신규 등록'}>
      <button type="button" className="admin-link" onClick={onClose}>
        ‹ 목록
      </button>
      <form className="admin-card admin-form" onSubmit={submit}>
        <h2>{saved ? '음식점 수정' : '음식점 신규 등록'}</h2>
        {saved?.license_no && (
          <p className="admin-muted">
            관리번호 {saved.license_no} · 출처 {saved.source_name ?? saved.source}
            {saved.source_collected_at && ` (수집 ${saved.source_collected_at})`}
          </p>
        )}
        <label>
          음식점명
          <input required value={v.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          음식 종류
          <select value={v.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          상권 분석 음식 종류 — 비우면 음식 종류로 자동 분류 (면류는 직접 지정)
          <select value={v.market_category ?? ''} onChange={(e) => set('market_category', e.target.value || null)}>
            <option value="">자동</option>
            {MARKET_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          도로명주소
          <input value={v.road_address ?? ''} onChange={(e) => set('road_address', e.target.value)} />
        </label>
        <label>
          지번주소
          <input value={v.lot_address ?? ''} onChange={(e) => set('lot_address', e.target.value)} />
        </label>
        <div className="admin-row">
          <label>
            위도
            <input inputMode="decimal" value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="37.5045" />
          </label>
          <label>
            경도
            <input inputMode="decimal" value={lngText} onChange={(e) => setLngText(e.target.value)} placeholder="127.049" />
          </label>
        </div>
        <p className="admin-muted">
          좌표 {COORD_LABEL[coord]}
          {coord === 'valid' && lat !== null && lng !== null && (
            <>
              {' · '}
              <a href={kakaoMapPinUrl(v.name || '위치 확인', lat, lng)} target="_blank" rel="noopener noreferrer">
                카카오맵에서 위치 확인
              </a>
            </>
          )}
        </p>
        <div className="admin-row">
          <label>
            영업상태
            <select value={v.business_status} onChange={(e) => set('business_status', e.target.value as RestaurantEditable['business_status'])}>
              {Object.entries(BUSINESS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            지역
            <select value={v.region_id ?? ''} onChange={(e) => set('region_id', (e.target.value || null) as RestaurantEditable['region_id'])}>
              <option value="">지정 안 함</option>
              {IMPORT_REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-row three">
          {(
            [
              ['dine_in', '홀'],
              ['delivery', '배달'],
              ['takeout', '포장'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label} 운영
              <select value={v[k]} onChange={(e) => set(k, e.target.value as RestaurantEditable[typeof k])}>
                {Object.entries(CHANNEL_STATUS_LABEL).map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          배달 가능 거리(m) — 확인된 경우만
          <input
            inputMode="numeric"
            value={v.delivery_radius_m ?? ''}
            onChange={(e) => set('delivery_radius_m', e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)}
          />
        </label>
        <div className="admin-row">
          <label>
            배달비(원) — 확인된 경우만
            <input
              inputMode="numeric"
              value={v.delivery_fee_krw ?? ''}
              onChange={(e) => set('delivery_fee_krw', e.target.value ? Math.max(0, Math.round(Number(e.target.value) || 0)) : null)}
            />
          </label>
          <label>
            배달 예상시간(분) — 확인된 경우만
            <input
              inputMode="numeric"
              value={v.delivery_eta_minutes ?? ''}
              onChange={(e) => set('delivery_eta_minutes', e.target.value ? Math.round(Number(e.target.value) || 0) : null)}
            />
          </label>
        </div>
        <label>
          배민 주문 링크 — 매장·배달앱 승인을 받은 경우만 (https://)
          <input type="url" value={v.baemin_order_url ?? ''} onChange={(e) => set('baemin_order_url', e.target.value || null)} />
        </label>
        <label>
          쿠팡이츠 주문 링크 — 매장·배달앱 승인을 받은 경우만 (https://)
          <input type="url" value={v.coupangeats_order_url ?? ''} onChange={(e) => set('coupangeats_order_url', e.target.value || null)} />
        </label>
        <div className="admin-row">
          <label>
            데이터 확인 상태
            <select value={v.verify_status} onChange={(e) => set('verify_status', e.target.value as RestaurantEditable['verify_status'])}>
              {Object.entries(VERIFY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            최종 확인일
            <input type="date" value={v.last_verified_at ?? ''} onChange={(e) => set('last_verified_at', e.target.value || null)} />
          </label>
        </div>
        <button
          type="button"
          className="admin-link"
          onClick={() => setV((x) => ({ ...x, verify_status: 'verified', last_verified_at: today() }))}
        >
          오늘 확인 완료로 표시
        </button>
        <label className="admin-switch">
          <input type="checkbox" checked={v.is_public} onChange={(e) => set('is_public', e.target.checked)} />앱에 공개
        </label>
        {message && <p role="status">{message}</p>}
        <button type="submit" className="admin-btn primary" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </form>
      {saved ? (
        <MenuAdmin client={client} restaurantId={saved.id} />
      ) : (
        <p className="admin-muted">음식점을 먼저 저장하면 메뉴를 등록할 수 있어요.</p>
      )}
    </section>
  );
}
