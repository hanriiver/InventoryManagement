import type { Ingredient, PurchaseOrderLine } from '../types';
import { toContainers } from './units';

export function needsReorder(ing: Pick<Ingredient, 'stock' | 'container_size' | 'reorder_point'>): boolean {
  return toContainers(ing.stock, ing) <= ing.reorder_point;
}

/** 발주 수량: 적정재고(par)까지 채우는 수량, par가 없으면 1 */
export function orderQuantity(ing: Pick<Ingredient, 'stock' | 'container_size' | 'par_level'>): number {
  if (ing.par_level == null) return 1;
  return Math.max(1, Math.ceil(ing.par_level - toContainers(ing.stock, ing) - 1e-9));
}

export function toOrderLine(ing: Ingredient): PurchaseOrderLine {
  return {
    ingredientId: ing.id,
    name: ing.order_alias || ing.name,
    qty: orderQuantity(ing),
    label: ing.container_label,
    supplier: ing.supplier,
  };
}

export type AlertTransition = 'trigger' | 'reset' | 'none';

/** 기준선을 내려갈 때 한 번만 알림, 다시 올라가면 해제 */
export function alertTransition(ing: Pick<Ingredient, 'stock' | 'container_size' | 'reorder_point' | 'alert_active'>): AlertTransition {
  const low = needsReorder(ing);
  if (low && !ing.alert_active) return 'trigger';
  if (!low && ing.alert_active) return 'reset';
  return 'none';
}
