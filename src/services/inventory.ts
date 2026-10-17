import type { Env, Ingredient, MenuItem, MovementReason, PurchaseOrderLine, RecipeLine } from '../types';
import * as repo from '../db/repo';
import { computeConsumption, diffMovements } from '../domain/reconcile';
import { alertTransition, needsReorder, toOrderLine } from '../domain/reorder';
import type { NormalizedOrder } from '../toss/normalize';
import { notify } from '../notify';
import { purchaseOrderKeyboard, purchaseOrderText } from '../telegram/messages';
import { suppliers } from '../suppliers';

export interface ProcessResult {
  orderId: string;
  status: string;
  changed: number;
  unmapped: string[];
}

/** 주문 → 재료 계산에 필요한 메뉴·레시피·재료. 동기화 한 번에 한 번만 읽어서 재사용 */
export interface OrderCatalog {
  menuItems: MenuItem[];
  recipes: RecipeLine[];
  ingredients: Map<number, Ingredient>;
}

export async function loadOrderCatalog(db: D1Database): Promise<OrderCatalog> {
  const [ingredients, menuItems, recipes] = await Promise.all([repo.listIngredients(db), repo.listMenuItems(db), repo.listRecipes(db)]);
  return { menuItems, recipes, ingredients: new Map(ingredients.map((i) => [i.id, i])) };
}

/**
 * 주문을 재고에 반영. 완료 주문은 레시피만큼 차감, 취소 주문은 차감분 원복.
 * 몇 번을 호출해도 결과는 같습니다 (멱등).
 */
export async function processOrder(
  env: Env,
  order: NormalizedOrder,
  raw: unknown,
  catalog?: OrderCatalog,
): Promise<ProcessResult> {
  const db = env.DB;
  await repo.upsertOrder(db, order.orderId, order.state, order.status, JSON.stringify(raw ?? null));
  if (order.status === 'PENDING') return { orderId: order.orderId, status: order.status, changed: 0, unmapped: [] };

  let target = new Map<number, number>();
  let sources = new Map<number, string[]>();
  let unmapped: ReturnType<typeof computeConsumption>['unmapped'] = [];
  if (order.status === 'COMPLETED') {
    const c = catalog ?? (await loadOrderCatalog(db));
    ({ consumption: target, sources, unmapped } = computeConsumption(order, c.menuItems, c.recipes, c.ingredients));
  }

  let changed: { ingredientId: number; delta: number }[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const version = await repo.getOrderVersion(db, order.orderId);
    const applied = await repo.appliedForOrder(db, order.orderId);
    changed = diffMovements(target, applied);
    if (!changed.length) break;
    const movements = changed.map((c) => ({
      ingredientId: c.ingredientId,
      delta: c.delta,
      reason: (c.delta < 0 ? 'SALE' : 'CANCEL') as MovementReason,
      note: c.delta > 0 ? '주문 취소/변경' : sources.get(c.ingredientId)?.join(', ').slice(0, 200) ?? null,
    }));
    if (await repo.applyOrderMovements(db, order.orderId, version, movements)) break;
    changed = [];
  }

  const newUnmapped: string[] = [];
  for (const u of unmapped) {
    if (await repo.recordUnmapped(db, u, order.orderId)) newUnmapped.push(u.name);
  }
  if (newUnmapped.length) {
    await notify(env, {
      text: `[확인 필요] 레시피가 없는 메뉴가 판매됐어요 (재고 차감 안 됨)\n${newUnmapped.map((n) => `· ${n}`).join('\n')}\n\n관리자 웹 > 메뉴/레시피에서 등록해 주세요.`,
    });
  }

  if (changed.length) await checkReorder(env, changed.map((c) => c.ingredientId));
  return { orderId: order.orderId, status: order.status, changed: changed.length, unmapped: unmapped.map((u) => u.name) };
}

/** 재고가 바뀐 재료 중 새로 기준 이하가 된 것만 발주서로 알림. 다시 채워진 재료는 알림 상태 해제 */
export async function checkReorder(env: Env, ingredientIds: number[]): Promise<void> {
  const db = env.DB;
  const triggered: Ingredient[] = [];
  const reset: number[] = [];
  for (const ing of await repo.getIngredientsByIds(db, ingredientIds)) {
    const t = alertTransition(ing);
    if (t === 'trigger') triggered.push(ing);
    else if (t === 'reset') reset.push(ing.id);
  }
  await repo.setAlertActive(db, reset, false);
  if (!triggered.length) return;
  await repo.setAlertActive(db, triggered.map((i) => i.id), true);
  await issuePurchaseOrder(env, triggered.map(toOrderLine));
}

