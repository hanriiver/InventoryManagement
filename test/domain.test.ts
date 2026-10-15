import { describe, expect, it } from 'vitest';
import { formatStock, parseQuantity, toBaseUnit } from '../src/domain/units';
import { alertTransition, orderQuantity } from '../src/domain/reorder';
import { computeConsumption, diffMovements } from '../src/domain/reconcile';
import { businessDay, businessDayStartUtc, isReportDue } from '../src/domain/time';
import type { Ingredient, MenuItem, RecipeLine } from '../src/types';

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 1, name: '핸드릭스 진', category: 'liquor', unit: 'ml', container_size: 700, container_label: '병',
  yield_ml: null, reorder_point: 1, par_level: null, order_alias: '핸드릭스진', supplier: 'manual',
  stock: 0, alert_active: 0, ...over,
});
const lemon = ing({ id: 2, name: '레몬', category: 'fruit', unit: 'ea', container_size: 1, container_label: '개', yield_ml: 40, supplier: 'coupang' });

describe('units', () => {
  it('레몬즙 ml를 개수로 환산', () => {
    expect(toBaseUnit(30, 'ml', lemon)).toBe(0.75);
    expect(toBaseUnit(2, 'ea', lemon)).toBe(2);
    expect(() => toBaseUnit(30, 'g', lemon)).toThrow();
  });
  it('병 + ml 표기', () => {
    expect(formatStock(1750, ing({}))).toBe('2병 + 350ml');
    expect(formatStock(1400, ing({}))).toBe('2병');
    expect(formatStock(300, ing({}))).toBe('300ml');
    expect(formatStock(11.25, lemon)).toBe('11.25개');
  });
  it('수량 입력 해석', () => {
    expect(parseQuantity('2', ing({}))).toBe(1400);
    expect(parseQuantity('1.5병', ing({}))).toBe(1050);
    expect(parseQuantity('350ml', ing({}))).toBe(350);
    expect(parseQuantity('12', lemon)).toBe(12);
    expect(() => parseQuantity('abc', lemon)).toThrow();
  });
});

describe('reorder', () => {
  it('기준선을 내려갈 때 한 번만 알림', () => {
    expect(alertTransition(ing({ stock: 1400 }))).toBe('none');
    expect(alertTransition(ing({ stock: 700 }))).toBe('trigger');
    expect(alertTransition(ing({ stock: 600, alert_active: 1 }))).toBe('none');
    expect(alertTransition(ing({ stock: 2100, alert_active: 1 }))).toBe('reset');
  });
  it('발주 수량은 적정재고까지', () => {
    expect(orderQuantity(ing({ stock: 350 }))).toBe(1);
    expect(orderQuantity(ing({ stock: 350, par_level: 3 }))).toBe(3); // 0.5병 → 3병까지 2.5 → 3
    expect(orderQuantity(ing({ stock: 700, par_level: 3 }))).toBe(2);
  });
});

describe('reconcile', () => {
  const menus: MenuItem[] = [
    { id: 10, name: '진토닉', toss_item_id: 'T-GT', active: 1 },
    { id: 11, name: '샷 추가', toss_item_id: null, active: 1 },
  ];
  const recipes: RecipeLine[] = [
    { id: 1, menu_item_id: 10, ingredient_id: 1, amount: 45, unit: 'ml' },
    { id: 2, menu_item_id: 10, ingredient_id: 2, amount: 10, unit: 'ml' },
    { id: 3, menu_item_id: 11, ingredient_id: 1, amount: 30, unit: 'ml' },
  ];
  const ings = new Map([[1, ing({})], [2, lemon]]);

  it('메뉴·옵션·미매핑 처리', () => {
    const r = computeConsumption(
      {
        orderId: 'o1', state: 'COMPLETED', status: 'COMPLETED',
        items: [
          { tossItemId: 'T-GT', name: '진 토닉(이름 달라도 ID 우선)', quantity: 2, options: [
            { tossItemId: null, name: '샷 추가', quantity: 1 },
            { tossItemId: null, name: '얼음 적게', quantity: 1 },
          ] },
          { tossItemId: null, name: '감자튀김', quantity: 1, options: [] },
        ],
      },
      menus, recipes, ings,
    );
    expect(r.consumption.get(1)).toBe(45 * 2 + 30 * 2);
    expect(r.consumption.get(2)).toBe(0.5);
    expect(r.unmapped.map((u) => u.name)).toEqual(['감자튀김']);
  });

  it('반복 처리·취소에도 차이만 반영', () => {
    const target = new Map([[1, 90]]);
    expect(diffMovements(target, new Map())).toEqual([{ ingredientId: 1, delta: -90 }]);
    expect(diffMovements(target, new Map([[1, -90]]))).toEqual([]);
    expect(diffMovements(new Map(), new Map([[1, -90]]))).toEqual([{ ingredientId: 1, delta: 90 }]);
    expect(diffMovements(new Map([[1, 45]]), new Map([[1, -90]]))).toEqual([{ ingredientId: 1, delta: 45 }]);
  });
});

describe('time (KST)', () => {
  it('새벽 영업은 전날 영업일', () => {
    expect(businessDay(new Date('2026-10-15T17:30:00Z'), '06:00')).toBe('2026-10-15'); // KST 10/16 02:30
    expect(businessDay(new Date('2026-10-15T22:00:00Z'), '06:00')).toBe('2026-10-16'); // KST 10/16 07:00
    expect(businessDayStartUtc(new Date('2026-10-15T17:30:00Z'), '06:00')).toBe('2026-10-14 21:00:00');
  });
  it('마감 리포트 시각 판단', () => {
    const at = (iso: string) => new Date(iso);
    expect(isReportDue(at('2026-10-15T16:59:00Z'), '02:00', '06:00', '')).toBe(false); // KST 01:59
    expect(isReportDue(at('2026-10-15T17:00:00Z'), '02:00', '06:00', '')).toBe(true); // KST 02:00
    expect(isReportDue(at('2026-10-15T17:00:00Z'), '02:00', '06:00', '2026-10-15')).toBe(false);
    expect(isReportDue(at('2026-10-15T14:00:00Z'), '23:00', '06:00', '')).toBe(true); // KST 23:00
    expect(isReportDue(at('2026-10-15T10:00:00Z'), '23:00', '06:00', '')).toBe(false); // KST 19:00
  });
});
