import type { Env } from '../types';
import * as repo from '../db/repo';
import { TossClient, tossConfigured } from '../toss/client';
import { extractOrderList, normalizeOrder, type NormalizedOrder } from '../toss/normalize';
import { loadOrderCatalog, processOrder, type OrderCatalog, type ProcessResult } from './inventory';

/** 주문 단건을 토스에서 다시 조회해 반영 (웹훅 본문은 신뢰하지 않음) */
export async function syncOrderById(env: Env, orderId: string): Promise<ProcessResult> {
  // 시작 기준점을 잡기 전이면 웹훅 주문도 차감하지 않고 기준점부터 잡음
  if (!(await repo.getSetting(env.DB, 'sync_baseline_at'))) {
    await syncRecentOrders(env);
    return { orderId, status: 'BASELINE', changed: 0, unmapped: [] };
  }
  const raw = await new TossClient(env).getOrder(orderId);
  return processOrder(env, normalizeOrder(raw), raw);
}

/**
 * 최근 주문 목록을 훑어 상태가 바뀐 주문만 반영. 웹훅이 누락돼도 크론이 메워 줍니다.
 * 목록 응답에 메뉴 항목이 없으면 상세 조회로 보충합니다.
 */
export async function syncRecentOrders(env: Env, pages = 1): Promise<ProcessResult[]> {
  if (!tossConfigured(env)) return [];
  if (!(await repo.getSetting(env.DB, 'sync_baseline_at'))) return markBaseline(env);
  const client = new TossClient(env);
  const results: ProcessResult[] = [];
  let catalog: OrderCatalog | undefined; // 바뀐 주문이 있을 때만 한 번 읽음
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
      catalog ??= await loadOrderCatalog(env.DB);
      results.push(await processOrder(env, order, raw, catalog));
    }
    if (list.length < 100) break;
  }
  await repo.setSetting(env.DB, 'last_sync_at', new Date().toISOString());
  return results;
}

/**
 * 첫 동기화: 지금까지 쌓인 주문은 "이미 지난 판매"로 기록만 하고 재고는 빼지 않습니다.
 * (재고를 입력하기 전에 팔린 주문까지 차감되는 것 방지) 이후 새로 완료되는 주문부터 차감합니다.
 */
export async function markBaseline(env: Env, pages = 3): Promise<ProcessResult[]> {
  const client = new TossClient(env);
  const results: ProcessResult[] = [];
  for (let page = 1; page <= pages; page++) {
    const list = extractOrderList(await client.listOrders(page, 100));
    for (const entry of list) {
      let order: NormalizedOrder;
      try {
        order = normalizeOrder(entry);
      } catch {
        continue;
      }
      if (await repo.getOrderState(env.DB, order.orderId)) continue;
      await repo.upsertOrder(env.DB, order.orderId, order.state, 'BASELINE', JSON.stringify(entry));
      results.push({ orderId: order.orderId, status: 'BASELINE', changed: 0, unmapped: [] });
    }
    if (list.length < 100) break;
  }
  const now = new Date().toISOString();
  await repo.setSetting(env.DB, 'sync_baseline_at', now);
  await repo.setSetting(env.DB, 'last_sync_at', now);
  return results;
}
