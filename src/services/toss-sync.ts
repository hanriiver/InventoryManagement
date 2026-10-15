import type { Env } from '../types';
import * as repo from '../db/repo';
import { TossClient, tossConfigured } from '../toss/client';
import { extractOrderList, normalizeOrder, type NormalizedOrder } from '../toss/normalize';
import { processOrder, type ProcessResult } from './inventory';

/** 주문 단건을 토스에서 다시 조회해 반영 (웹훅 본문은 신뢰하지 않음) */
export async function syncOrderById(env: Env, orderId: string): Promise<ProcessResult> {
  const raw = await new TossClient(env).getOrder(orderId);
  return processOrder(env, normalizeOrder(raw), raw);
}

/**
 * 최근 주문 목록을 훑어 상태가 바뀐 주문만 반영. 웹훅이 누락돼도 크론이 메워 줍니다.
 * 목록 응답에 메뉴 항목이 없으면 상세 조회로 보충합니다.
 */
export async function syncRecentOrders(env: Env, pages = 1): Promise<ProcessResult[]> {
  if (!tossConfigured(env)) return [];
  const client = new TossClient(env);
  const results: ProcessResult[] = [];
  for (let page = 1; page <= pages; page++) {
    const list = extractOrderList(await client.listOrders(page, 100));
    for (const entry of list) {
      let order: NormalizedOrder;
      try {
        order = normalizeOrder(entry);
      } catch (e) {
        console.warn('주문 목록 항목 해석 실패', e);
        continue;
      }
      const known = await repo.getOrderState(env.DB, order.orderId);
      if (known === order.state) continue;
      let raw: unknown = entry;
      if (order.status === 'COMPLETED' && order.items.length === 0) {
        raw = await client.getOrder(order.orderId);
        order = normalizeOrder(raw);
      }
      results.push(await processOrder(env, order, raw));
    }
    if (list.length < 100) break;
  }
  await repo.setSetting(env.DB, 'last_sync_at', new Date().toISOString());
  return results;
}
