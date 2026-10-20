import { OrderValidationError, sanitizeOrder, type CanonicalOrder, type OrderProvider } from './canonicalOrder.ts';

/**
 * 승인된 웹훅으로 주문을 받는 공통 처리 (Edge Function에서 사용).
 * - 연동별 비밀값으로 HMAC-SHA256 서명을 확인한다 (비밀값은 Edge Function 환경변수에만 둔다).
 * - 활성화된 실제 연동만 받는다.
 * - 제공처 고유 형식은 API 명세·계약을 확보한 뒤 어댑터를 추가한다. 지금은 공통 형식(canonical)만 받는다.
 */

export interface WebhookConnection {
  id: string;
  provider: OrderProvider;
  status: string;
  is_test: boolean;
  ingest_mode: string;
  credential_ref: string | null;
}

export interface WebhookDeps {
  getConnection: (id: string) => Promise<WebhookConnection | null>;
  getSecret: (credentialRef: string) => string | undefined;
  ingest: (connectionId: string, orders: CanonicalOrder[]) => Promise<unknown>;
  recordError: (connectionId: string, message: string) => Promise<void>;
  /** 제공처가 알려준 '여기까지의 주문이 반영됨' 시각 (본문 as_of) — 최신 여부 판단에 쓴다 */
  reportAsOf?: (connectionId: string, asOf: string) => Promise<void>;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const enc = new TextEncoder();

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 시간 차이로 서명이 새지 않도록 길이가 같을 때 끝까지 비교한다 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 제공처 고유 형식 → 공통 형식. 명세가 없는 제공처는 거부한다. */
export function normalizeProviderPayload(format: string, payload: unknown): CanonicalOrder[] {
  if (format !== 'canonical') {
    throw new NotSupportedFormatError(`${format} 형식은 아직 지원하지 않아요 (API 명세·계약 확보 후 어댑터 추가)`);
  }
  const list = (payload as { orders?: unknown }).orders;
  if (!Array.isArray(list)) throw new OrderValidationError('orders 배열이 없어요');
  return list.map((o) => sanitizeOrder(o as Record<string, unknown>));
}

export class NotSupportedFormatError extends Error {}

export async function handleOrderWebhook(
  req: { connectionId: string | null; signature: string | null; format: string | null; rawBody: string },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  if (!req.connectionId) return { status: 400, body: { error: 'connection id required' } };
  const conn = await deps.getConnection(req.connectionId);
  if (!conn || conn.is_test || conn.ingest_mode !== 'webhook') return { status: 404, body: { error: 'unknown connection' } };
  if (conn.status !== 'active') return { status: 409, body: { error: `connection ${conn.status}` } };
  const secret = conn.credential_ref ? deps.getSecret(conn.credential_ref) : undefined;
  if (!secret) return { status: 503, body: { error: 'webhook secret not configured' } };
  const expected = await hmacHex(secret, req.rawBody);
  const given = (req.signature ?? '').replace(/^sha256=/, '').toLowerCase();
  if (!safeEqual(expected, given)) return { status: 401, body: { error: 'invalid signature' } };

  let orders: CanonicalOrder[];
  let asOf: string | null = null;
  try {
    const payload = JSON.parse(req.rawBody);
    orders = normalizeProviderPayload(req.format ?? 'canonical', payload);
    const t = Date.parse(String((payload as { as_of?: unknown }).as_of ?? ''));
    asOf = Number.isFinite(t) ? new Date(t).toISOString() : null;
  } catch (e) {
    const status = e instanceof NotSupportedFormatError ? 501 : 422;
    await deps.recordError(conn.id, `웹훅 형식 오류: ${(e as Error).message}`);
    return { status, body: { error: (e as Error).message } };
  }
  try {
    const result = await deps.ingest(conn.id, orders);
    if (asOf && deps.reportAsOf) await deps.reportAsOf(conn.id, asOf);
    return { status: 200, body: { ok: true, result: result as Record<string, unknown> } };
  } catch (e) {
    await deps.recordError(conn.id, `수집 실패: ${(e as Error).message}`);
    return { status: 500, body: { error: 'ingest failed' } };
  }
}
