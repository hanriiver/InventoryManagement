import type { Env, MenuItem } from '../types';
import * as repo from '../db/repo';
import { HOUSE_INGREDIENTS, HOUSE_RECIPES, HOUSE_RECIPE_TODO } from '../seed/house-recipes';

export interface SeedResult {
  ingredientsAdded: string[];
  ingredientsKept: string[];
  recipesSet: { menu: string; matched: string }[];
  recipesSkipped: string[];
  menusCreated: string[];
  todo: string[];
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 가게 레시피를 재료·레시피로 등록.
 * - 이미 있는 재료는 건드리지 않음 (용량·재고 유지). 새 재료는 재고 0으로 생성
 * - 토스에서 불러온 메뉴와 이름(공백 무시)으로 연결. 없으면 메뉴를 새로 만듦
 * - 이미 레시피가 있는 메뉴는 overwrite=true일 때만 덮어씀
 */
export async function seedHouseRecipes(env: Env, overwrite = false): Promise<SeedResult> {
  const db = env.DB;
  const result: SeedResult = { ingredientsAdded: [], ingredientsKept: [], recipesSet: [], recipesSkipped: [], menusCreated: [], todo: HOUSE_RECIPE_TODO };

  const existing = new Map((await repo.listIngredients(db)).map((i) => [norm(i.name), i]));
  for (const s of HOUSE_INGREDIENTS) {
    if (existing.has(norm(s.name))) {
      result.ingredientsKept.push(s.name);
      continue;
    }
    await db
      .prepare(
        `INSERT INTO ingredients (name, category, unit, container_size, container_label, yield_ml, reorder_point, order_alias, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(s.name, s.category, s.unit, s.container_size, s.container_label, s.yield_ml ?? null, s.reorder_point, s.order_alias, s.supplier ?? 'manual')
      .run();
    result.ingredientsAdded.push(s.name);
  }
  const ingByName = new Map((await repo.listIngredients(db)).map((i) => [norm(i.name), i]));

  const menus = await repo.listMenuItems(db);
  const recipes = await repo.listRecipes(db);
  for (const r of HOUSE_RECIPES) {
    let menu: MenuItem | undefined = menus.find((m) => norm(m.name) === norm(r.menu));
    if (!menu) {
      menu = (await db.prepare('INSERT INTO menu_items (name) VALUES (?) RETURNING *').bind(r.menu).first<MenuItem>())!;
      menus.push(menu);
      result.menusCreated.push(r.menu);
    }
    if (!overwrite && recipes.some((l) => l.menu_item_id === menu!.id)) {
      result.recipesSkipped.push(menu.name);
      continue;
    }
    const stmts = [db.prepare('DELETE FROM recipe_lines WHERE menu_item_id = ?').bind(menu.id)];
    for (const l of r.lines) {
      const ing = ingByName.get(norm(l.ingredient));
      if (!ing) throw new Error(`재료 '${l.ingredient}'를 찾을 수 없습니다`);
      stmts.push(
        db.prepare('INSERT INTO recipe_lines (menu_item_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)').bind(menu.id, ing.id, l.amount, l.unit),
      );
    }
    await db.batch(stmts);
    result.recipesSet.push({ menu: r.menu, matched: menu.name });
  }
  return result;
}