/** 발주서 생성 + 공급처 자동발주 시도 + 텔레그램 전송 */
export async function issuePurchaseOrder(env: Env, lines: PurchaseOrderLine[]): Promise<number | null> {
  if (!lines.length) return null;
  const id = await repo.createPurchaseOrder(env.DB, lines);
  const coupangLines = lines.filter((l) => l.supplier === 'coupang');
  let extra = '';
  if (coupangLines.length) {
    const r = await suppliers.coupang.placeOrder(env, coupangLines);
    if (r.placed) extra = `\n\n쿠팡 자동주문 완료: ${r.message}`;
  }
  await notify(env, { text: purchaseOrderText(id, lines) + extra, buttons: purchaseOrderKeyboard(id) });
  return id;
}

/** 현재 기준 이하인 모든 재료로 발주서 생성 (/발주 명령) */
export async function issueReorderForAllLow(env: Env): Promise<number | null> {
  const low = (await repo.listIngredients(env.DB)).filter(needsReorder);
  if (!low.length) return null;
  await repo.setAlertActive(env.DB, low.map((i) => i.id), true);
  return issuePurchaseOrder(env, low.map(toOrderLine));
}

export async function addMovement(
  env: Env,
  ingredientId: number,
  delta: number,
  reason: MovementReason,
  note?: string,
): Promise<Ingredient> {
  await repo.applyMovements(env.DB, [{ ingredientId, delta, reason, note }]);
  await checkReorder(env, [ingredientId]);
  return (await repo.getIngredient(env.DB, ingredientId))!;
}

/** 실사: 실제 남은 양(base unit)으로 맞춤 */
export async function setActualStock(env: Env, ingredientId: number, actual: number, note?: string): Promise<Ingredient> {
  const ing = await repo.getIngredient(env.DB, ingredientId);
  if (!ing) throw new Error('재료를 찾을 수 없습니다');
  return addMovement(env, ingredientId, actual - ing.stock, 'ADJUST', note ?? '실사 보정');
}

/** 발주서의 품목을 그대로 입고 처리 */
export async function receivePurchaseOrder(env: Env, id: number): Promise<PurchaseOrderLine[] | null> {
  const po = await repo.getPurchaseOrder(env.DB, id);
  if (!po) return null;
  if (!(await repo.setPurchaseOrderStatus(env.DB, id, 'RECEIVED', ['DRAFT', 'SENT']))) return null;
  const lines = JSON.parse(po.lines) as PurchaseOrderLine[];
  const movements = [];
  for (const l of lines) {
    const ing = await repo.getIngredient(env.DB, l.ingredientId);
    if (!ing) continue;
    const amount = l.qty * (ing.unit === 'ml' ? ing.container_size : 1);
    movements.push({ ingredientId: ing.id, delta: amount, reason: 'RESTOCK' as const, ref: `po:${id}`, note: `발주 #${id} 입고` });
  }
  await repo.applyMovements(env.DB, movements);
  await checkReorder(env, movements.map((m) => m.ingredientId));
  return lines;
}

export type BulkMode = 'restock' | 'count' | 'waste';

/**
 * 여러 재료를 한 번에 입고/실사/폐기. 한 트랜잭션으로 기록하고 발주 판단도 한 번만.
 * quantity는 "2", "1병+300ml", "350ml" 같은 입력 문자열 (재료 단위 기준)
 */
export async function applyBulk(
  env: Env,
  mode: BulkMode,
  items: { id: number; quantity: string }[],
  parse: (q: string, ing: Ingredient) => number,
): Promise<{ id: number; name: string; delta: number }[]> {
  const ings = new Map((await repo.getIngredientsByIds(env.DB, items.map((i) => i.id))).map((i) => [i.id, i]));
  const reason: MovementReason = mode === 'restock' ? 'RESTOCK' : mode === 'count' ? 'ADJUST' : 'WASTE';
  const note = mode === 'restock' ? '입고' : mode === 'count' ? '실사 보정' : '폐기';
  const movements = [];
  const out = [];
  for (const item of items) {
    const ing = ings.get(item.id);
    if (!ing) throw new Error(`재료 ${item.id}를 찾을 수 없습니다`);
    const amount = parse(item.quantity, ing);
    if (amount < 0) throw new Error(`${ing.name}: 수량은 0 이상이어야 합니다`);
    const delta = mode === 'restock' ? amount : mode === 'waste' ? -amount : amount - ing.stock;
    if (Math.abs(delta) < 1e-9) continue;
    movements.push({ ingredientId: ing.id, delta, reason, note });
    out.push({ id: ing.id, name: ing.name, delta });
  }
  await repo.applyMovements(env.DB, movements);
  await checkReorder(env, movements.map((m) => m.ingredientId));
  return out;
}
