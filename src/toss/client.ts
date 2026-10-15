import type { Env } from '../types';

/**
 * 공통 가이드에 나온 주문 목록 경로를 기준으로 했습니다.
 * 주문 단건 조회 경로는 REST 관례로 추정한 값이라, 문서와 다르면 여기만 고치면 됩니다.
 */
export const TOSS_PATHS = {
  // 카탈로그 경로도 다른 API(/order/orders, /payment/payments)와 같은 패턴으로 추정
  listCatalogItems: (merchantId: string) => `/merchants/${merchantId}/catalog/items`,
  listOrders: (merchantId: string) => `/merchants/${merchantId}/order/orders`,
  getOrder: (merchantId: string, orderId: string) =>
    `/merchants/${merchantId}/order/orders/${encodeURIComponent(orderId)}`,
};

export class TossNotConfiguredError extends Error {
  constructor() {
    super('토스 API 키가 설정되지 않았습니다 (TOSS_ACCESS_KEY, TOSS_SECRET_KEY, TOSS_MERCHANT_ID)');
  }
}

export function tossConfigured(env: Env): boolean {
  return Boolean(env.TOSS_ACCESS_KEY && env.TOSS_SECRET_KEY && env.TOSS_MERCHANT_ID);
}

export class TossClient {
  constructor(private env: Env) {
    if (!tossConfigured(env)) throw new TossNotConfiguredError();
  }

  private get merchantId(): string {
    return this.env.TOSS_MERCHANT_ID!;
  }

  private async request(path: string, query?: Record<string, string | number>): Promise<unknown> {
    const url = new URL(this.env.TOSS_API_BASE.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      headers: {
        'x-access-key': this.env.TOSS_ACCESS_KEY!,
        'x-secret-key': this.env.TOSS_SECRET_KEY!,
        'content-type': 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`토스 API ${res.status} ${path}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  listOrders(page = 1, size = 100): Promise<unknown> {
    return this.request(TOSS_PATHS.listOrders(this.merchantId), { page, size, sortOrder: 'DESC' });
  }

  listCatalogItems(page = 1, size = 500): Promise<unknown> {
    return this.request(TOSS_PATHS.listCatalogItems(this.merchantId), { page, size });
  }

  getOrder(orderId: string): Promise<unknown> {
    return this.request(TOSS_PATHS.getOrder(this.merchantId, orderId));
  }
}
