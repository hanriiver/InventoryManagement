import type { Env, Ingredient, MenuItem, RecipeLine } from '../types';
import * as repo from '../db/repo';
import { HOUSE_INGREDIENTS, HOUSE_RECIPES, HOUSE_RECIPE_TODO, beerRecipe, type SeedIngredient, type SeedRecipe } from '../seed/house-recipes';
import { CLASSIC_INGREDIENTS, CLASSIC_RECIPES } from '../seed/classics';
import { detectWhisky } from '../seed/whisky';
import { closestName, findByName, normalizeMenuName } from '../seed/matching';

export interface SeedResult {
  ingredientsAdded: string[];
  ingredientsKept: string[];
  /** 가게 레시피 → 연결된 토스 메뉴 (similar: 이름이 조금 달라서 비슷한 이름으로 연결) */
  recipesSet: { menu: string; matched: string; similar: boolean }[];
  recipesSkipped: string[];
  /** 토스 메뉴에서 못 찾은 가게 레시피 */
  notFound: { recipe: string; closest: string | null }[];
  /** 토스 상품 ID가 없어서 삭제한 메뉴 (레시피는 토스 메뉴로 옮김) */
  removed: { menu: string; movedTo: string | null; movedToId?: number | null }[];
  beer: { menu: string; summary: string }[];
  whisky: { menu: string; ingredient: string; amount: string; note?: string }[];
  classics: { menu: string; summary: string }[];
  /** 아직 레시피가 없는 토스 메뉴 */
  remaining: string[];
  todo: string[];
}

const norm = normalizeMenuName;
const summarize = (lines: SeedRecipe['lines']) => lines.map((l) => `${l.ingredient} ${l.amount}${l.unit === 'ea' ? '개' : 'ml'}`).join(', ');

/**
 * 토스에서 불러온 메뉴(토스 상품 ID 있음)에만 레시피를 넣습니다. 메뉴를 새로 만들지 않습니다.
 * 순서: 토스 ID 없는 메뉴 정리 → 가게 레시피 → 맥주 → 표준 칵테일·논알콜 → 위스키 자동 인식
 * - 이름은 띄어쓰기·표기 차이를 무시하고, 한두 글자 다르면 비슷한 이름으로 연결
 * - 이미 있는 재료·레시피는 그대로 둠 (가게 레시피만 overwrite=true면 덮어씀)
 */
