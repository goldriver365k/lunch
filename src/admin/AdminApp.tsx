import { useCallback, useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { checkIsAdmin } from '../lib/db/restaurantsApi';
import { AdminDashboard } from './AdminDashboard';
import { RestaurantAdmin } from './RestaurantAdmin';
import { CsvImportAdmin } from './CsvImportAdmin';
import { TestLocationAdmin } from './TestLocationAdmin';
import { OrdersAdmin } from './orders/OrdersAdmin';
import { PopularAdmin } from './orders/PopularAdmin';
import { MarketAdmin } from './market/MarketAdmin';
import { OpsAdmin } from './ops/OpsAdmin';
import './admin.css';

type Tab = 'home' | 'ops' | 'restaurants' | 'popular' | 'orders' | 'market' | 'import' | 'test';

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: '홈' },
  { key: 'ops', label: '운영 현황' },
  { key: 'restaurants', label: '음식점·메뉴' },
  { key: 'popular', label: '실시간 인기매장' },
  { key: 'orders', label: '주문 데이터' },
  { key: 'market', label: '상권 분석' },
  { key: 'import', label: 'CSV 업로드' },
  { key: 'test', label: '테스트 위치' },
];

export default function AdminApp({ client = supabase }: { client?: SupabaseClient | null }) {
  if (!client) return <SetupGuide />;
  return <AdminGate client={client} />;
}

function AdminGate({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // 관리자 여부는 서버(admin_users + is_admin)로만 판단한다
    checkIsAdmin(client).then((ok) => !cancelled && setAdmin(ok));
    return () => {
      cancelled = true;
    };
  }, [client, session]);

  const signOut = useCallback(async () => {
    await client.auth.signOut();
    setAdmin(null);
  }, [client]);

  if (session === undefined) return <AdminShell>확인 중…</AdminShell>;
  if (!session) return <AdminLogin client={client} />;
  if (admin === null) return <AdminShell>관리자 권한 확인 중…</AdminShell>;
  if (!admin) {
    return (
      <AdminShell>
        <p role="alert">관리자 권한이 없는 계정이에요 ({session.user.email}).</p>
        <button type="button" className="admin-btn" onClick={signOut}>
          로그아웃
        </button>
      </AdminShell>
    );
  }
  return <AdminHome client={client} email={session.user.email ?? ''} onSignOut={signOut} />;
}

function AdminHome({ client, email, onSignOut }: { client: SupabaseClient; email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  return (
    <AdminShell
      right={
        <span className="admin-user">
          {email} ·{' '}
          <button type="button" className="admin-link" onClick={onSignOut}>
            로그아웃
          </button>
        </span>
      }
    >
      <nav className="admin-tabs" role="tablist" aria-label="관리 메뉴">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'home' && <AdminDashboard client={client} />}
      {tab === 'ops' && <OpsAdmin client={client} />}
      {tab === 'restaurants' && <RestaurantAdmin client={client} />}
      {tab === 'popular' && <PopularAdmin client={client} />}
      {tab === 'orders' && <OrdersAdmin client={client} />}
      {tab === 'market' && <MarketAdmin client={client} />}
      {tab === 'import' && <CsvImportAdmin client={client} />}
      {tab === 'test' && <TestLocationAdmin client={client} />}
    </AdminShell>
  );
}

export function AdminShell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="admin">
      <header className="admin-header">
        <a className="admin-logo" href="/">
          점심뭐먹 <small>관리자</small>
        </a>
        {right}
      </header>
      <main>{children}</main>
    </div>
  );
}

function AdminLogin({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.');
  };

  return (
    <AdminShell>
      <form className="admin-card admin-login" onSubmit={submit} aria-label="관리자 로그인">
        <h1>관리자 로그인</h1>
        <label>
          이메일
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="admin-btn primary" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </AdminShell>
  );
}

function SetupGuide() {
  return (
    <AdminShell>
      <section className="admin-card">
        <h1>데이터베이스가 연결되지 않았어요</h1>
        <p>관리자 기능을 쓰려면 Supabase(무료 플랜) 프로젝트를 연결해야 해요.</p>
        <ol>
          <li>supabase.com에서 무료 프로젝트를 만듭니다 (결제 정보 불필요).</li>
          <li>
            SQL Editor에서 <code>supabase/migrations/20261019000000_stage4_restaurants.sql</code>을 실행합니다.
          </li>
          <li>Authentication → Users에서 관리자 계정을 만들고, SQL Editor에서 관리자로 지정합니다.</li>
          <li>
            프로젝트 루트에 <code>.env.local</code>을 만들고 <code>VITE_SUPABASE_URL</code>,{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>를 넣은 뒤 다시 실행합니다. (service_role 키는 넣지 마세요)
          </li>
        </ol>
        <p className="admin-muted">자세한 순서는 README의 ‘실제 DB 연결’을 참고하세요.</p>
      </section>
    </AdminShell>
  );
}
