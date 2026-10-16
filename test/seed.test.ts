import { describe, expect, it } from 'vitest';
import { HOUSE_INGREDIENTS, HOUSE_RECIPES } from '../src/seed/house-recipes';
import { toBaseUnit } from '../src/domain/units';
import type { Ingredient } from '../src/types';

describe('가게 레시피 데이터', () => {
  const byName = new Map(HOUSE_INGREDIENTS.map((i) => [i.name, i]));
  it('레시피의 모든 재료가 재료 목록에 있고 단위 환산이 가능', () => {
    for (const r of HOUSE_RECIPES) {
      for (const l of r.lines) {
        const s = byName.get(l.ingredient);
        expect(s, `${r.menu}: ${l.ingredient}`).toBeDefined();
        const ing = { ...s!, id: 1, yield_ml: s!.yield_ml ?? null } as unknown as Ingredient;
        expect(() => toBaseUnit(l.amount, l.unit, ing)).not.toThrow();
      }
    }
  });
  it('재료·메뉴 이름 중복 없음', () => {
    expect(new Set(HOUSE_INGREDIENTS.map((i) => i.name)).size).toBe(HOUSE_INGREDIENTS.length);
    expect(new Set(HOUSE_RECIPES.map((r) => r.menu)).size).toBe(HOUSE_RECIPES.length);
  });
  it('다이키리 라임 22.5ml = 라임 1.125개', () => {
    const lime = { ...byName.get('라임')!, id: 1 } as unknown as Ingredient;
    expect(toBaseUnit(22.5, 'ml', lime)).toBe(1.125);
  });
});