export async function seedHouseRecipes(env: Env, overwrite = false): Promise<SeedResult> {
  const db = env.DB;
  const result: SeedResult = {
    ingredientsAdded: [], ingredientsKept: [], recipesSet: [], recipesSkipped: [], notFound: [], removed: [],
    beer: [], whisky: [], classics: [], remaining: [], todo: HOUSE_RECIPE_TODO,
  };

  // 재료
  const ingByName = new Map((await repo.listIngredients(db)).map((i) => [norm(i.name), i]));
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

  // 토스 ID 없는 메뉴 정리 (레시피는 비슷한 토스 메뉴로 옮김)
  result.removed = await removeMenusWithoutTossId(db);

  const menus = (await repo.listMenuItems(db)).filter((m) => m.toss_item_id);
  const hasRecipe = new Set((await repo.listRecipes(db)).map((r: RecipeLine) => r.menu_item_id));
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

  // 1) 가게 레시피: 같은 이름 먼저 전부 연결한 뒤, 남은 것만 비슷한 이름으로 (다른 레시피가 쓴 메뉴는 제외)
  const claimed = new Set<number>();
  const pending: typeof HOUSE_RECIPES = [];
  // 삭제한 중복 메뉴에서 옮겨 온 레시피는 예전 버전일 수 있어 가게 레시피로 덮어씀
  const movedIds = new Set(result.removed.map((r) => r.movedToId).filter((x): x is number => x != null));
  const assign = async (r: (typeof HOUSE_RECIPES)[number], menu: MenuItem, similar: boolean) => {
    claimed.add(menu.id);
    if (!overwrite && hasRecipe.has(menu.id) && !movedIds.has(menu.id)) {
      result.recipesSkipped.push(menu.name);
      return;
    }
    await writeRecipe(menu, r.lines);
    result.recipesSet.push({ menu: r.menu, matched: menu.name, similar });
  };
  for (const r of HOUSE_RECIPES) {
    const m = findByName(menus, r.menu, r.aliases);
    if (m && m.score === 1 && !claimed.has(m.item.id)) await assign(r, m.item, false);
    else pending.push(r);
  }
  for (const r of pending) {
    const m = findByName(menus.filter((x) => !claimed.has(x.id)), r.menu, r.aliases);
    if (m) await assign(r, m.item, m.score < 1);
    else result.notFound.push({ recipe: r.menu, closest: closestName(menus, r.menu) });
  }

  // 2) 맥주: 이름에 IPA/라거/기네스, 보일러메이커
  for (const menu of menus) {
    if (hasRecipe.has(menu.id) || !menu.active) continue;
    const lines = beerRecipe(menu.name);
    if (!lines) continue;
    await writeRecipe(menu, lines);
    result.beer.push({ menu: menu.name, summary: summarize(lines) });
  }

  // 3) 표준 칵테일·논알콜 (토스에 그 메뉴가 있고 레시피가 없을 때만)
  const classicIng = new Map(CLASSIC_INGREDIENTS.map((i) => [norm(i.name), i]));
  for (const r of CLASSIC_RECIPES) {
    // 표준 레시피는 짧은 이름이 많아(진 하이볼 ↔ 짐빔 하이볼) 같은 이름일 때만 연결
    const m = findByName(menus.filter((x) => !hasRecipe.has(x.id) && x.active), r.menu, r.aliases);
    if (!m || m.score < 1) continue;
    for (const l of r.lines) {
      if (!ingByName.has(norm(l.ingredient))) {
        const def = classicIng.get(norm(l.ingredient));
        if (!def) throw new Error(`표준 레시피 재료 정의 없음: ${l.ingredient}`);
        await ensureIngredient(def, false);
      }
    }
    await writeRecipe(m.item, r.lines);
    result.classics.push({ menu: m.item.name, summary: summarize(r.lines) });
  }

  // 4) 위스키: 메뉴 이름/카테고리로 인식 → 제품명 재료(700ml) + 30ml
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

/**
 * 토스 상품 ID가 없는 메뉴(예전 버전이 만든 메뉴, 직접 추가한 메뉴)를 삭제.
 * 레시피가 있으면 이름이 같거나 비슷한 토스 메뉴(레시피 없는 것)로 옮긴 뒤 삭제합니다.
 * 토스 메뉴가 하나도 없으면(아직 불러오기 전) 아무것도 지우지 않습니다.
 */
export async function removeMenusWithoutTossId(db: D1Database): Promise<{ menu: string; movedTo: string | null; movedToId: number | null }[]> {
  const menus = await repo.listMenuItems(db);
  const tossMenus = menus.filter((m) => m.toss_item_id);
  if (!tossMenus.length) return [];
  const withRecipe = new Set((await repo.listRecipes(db)).map((r) => r.menu_item_id));
  const removed: { menu: string; movedTo: string | null; movedToId: number | null }[] = [];
  for (const dup of menus.filter((m) => !m.toss_item_id)) {
    const stmts: D1PreparedStatement[] = [];
    let movedTo: string | null = null;
    let movedToId: number | null = null;
    if (withRecipe.has(dup.id)) {
      const target = findByName(tossMenus.filter((t) => !withRecipe.has(t.id)), dup.name)?.item;
      if (target) {
        stmts.push(db.prepare('UPDATE recipe_lines SET menu_item_id = ? WHERE menu_item_id = ?').bind(target.id, dup.id));
        withRecipe.add(target.id);
        movedTo = target.name;
        movedToId = target.id;
      }
    }
    stmts.push(db.prepare('DELETE FROM menu_items WHERE id = ?').bind(dup.id));
    await db.batch(stmts);
    removed.push({ menu: dup.name, movedTo, movedToId });
  }
  return removed;
}
