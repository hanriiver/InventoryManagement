import type { Env, Ingredient, MenuItem, RecipeLine } from '../types';
import * as repo from '../db/repo';
import { HOUSE_INGREDIENTS, HOUSE_RECIPES, HOUSE_RECIPE_TODO, type SeedIngredient, type SeedRecipe } from '../seed/house-recipes';
import { CLASSIC_INGREDIENTS, CLASSIC_RECIPES } from '../seed/classics';
import { detectWhisky } from '../seed/whisky';
import { nameKeys, normalizeMenuName } from '../seed/matching';

export interface SeedResult {
  ingredientsAdded: string[];
  ingredientsKept: string[];
  recipesSet: { menu: string; matched: string }[];
  recipesSkipped: string[];
  menusCreated: string[];
  /** 위스키 자동 인식: 토스 메뉴 → 재료, 양 */
  whisky: { menu: string; ingredient: string; amount: string; note?: string }[];
  /** 표준 레시피를 넣은 메뉴 (확인 필요) */
  classics: { menu: string; summary: string }[];
  /** 아직 레시피가 없는 메뉴 */
  remaining: string[];
  todo: string[];
}

const norm = normalizeMenuName;

/**
 * 가게 레시피 → 표준 칵테일/논알콜 → 위스키 자동 인식 순서로 레시피를 채웁니다.
 * - 이미 있는 재료는 건드리지 않음. 새 재료는 재고 0
 * - 이미 레시피가 있는 메뉴는 그대로 둠 (가게 레시피만 overwrite=true면 덮어씀)
 */
export async function seedHouseRecipes(env: Env, overwrite = false): Promise<SeedResult> {
  const db = env.DB;
  const result: SeedResult = {
    ingredientsAdded: [], ingredientsKept: [], recipesSet: [], recipesSkipped: [], menusCreated: [],
    whisky: [], classics: [], remaining: [], todo: HOUSE_RECIPE_TODO,
  };

  const ingredients = await repo.listIngredients(db);
  const ingByName = new Map(ingredients.map((i) => [norm(i.name), i]));
  const ensureIngredient = async (s: SeedIngredient, report = true): Promise<Ingredient> => {
    const found = ingByName.get(norm(s.name));
    if (found) {
      if (report) result.ingredientsKept.push(s.name);
      return found;
    }
    const row = (await db
      .prepare(
        `INSERT INTO ingredients (name, category, unit, container_size, container_label, yield_ml, reorder_point, order_alias, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(s.name, s.category, s.unit, s.container_size, s.container_label, s.yield_ml ?? null, s.reorder_point, s.order_alias, s.supplier ?? 'manual')
      .first<Ingredient>())!;
    ingByName.set(norm(s.name), row);
    result.ingredientsAdded.push(s.name);
    return row;
  };

  for (const s of HOUSE_INGREDIENTS) await ensureIngredient(s);

  const menus = await repo.listMenuItems(db);
  const recipes = await repo.listRecipes(db);
  const hasRecipe = new Set(recipes.map((r: RecipeLine) => r.menu_item_id));
  const findMenu = (name: string, aliases: string[] = []) => {
    const keys = new Set([...nameKeys(name), ...aliases.map(norm)]);
    return menus.find((m) => keys.has(norm(m.name)));
  };
  const writeRecipe = async (menu: MenuItem, lines: SeedRecipe['lines']) => {
    const stmts = [db.prepare('DELETE FROM recipe_lines WHERE menu_item_id = ?').bind(menu.id)];
    for (const l of lines) {
      const ing = ingByName.get(norm(l.ingredient));
      if (!ing) throw new Error(`재료 '${l.ingredient}'를 찾을 수 없습니다`);
      stmts.push(db.prepare('INSERT INTO recipe_lines (menu_item_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)').bind(menu.id, ing.id, l.amount, l.unit));
    }
    await db.batch(stmts);
    hasRecipe.add(menu.id);
  };

  // 1) 가게 레시피 (토스에 없으면 메뉴를 만듦)
  for (const r of HOUSE_RECIPES) {
    let menu = findMenu(r.menu);
    if (!menu) {
      menu = (await db.prepare('INSERT INTO menu_items (name) VALUES (?) RETURNING *').bind(r.menu).first<MenuItem>())!;
      menus.push(menu);
      result.menusCreated.push(r.menu);
    }
    if (!overwrite && hasRecipe.has(menu.id)) {
      result.recipesSkipped.push(menu.name);
      continue;
    }
    await writeRecipe(menu, r.lines);
    result.recipesSet.push({ menu: r.menu, matched: menu.name });
  }

  // 2) 표준 칵테일·논알콜 (토스에 그 메뉴가 있고 레시피가 없을 때만)
  const classicIng = new Map(CLASSIC_INGREDIENTS.map((i) => [norm(i.name), i]));
  for (const r of CLASSIC_RECIPES) {
    const menu = findMenu(r.menu, r.aliases);
    if (!menu || hasRecipe.has(menu.id) || !menu.active) continue;
    for (const l of r.lines) {
      if (!ingByName.has(norm(l.ingredient))) {
        const def = classicIng.get(norm(l.ingredient));
        if (!def) throw new Error(`표준 레시피 재료 정의 없음: ${l.ingredient}`);
        await ensureIngredient(def, false);
      }
    }
    await writeRecipe(menu, r.lines);
    result.classics.push({ menu: menu.name, summary: r.lines.map((l) => `${l.ingredient} ${l.amount}${l.unit === 'ea' ? '개' : 'ml'}`).join(', ') });
  }

  // 3) 위스키: 메뉴 이름/카테고리로 인식 → 제품명 재료(700ml) + 30ml
  for (const menu of menus) {
    if (hasRecipe.has(menu.id) || !menu.active || menu.kind === 'option') continue;
    const w = detectWhisky(menu.name, menu.category);
    if (!w) continue;
    const ing = findSimilarLiquor([...ingByName.values()], w.product) ?? await ensureIngredient(
      { name: w.product, category: 'liquor', unit: 'ml', container_size: 700, container_label: '병', reorder_point: 1, order_alias: w.product.replace(/\s+/g, '') },
      false,
    );
    const amount = w.unit === 'bottle' ? w.amount * ing.container_size : w.amount;
    await writeRecipe(menu, [{ ingredient: ing.name, amount, unit: 'ml' }]);
    result.whisky.push({ menu: menu.name, ingredient: ing.name, amount: w.unit === 'bottle' ? `${w.amount}병` : `${amount}ml`, note: w.note });
  }

  result.remaining = menus.filter((m) => m.active && m.kind !== 'option' && !hasRecipe.has(m.id)).map((m) => m.name);
  return result;
}

/**
 * 이미 있는 술과 이름이 비슷하면 그걸 사용 ("짐빔" → "짐빔 화이트", "제임슨 스탠다드" → "제임슨").
 * 후보가 여러 개면 화이트/오리지널/스탠다드를 우선, 그래도 애매하면 null (새 재료 생성).
 */
export function findSimilarLiquor(ingredients: Ingredient[], product: string): Ingredient | null {
  const p = normalizeMenuName(product);
  const liquors = ingredients.filter((i) => i.unit === 'ml');
  const exact = liquors.find((i) => normalizeMenuName(i.name) === p);
  if (exact) return exact;
  const cands = liquors.filter((i) => {
    const n = normalizeMenuName(i.name);
    return n.length >= 2 && p.length >= 2 && (n.startsWith(p) || p.startsWith(n));
  });
  if (cands.length === 1) return cands[0]!;
  return cands.find((i) => /화이트|오리지널|스탠다드/.test(i.name)) ?? null;
}
