import { vi } from 'vitest';

/** 시험용 가짜 Supabase 클라이언트 — 쿼리 빌더 호출을 기록하고 정해 둔 응답을 돌려준다 */
export interface QueryCall {
  table: string;
  ops: [string, unknown[]][];
}

type Result = { data: unknown; error: { message: string } | null; count?: number };

export interface FakeOptions {
  rpc?: (fn: string, args: Record<string, unknown>) => Result | Promise<Result>;
  query?: (call: QueryCall) => Result | Promise<Result>;
  session?: { user: { email: string } } | null;
  signIn?: (email: string, password: string) => { error: { message: string } | null };
}

export function fakeSupabase(opts: FakeOptions = {}) {
  const queries: QueryCall[] = [];
  let session = opts.session ?? null;
  const listeners = new Set<(e: string, s: unknown) => void>();

  const from = (table: string) => {
    const call: QueryCall = { table, ops: [] };
    queries.push(call);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(opts.query ? opts.query(call) : { data: [], error: null }).then(res, rej);
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };

  const client = {
    from: vi.fn(from),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: `no rpc ${fn}` } },
    ),
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      }),
      signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
        const r = opts.signIn ? opts.signIn(email, password) : { error: null };
        if (!r.error) {
          session = { user: { email } };
          listeners.forEach((cb) => cb('SIGNED_IN', session));
        }
        return r;
      }),
      signOut: vi.fn(async () => {
        session = null;
        listeners.forEach((cb) => cb('SIGNED_OUT', null));
        return { error: null };
      }),
    },
  };
  return { client, queries };
}
