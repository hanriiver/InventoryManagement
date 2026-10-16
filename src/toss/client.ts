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
  constructor(what: string) {
    super(`토스 API 키가 설정되지 않았습니다 (${what})`);
  }
}

/** 주문(매출) 조회 가능 여부: sale 앱 키 + 매장 ID */
export function tossConfigured(env: Env): boolean {
  return Boolean(env.TOSS_ACCESS_KEY && env.TOSS_SECRET_KEY && env.TOSS_MERCHANT_ID);
}

/** 메뉴 조회 가능 여부: menu 앱 키(없으면 sale 앱 키) + 매장 ID */
export function tossMenuConfigured(env: Env): boolean {
  return Boolean(menuKeys(env) && env.TOSS_MERCHANT_ID);
}

function menuKeys(env: Env): [string, string] | null {
  if (env.TOSS_MENU_ACCESS_KEY && env.TOSS_MENU_SECRET_KEY) return [env.TOSS_MENU_ACCESS_KEY, env.TOSS_MENU_SECRET_KEY];
  if (env.TOSS_ACCESS_KEY && env.TOSS_SECRET_KEY) return [env.TOSS_ACCESS_KEY, env.TOSS_SECRET_KEY];
  return null;
}

/** 토스플레이스는 앱마다 권한이 달라 메뉴(menu 앱)와 매출(sale 앱) 키를 따로 쓸 수 있습니다 */
export class TossClient {
  constructor(private env: Env) {
    if (!env.TOSS_MERCHANT_ID) throw new TossNotConfiguredError('TOSS_MERCHANT_ID');
  }

  private get merchantId(): string {
    return this.env.TOSS_MERCHANT_ID!;
  }

  private keys(kind: 'menu' | 'sale'): [string, string] {
    if (kind === 'menu') {
      const k = menuKeys(this.env);
      if (!k) throw new TossNotConfiguredError('TOSS_MENU_ACCESS_KEY, TOSS_MENU_SECRET_KEY');
      return k;
    }
    if (!tossConfigured(this.env)) throw new TossNotConfiguredError('TOSS_ACCESS_KEY, TOSS_SECRET_KEY');
    return [this.env.TOSS_ACCESS_KEY!, this.env.TOSS_SECRET_KEY!];
  }

  private async request(kind: 'menu' | 'sale', path: string, query?: Record<string, string | number>): Promise<unknown> {
    const [accessKey, secretKey] = this.keys(kind);
    const url = new URL(this.env.TOSS_API_BASE.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      headers: {
        'x-access-key': accessKey,
        'x-secret-key': secretKey,
        accept: 'application/json',
        'content-type': 'application/json',
        // Cloudflare Workers의 fetch는 User-Agent를 보내지 않아 방화벽에서 막히는 경우가 있어 명시
        'user-agent': 'InventoryManagement/1.0 (+cloudflare-workers)',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(describeError(res.status, path, text));
    return text ? JSON.parse(text) : null;
  }

  listOrders(page = 1, size = 100): Promise<unknown> {
    return this.request('sale', TOSS_PATHS.listOrders(this.merchantId), { page, size, sortOrder: 'DESC' });
  }

  listCatalogItems(page = 1, size = 500): Promise<unknown> {
    return this.request('menu', TOSS_PATHS.listCatalogItems(this.merchantId), { page, size });
  }

  getOrder(orderId: string): Promise<unknown> {
    return this.request('sale', TOSS_PATHS.getOrder(this.merchantId, orderId));
  }
}

/** 토스 오류를 사람이 읽을 수 있게. HTML 차단 페이지면 원인 안내 */
export function describeError(status: number, path: string, body: string): string {
  const isHtml = /^\s*</.test(body);
  if (isHtml && status === 403) {
    return `토스가 이 서버의 요청을 차단했습니다 (403, ${path}). 토스 개발자센터에 허용 IP 설정이 있는지, 앱이 이 매장에 연결돼 있는지 확인해 주세요.`;
  }
  if (status === 401 || status === 403) return `토스 인증 실패 (${status}, ${path}): 키와 매장 ID, 앱 권한을 확인해 주세요. ${body.slice(0, 200)}`;
  return `토스 API ${status} ${path}: ${isHtml ? '(HTML 응답)' : body.slice(0, 300)}`;
}
