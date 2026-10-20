import type { CanonicalOrder, OrderProvider } from '../../../supabase/functions/_shared/canonicalOrder.ts';

/**
 * 주문 데이터 연결 모듈 공통 인터페이스.
 * 제공처(POS 업체 · 배민 조회 API 업체 · 쿠팡이츠 조회 API 업체)마다 이 인터페이스를 구현한다.
 *
 * readiness
 * - 'mock'      : 테스트용 가상 연결 (외부 호출 없음, 테스트 주문만 만든다)
 * - 'preparing' : 연동 준비 — 계약·API 명세가 없어 외부 호출을 하지 않는다
 * - 'ready'     : 계약·명세를 확보해 실제 연결 가능 (아직 없음)
 */
export type ConnectorReadiness = 'mock' | 'preparing' | 'ready';
export type IngestKind = 'webhook' | 'polling' | 'file';

export interface ConnectionTestResult {
  ok: boolean;
  readiness: ConnectorReadiness;
  message: string;
  /** 이번 시험에서 실제 외부 API를 호출했는지 */
  calledExternalApi: boolean;
}

export interface OrderConnector {
  provider: OrderProvider;
  vendor: string;
  label: string;
  kind: IngestKind;
  readiness: ConnectorReadiness;
  testConnection(): Promise<ConnectionTestResult>;
  /** 주기 조회(polling)형만. since 이후 주문을 공통 형식으로 돌려준다 */
  fetchOrders?(sinceIso: string): Promise<CanonicalOrder[]>;
}

export class NotContractedError extends Error {
  constructor(label: string) {
    super(`${label}: 계약·API 명세가 없어 외부 호출을 하지 않았어요 (연동 준비)`);
  }
}

/** 계약 전 제공처 — 어떤 경우에도 외부로 요청을 보내지 않는다 */
export function preparingConnector(provider: OrderProvider, vendor: string, label: string, kind: IngestKind): OrderConnector {
  return {
    provider,
    vendor,
    label,
    kind,
    readiness: 'preparing',
    async testConnection() {
      return {
        ok: false,
        readiness: 'preparing',
        message: `연동 준비 — ${label}의 계약·API 명세 확보 전이라 외부 호출을 하지 않았어요 (실제 연결 미검증)`,
        calledExternalApi: false,
      };
    },
    async fetchOrders() {
      throw new NotContractedError(label);
    },
  };
}

export interface PollingDeps {
  /** 호출량·예산 확인 (DB reserve_api_calls). false면 호출하지 않는다 */
  reserveCalls: (calls: number) => Promise<boolean>;
  ingest: (orders: CanonicalOrder[]) => Promise<unknown>;
  recordError: (message: string) => Promise<void>;
}

/**
 * 주기 조회 1회. 서버(Edge Function)에서 실행하는 것을 전제로 한다.
 * 호출 예약이 거부되면(한도·예산 초과, 비활성) 외부 API를 부르지 않는다.
 */
export async function pollOnce(
  connector: OrderConnector,
  sinceIso: string,
  deps: PollingDeps,
): Promise<{ status: 'skipped' | 'ok' | 'error'; count: number; message?: string }> {
  if (!connector.fetchOrders || connector.readiness !== 'ready') {
    return { status: 'skipped', count: 0, message: '연동 준비 상태라 조회하지 않음' };
  }
  if (!(await deps.reserveCalls(1))) return { status: 'skipped', count: 0, message: '호출 한도·예산 초과 또는 비활성' };
  try {
    const orders = await connector.fetchOrders(sinceIso);
    if (orders.length > 0) await deps.ingest(orders);
    return { status: 'ok', count: orders.length };
  } catch (e) {
    await deps.recordError((e as Error).message);
    return { status: 'error', count: 0, message: (e as Error).message };
  }
}
