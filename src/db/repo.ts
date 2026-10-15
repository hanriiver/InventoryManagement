import type { Ingredient, MenuItem, MovementReason, PurchaseOrderLine, RecipeLine } from '../types';

export interface MovementInput {
  ingredientId: number;
  delta: number;
  reason: MovementReason;
  ref?: string | null;
  note?: string | null;
}

export async function listIngredients(db: D1Database): Promise<Ingredient[]> {
  const { results } = await db.prepare('SELECT * FROM ingredients ORDER BY category, name').all<Ingredient>();
  return results;
}

export async function getIngredient(db: D1Database, id: number): Promise<Ingredient | null> {
  return db.prepare('SELECT * FROM ingredients WHERE id = ?').bind(id).first<Ingredient>();
}

/** 이름/발주명으로 재료 찾기. 정확히 일치하면 그것만, 아니면 부분일치 목록 */
export async function searchIngredients(db: D1Database, query: string): Promise<Ingredient[]> {
  const all = await listIngredients(db);
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, '').toLowerCase();
  const q = norm(query);
  const exact = all.filter((i) => norm(i.name) === q || norm(i.order_alias) === q);
  if (exact.length) return exact;
  return all.filter((i) => norm(i.name).includes(q) || norm(i.order_alias).includes(q));
}

export async function listMenuItems(db: D1Database): Promise<MenuItem[]> {
  const { results } = await db.prepare('SELECT * FROM menu_items ORDER BY name').all<MenuItem>();
  return results;
}

export async function listRecipes(db: D1Database): Promise<RecipeLine[]> {
  const { results } = await db.prepare('SELECT * FROM recipe_lines').all<RecipeLine>();
  return results;
}

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? '';
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

function movementStatements(db: D1Database, m: MovementInput): D1PreparedStatement[] {
  return [
    db
      .prepare('INSERT INTO stock_movements (ingredient_id, delta, reason, ref, note) VALUES (?, ?, ?, ?, ?)')
      .bind(m.ingredientId, m.delta, m.reason, m.ref ?? null, m.note ?? null),
    db.prepare('UPDATE ingredients SET stock = stock + ? WHERE id = ?').bind(m.delta, m.ingredientId),
  ];
}

/** 원장 기록 + 현재고 갱신을 한 트랜잭션으로 */
export async function applyMovements(db: D1Database, movements: MovementInput[]): Promise<void> {
  if (!movements.length) return;
  await db.batch(movements.flatMap((m) => movementStatements(db, m)));
}

export async function upsertOrder(
  db: D1Database,
  orderId: string,
  state: string,
  status: string,
  raw: string,
): Promise<{ previousState: string | null }> {
  const prev = await db
    .prepare('SELECT state FROM sales_orders WHERE order_id = ?')
    .bind(orderId)
    .first<{ state: string }>();
  await db
    .prepare(
      `INSERT INTO sales_orders (order_id, state, status, raw) VALUES (?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET state = excluded.state, status = excluded.status,
         raw = excluded.raw, updated_at = datetime('now')`,
    )
    .bind(orderId, state, status, raw.slice(0, 50_000))
    .run();
  return { previousState: prev?.state ?? null };
}

export async function getOrderState(db: D1Database, orderId: string): Promise<string | null> {
  const row = await db.prepare('SELECT state FROM sales_orders WHERE order_id = ?').bind(orderId).first<{ state: string }>();
  return row?.state ?? null;
}

/** 이 주문으로 원장에 이미 반영된 재료별 변화량 (차감은 음수) */
export async function appliedForOrder(db: D1Database, orderId: string): Promise<Map<number, number>> {
  const { results } = await db
    .prepare(
      `SELECT ingredient_id, SUM(delta) AS total FROM stock_movements
       WHERE ref = ? AND reason IN ('SALE', 'CANCEL') GROUP BY ingredient_id`,
    )
    .bind(orderId)
    .all<{ ingredient_id: number; total: number }>();
  return new Map(results.map((r) => [r.ingredient_id, r.total]));
}

/**
 * 주문 차감분을 version 조건부로 반영. 같은 주문을 동시에 처리하던 다른 요청이 먼저 반영했다면
 * 아무것도 쓰지 않고 false를 반환합니다 (호출 측에서 재시도).
 */
export async function applyOrderMovements(
  db: D1Database,
  orderId: string,
  version: number,
  movements: MovementInput[],
): Promise<boolean> {
  const guard = 'EXISTS (SELECT 1 FROM sales_orders WHERE order_id = ? AND version = ?)';
  const stmts: D1PreparedStatement[] = [];
  for (const m of movements) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements (ingredient_id, delta, reason, ref, note)
           SELECT ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(m.ingredientId, m.delta, m.reason, orderId, m.note ?? null, orderId, version),
      db
        .prepare(`UPDATE ingredients SET stock = stock + ? WHERE id = ? AND ${guard}`)
        .bind(m.delta, m.ingredientId, orderId, version),
    );
  }
  stmts.push(
    db.prepare('UPDATE sales_orders SET version = version + 1 WHERE order_id = ? AND version = ?').bind(orderId, version),
  );
  const results = await db.batch(stmts);
  return (results[results.length - 1]?.meta.changes ?? 0) > 0;
}

export async function getOrderVersion(db: D1Database, orderId: string): Promise<number> {
  const row = await db.prepare('SELECT version FROM sales_orders WHERE order_id = ?').bind(orderId).first<{ version: number }>();
  return row?.version ?? 0;
}

export async function setAlertActive(db: D1Database, ids: number[], active: boolean): Promise<void> {
  if (!ids.length) return;
  await db.batch(ids.map((id) => db.prepare('UPDATE ingredients SET alert_active = ? WHERE id = ?').bind(active ? 1 : 0, id)));
}

/** 처음 보는 미매핑 메뉴면 true (알림 대상) */
export async function recordUnmapped(
  db: D1Database,
  item: { key: string; name: string; tossItemId: string | null; quantity: number },
  orderId: string,
): Promise<boolean> {
  const existing = await db.prepare('SELECT key FROM unmapped_items WHERE key = ?').bind(item.key).first();
  await db
    .prepare(
      `INSERT INTO unmapped_items (key, name, toss_item_id, count, last_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + excluded.count, last_order = excluded.last_order,
         last_seen = datetime('now')`,
    )
    .bind(item.key, item.name, item.tossItemId, item.quantity, orderId)
    .run();
  return !existing;
}

export interface PurchaseOrderRow {
  id: number;
  status: string;
  lines: string;
  created_at: string;
}

export async function createPurchaseOrder(db: D1Database, lines: PurchaseOrderLine[]): Promise<number> {
  const row = await db
    .prepare('INSERT INTO purchase_orders (lines) VALUES (?) RETURNING id')
    .bind(JSON.stringify(lines))
    .first<{ id: number }>();
  return row!.id;
}

export async function getPurchaseOrder(db: D1Database, id: number): Promise<PurchaseOrderRow | null> {
  return db.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).first<PurchaseOrderRow>();
}

export async function setPurchaseOrderStatus(db: D1Database, id: number, status: string, fromStatuses: string[]): Promise<boolean> {
  const placeholders = fromStatuses.map(() => '?').join(',');
  const res = await db
    .prepare(`UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND status IN (${placeholders})`)
    .bind(status, id, ...fromStatuses)
    .run();
  return res.meta.changes > 0;
}
