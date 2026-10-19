import { useCallback, useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchViewerRole, type ViewerRole } from '../lib/market/marketApi';
import { MarketDashboard } from './MarketDashboard';
import './market.css';

/** 사업자용 점심 상권 분석 (/business/market). 사업자·관리자 권한은 서버(market_viewer_role)로만 판단한다. */
export default function BusinessApp({ client = supabase }: { client?: SupabaseClient | null }) {
  if (!client) {
    return (
      <Shell>
        <section className="mk-card">
          <h1>데이터베이스가 연결되지 않았어요</h1>
          <p className="mk-muted">상권 분석은 실제 주문 데이터로만 계산해요. 연결 방법은 README의 ‘실제 DB 연결’을 참고하세요.</p>
        </section>
      </Shell>
    );
  }
  return <Gate client={client} />;
}

function Gate({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [role, setRole] = useState<ViewerRole | undefined>(undefined);

  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchViewerRole(client).then((r) => !cancelled && setRole(r));
    return () => {
      cancelled = true;
    };
  }, [client, session]);

  const signOut = useCallback(async () => {
    await client.auth.signOut();
    setRole(undefined);
  }, [client]);

  if (session === undefined) return <Shell>확인 중…</Shell>;
  if (!session) return <Login client={client} />;
  if (role === undefined) return <Shell>권한 확인 중…</Shell>;
  const right = (
    <span className="mk-user">
      {session.user.email} ·{' '}
      <button type="button" className="mk-link" onClick={signOut}>
        로그아웃
      </button>
    </span>
  );
  if (!role) {
    return (
      <Shell right={right}>
        <p role="alert">사업자 분석 이용 권한이 없는 계정이에요. 이용 신청은 운영팀에 문의해 주세요.</p>
      </Shell>
    );
  }
  return (
    <Shell right={right}>
      {role === 'admin' && <p className="mk-muted">관리자 계정으로 보고 있어요. 테스트 데이터와 내부 지표를 함께 볼 수 있어요.</p>}
      <MarketDashboard client={client} role={role} />
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mk-page">
      <header className="mk-header">
        <a className="mk-logo" href="/">
          점심뭐먹 <small>사업자 · 점심 상권 분석</small>
        </a>
        {right}
      </header>
      <main>{children}</main>
    </div>
  );
}

function Login({ client }: { client: SupabaseClient }) {
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
    <Shell>
      <form className="mk-card mk-login" onSubmit={submit} aria-label="사업자 로그인">
        <h1>사업자 로그인</h1>
        <label>
          이메일
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          비밀번호
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="mk-btn primary" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </Shell>
  );
}
