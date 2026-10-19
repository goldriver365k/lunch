// Supabase Edge Function: 승인된 웹훅으로 주문 수신 (홀 POS · 배민 · 쿠팡이츠 제공업체 공통)
// 배포: supabase functions deploy order-webhook --no-verify-jwt
// 비밀값: supabase secrets set ORDER_WEBHOOK_<연동의 credential_ref>=<제공업체와 공유한 서명 키>
// 요청: POST /functions/v1/order-webhook?connection=<연동 ID>&format=canonical
//       헤더 X-Signature: sha256=<본문 HMAC-SHA256 hex>
// ⚠️ 실제 제공업체 계약·명세가 없어 실제 연결은 검증하지 않았다. 핵심 처리는 _shared/orderWebhook.ts에서 시험한다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleOrderWebhook, type WebhookConnection } from '../_shared/orderWebhook.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const url = new URL(req.url);
  const result = await handleOrderWebhook(
    {
      connectionId: url.searchParams.get('connection'),
      format: url.searchParams.get('format'),
      signature: req.headers.get('x-signature'),
      rawBody: await req.text(),
    },
    {
      getConnection: async (id) => {
        const { data } = await db
          .from('order_connections')
          .select('id, provider, status, is_test, ingest_mode, credential_ref')
          .eq('id', id)
          .maybeSingle();
        return data as WebhookConnection | null;
      },
      getSecret: (ref) => Deno.env.get(`ORDER_WEBHOOK_${ref}`),
      ingest: async (connectionId, orders) => {
        const { data, error } = await db.rpc('ingest_orders', { p_connection_id: connectionId, p_orders: orders });
        if (error) throw new Error(error.message);
        return data;
      },
      recordError: async (connectionId, message) => {
        await db.rpc('record_connection_error', { p_connection_id: connectionId, p_message: message });
      },
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
});
