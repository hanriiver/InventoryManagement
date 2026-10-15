import type { Env, MenuItem } from '../types';
import * as repo from '../db/repo';
import { TossClient } from '../toss/client';
import { extractCatalogList, normalizeCatalog, type CatalogEntry } from '../toss/catalog';
import { extractOrderList, normalizeOrder } from '../toss/normalize';

export interface ImportResult {
  source: 'catalog' | 'orders';
  added: string[];
  updated: number;
  total: number;
}

/** 토스 카탈로그(매장에 등록된 상품)에서 메뉴·옵션을 불러와 등록. 레시피는 건드리지 않음 */
export async function importMenusFromCatalog(env: Env): Promise<ImportResult> {
  const client = new TossClient(env);
  const raw: unknown[] = [];
  for (let page = 1; page <= 10; page++) {
    const list = extractCatalogList(await client.listCatalogItems(page, 500));
    raw.push(...list);
    if (list.length < 500) break;
  }
  return upsertMenus(env, normalizeCatalog(raw), 'catalog');
}

/** 카탈로그 API를 못 쓸 때: 최근 주문에 나온 메뉴·옵션 이름으로 등록 */
export async function importMenusFromOrders(env: Env, pages = 3): Promise<ImportResult> {
  const client = new TossClient(env);
  const entries = new Map<string, CatalogEntry>();
  for (let page = 1; page <= pages; page++) {
    const list = extractOrderList(await client.listOrders(page, 100));
    for (const entry of list) {
      let order = normalizeOrder(entry);
      if (order.items.length === 0) order = normalizeOrder(await client.getOrder(order.orderId));
      for (const item of order.items) {
        entries.set(item.tossItemId ?? item.name, { tossItemId: item.tossItemId, name: item.name, category: null, kind: 'menu' });
        for (const opt of item.options) {
          entries.set(`opt:${opt.name}`, { tossItemId: null, name: opt.name, category: '옵션', kind: 'option' });
        }
      }
    }
    if (list.length < 100) break;
  }
  return upsertMenus(env, [...entries.values()], 'orders');
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export async function upsertMenus(env: Env, entries: CatalogEntry[], source: ImportResult['source']): Promise<ImportResult> {
  const db = env.DB;
  const existing = await repo.listMenuItems(db);
  const byToss = new Map(existing.filter((m) => m.toss_item_id).map((m) => [m.toss_item_id!, m]));
  const byName = new Map(existing.map((m) => [norm(m.name), m]));
  const added: string[] = [];
  let updated = 0;

  for (const e of entries) {
    const match: MenuItem | undefined = (e.tossItemId && byToss.get(e.tossItemId)) || byName.get(norm(e.name));
    if (match) {
      // 토스 ID 연결, 카테고리 보충 (이름은 토스 기준으로 갱신하되 다른 메뉴와 겹치면 유지)
      const nameFree = !byName.has(norm(e.name)) || byName.get(norm(e.name)) === match;
      const name = nameFree ? e.name : match.name;
      const toss = e.tossItemId ?? match.toss_item_id;
      if (name !== match.name || toss !== match.toss_item_id || (e.category && e.category !== match.category)) {
        await db
          .prepare('UPDATE menu_items SET name = ?, toss_item_id = ?, category = COALESCE(?, category), kind = ? WHERE id = ?')
          .bind(name, toss, e.category, e.kind, match.id)
          .run();
        updated++;
      }
      continue;
    }
    // 같은 이름이 이미 있으면(다른 카테고리의 동명 메뉴) 카테고리를 붙여 구분
    let name = e.name;
    if (byName.has(norm(name))) name = `${e.name} (${e.category ?? e.tossItemId ?? '중복'})`;
    if (byName.has(norm(name))) continue;
    const row = await db
      .prepare('INSERT INTO menu_items (name, toss_item_id, kind, category) VALUES (?, ?, ?, ?) RETURNING *')
      .bind(name, e.tossItemId, e.kind, e.category)
      .first<MenuItem>();
    if (row) {
      byName.set(norm(name), row);
      if (row.toss_item_id) byToss.set(row.toss_item_id, row);
      added.push(name);
    }
  }
  return { source, added, updated, total: entries.length };
}
