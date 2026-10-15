import type { Ingredient, MenuItem, RecipeLine } from '../types';
import type { NormalizedOrder } from '../toss/normalize';
import { toBaseUnit } from './units';

export interface ConsumptionResult {
  /** ingredient_id → 소모량(base unit, 양수) */
  consumption: Map<number, number>;
  /** ingredient_id → 이 재료를 쓴 메뉴 ("진토닉×2") — 원장 메모용 */
  sources: Map<number, string[]>;
  unmapped: { key: string; name: string; tossItemId: string | null; quantity: number }[];
}

export function findMenuItem(
  menuItems: MenuItem[],
  tossItemId: string | null,
  name: string,
): MenuItem | undefined {
  if (tossItemId) {
    const byId = menuItems.find((m) => m.toss_item_id === tossItemId);
    if (byId) return byId;
  }
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return menuItems.find((m) => norm(m.name) === norm(name));
}

/** 주문 → 재료별 소모량. 옵션(예: 샷 추가)도 같은 이름의 메뉴가 있으면 그 레시피만큼 차감 */
export function computeConsumption(
  order: NormalizedOrder,
  menuItems: MenuItem[],
  recipes: RecipeLine[],
  ingredients: Map<number, Ingredient>,
): ConsumptionResult {
  const consumption = new Map<number, number>();
  const sources = new Map<number, string[]>();
  const unmapped: ConsumptionResult['unmapped'] = [];

  const apply = (tossItemId: string | null, name: string, quantity: number, reportUnmapped: boolean) => {
    if (quantity <= 0) return;
    const menu = findMenuItem(menuItems, tossItemId, name);
    if (menu && !menu.active) return; // 재고 차감 안 함으로 지정된 메뉴
    const lines = menu ? recipes.filter((r) => r.menu_item_id === menu.id) : [];
    if (!menu || lines.length === 0) {
      if (reportUnmapped) unmapped.push({ key: tossItemId ?? name, name, tossItemId, quantity });
      return;
    }
    for (const line of lines) {
      const ing = ingredients.get(line.ingredient_id);
      if (!ing) continue;
      const amount = toBaseUnit(line.amount, line.unit, ing) * quantity;
      consumption.set(ing.id, (consumption.get(ing.id) ?? 0) + amount);
      const label = quantity > 1 ? `${name}×${quantity}` : name;
      sources.set(ing.id, [...(sources.get(ing.id) ?? []), label]);
    }
  };

  for (const item of order.items) {
    apply(item.tossItemId, item.name, item.quantity, true);
    for (const opt of item.options) {
      // 옵션은 매핑된 경우에만 차감 (얼음 적게 같은 옵션까지 미매핑 알림이 가지 않도록)
      apply(opt.tossItemId, opt.name, opt.quantity * item.quantity, false);
    }
  }
  return { consumption, sources, unmapped };
}

/**
 * 이 주문에 대해 원장에 이미 반영된 양(applied, 음수=차감)과 목표 차감량을 비교해 필요한 차이만 반환.
 * 같은 주문이 여러 번 들어오거나, 취소/부분취소되어도 결과가 항상 맞게 됩니다.
 */
export function diffMovements(
  target: Map<number, number>,
  applied: Map<number, number>,
): { ingredientId: number; delta: number }[] {
  const ids = new Set([...target.keys(), ...applied.keys()]);
  const out: { ingredientId: number; delta: number }[] = [];
  for (const id of ids) {
    const want = -(target.get(id) ?? 0);
    const have = applied.get(id) ?? 0;
    const delta = want - have;
    if (Math.abs(delta) > 1e-6) out.push({ ingredientId: id, delta });
  }
  return out;
}
