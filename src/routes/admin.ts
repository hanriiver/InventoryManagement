import { Hono } from 'hono';
import type { Env, Ingredient } from '../types';
import * as repo from '../db/repo';
import { containersRounded, formatDelta, formatStock, parseQuantity, toBaseUnit } from '../domain/units';
import { needsReorder } from '../domain/reorder';
import { parseHHMM } from '../domain/time';
import { addMovement, issueReorderForAllLow, processOrder, setActualStock } from '../services/inventory';
import { sendDailyReport } from '../services/report';
import { syncOrderById, syncRecentOrders } from '../services/toss-sync';
import { importMenusFromCatalog, importMenusFromOrders } from '../services/menu-import';
import { TossClient, tossConfigured } from '../toss/client';
import { setCommands, setWebhook, telegramConfigured } from '../telegram/api';

export const admin = new Hono<{ Bindings: Env }>();

// 관리자 인증: Authorization: Bearer <ADMIN_TOKEN>
admin.use('*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: 'ADMIN_TOKEN 비밀값이 설정되지 않았습니다' }, 503);
  if (c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

admin.onError((err, c) => c.json({ error: err.message }, 400));

const view = (i: Ingredient) => {
  const containers = containersRounded(i.stock, i);
  const status = i.stock <= 0 ? 'empty' : needsReorder(i) ? 'low' : 'ok';
  // 게이지 기준: 적정재고, 없으면 발주기준의 3배 (최소 현재고)
  const full = Math.max(i.par_level ?? i.reorder_point * 3, containers, 1);
  return {
    ...i,
    display: i.stock <= 0 ? '재고 없음' : formatStock(i.stock, i),
    shortage: i.stock < 0 ? formatStock(-i.stock, i) : null,
    containers,
    status,
    low: status !== 'ok',
    gauge: { percent: Math.max(0, Math.min(100, (containers / full) * 100)), reorderPercent: Math.min(100, (i.reorder_point / full) * 100) },
  };
};

// ── 상태 ─────────────────────────────────────────────
admin.get('/status', async (c) => {
  return c.json({
    toss: tossConfigured(c.env),
    telegram: telegramConfigured(c.env),
    tossWebhookSecret: Boolean(c.env.TOSS_WEBHOOK_SECRET),
    settings: await repo.getSettings(c.env.DB),
  });
});

// ── 재료 ─────────────────────────────────────────────
const INGREDIENT_FIELDS = [
  'name', 'category', 'unit', 'container_size', 'container_label', 'yield_ml',
  'reorder_point', 'par_level', 'order_alias', 'supplier',
] as const;

function ingredientValues(body: Record<string, unknown>) {
  const v = Object.fromEntries(INGREDIENT_FIELDS.map((k) => [k, body[k] === '' ? null : body[k] ?? null]));
  if (!v.name) throw new Error('이름을 입력하세요');
  if (!['ml', 'ea', 'g'].includes(String(v.unit ?? 'ml'))) throw new Error('단위는 ml, ea, g 중 하나');
  if (!['manual', 'coupang'].includes(String(v.supplier ?? 'manual'))) throw new Error('공급처는 manual, coupang 중 하나');
  return {
    ...v,
    category: v.category ?? 'liquor',
    unit: v.unit ?? 'ml',
    container_size: v.unit === 'ml' ? Number(v.container_size ?? 700) : 1,
    container_label: v.container_label ?? (v.unit === 'ml' ? '병' : '개'),
    reorder_point: Number(v.reorder_point ?? 1),
    supplier: v.supplier ?? 'manual',
  };
}

admin.get('/ingredients', async (c) => c.json((await repo.listIngredients(c.env.DB)).map(view)));

admin.post('/ingredients', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const v = ingredientValues(body);
  const row = await c.env.DB
    .prepare(
      `INSERT INTO ingredients (${INGREDIENT_FIELDS.join(',')}) VALUES (${INGREDIENT_FIELDS.map(() => '?').join(',')}) RETURNING id`,
    )
    .bind(...INGREDIENT_FIELDS.map((k) => (v as Record<string, unknown>)[k] ?? null))
    .first<{ id: number }>();
  // 초기 재고는 원장에 RESTOCK으로 기록
  if (body.initial_stock !== undefined && body.initial_stock !== '') {
    const ing = (await repo.getIngredient(c.env.DB, row!.id))!;
    await repo.applyMovements(c.env.DB, [
      { ingredientId: ing.id, delta: parseQuantity(String(body.initial_stock), ing), reason: 'RESTOCK', note: '초기 재고' },
    ]);
  }
  return c.json(view((await repo.getIngredient(c.env.DB, row!.id))!), 201);
});

admin.put('/ingredients/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const v = ingredientValues(await c.req.json());
  await c.env.DB
    .prepare(`UPDATE ingredients SET ${INGREDIENT_FIELDS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...INGREDIENT_FIELDS.map((k) => (v as Record<string, unknown>)[k] ?? null), id)
    .run();
  return c.json(view((await repo.getIngredient(c.env.DB, id))!));
});

admin.delete('/ingredients/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM ingredients WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// 입고: { quantity: "2" | "350ml" }
admin.post('/ingredients/:id/restock', async (c) => {
  const ing = await repo.getIngredient(c.env.DB, Number(c.req.param('id')));
  if (!ing) return c.json({ error: 'not found' }, 404);
  const { quantity, note } = await c.req.json<{ quantity: string; note?: string }>();
  return c.json(view(await addMovement(c.env, ing.id, parseQuantity(String(quantity), ing), 'RESTOCK', note ?? '웹 입고')));
});

// 실사 보정: { quantity: "1.5" | "1050ml" }
admin.post('/ingredients/:id/count', async (c) => {
  const ing = await repo.getIngredient(c.env.DB, Number(c.req.param('id')));
  if (!ing) return c.json({ error: 'not found' }, 404);
  const { quantity } = await c.req.json<{ quantity: string }>();
  return c.json(view(await setActualStock(c.env, ing.id, parseQuantity(String(quantity), ing))));
});

// 폐기: { quantity }
admin.post('/ingredients/:id/waste', async (c) => {
  const ing = await repo.getIngredient(c.env.DB, Number(c.req.param('id')));
  if (!ing) return c.json({ error: 'not found' }, 404);
  const { quantity, note } = await c.req.json<{ quantity: string; note?: string }>();
  return c.json(view(await addMovement(c.env, ing.id, -parseQuantity(String(quantity), ing), 'WASTE', note ?? '폐기')));
});

// ── 메뉴 / 레시피 ────────────────────────────────────
admin.get('/menu-items', async (c) => {
  const [menus, recipes, ingredients] = await Promise.all([
    repo.listMenuItems(c.env.DB),
    repo.listRecipes(c.env.DB),
    repo.listIngredients(c.env.DB),
  ]);
  const ingName = new Map(ingredients.map((i) => [i.id, i.name]));
  return c.json(
    menus.map((m) => {
      const recipe = recipes.filter((r) => r.menu_item_id === m.id);
      return {
        ...m,
        recipe,
        recipe_summary: recipe.map((r) => `${ingName.get(r.ingredient_id) ?? '?'} ${r.amount}${r.unit === 'ea' ? '개' : r.unit}`).join(', '),
        state: !m.active ? 'ignored' : recipe.length ? 'done' : 'todo',
      };
    }),
  );
});

admin.post('/menu-items', async (c) => {
  const b = await c.req.json<{ name: string; toss_item_id?: string; active?: boolean; category?: string }>();
  if (!b.name) throw new Error('메뉴 이름을 입력하세요');
  const row = await c.env.DB
    .prepare('INSERT INTO menu_items (name, toss_item_id, active, category) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(b.name, b.toss_item_id || null, b.active === false ? 0 : 1, b.category || null)
    .first();
  return c.json(row, 201);
});

// 일부 필드만 수정: { name?, toss_item_id?, active?, category? }
admin.patch('/menu-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const cur = (await repo.listMenuItems(c.env.DB)).find((m) => m.id === id);
  if (!cur) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<{ name?: string; toss_item_id?: string | null; active?: boolean; category?: string | null }>();
  const row = await c.env.DB
    .prepare('UPDATE menu_items SET name = ?, toss_item_id = ?, active = ?, category = ? WHERE id = ? RETURNING *')
    .bind(
      b.name ?? cur.name,
      b.toss_item_id !== undefined ? b.toss_item_id || null : cur.toss_item_id,
      b.active !== undefined ? (b.active ? 1 : 0) : cur.active,
      b.category !== undefined ? b.category || null : cur.category ?? null,
      id,
    )
    .first();
  return c.json(row);
});

admin.delete('/menu-items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM menu_items WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// 레시피 전체 교체: { lines: [{ ingredient_id, amount, unit }] }
admin.put('/menu-items/:id/recipe', async (c) => {
  const menuId = Number(c.req.param('id'));
  const { lines } = await c.req.json<{ lines: { ingredient_id: number; amount: number; unit: string }[] }>();
  const db = c.env.DB;
  for (const l of lines) {
    const ing = await repo.getIngredient(db, Number(l.ingredient_id));
    if (!ing) throw new Error(`재료 ${l.ingredient_id} 없음`);
    if (!(Number(l.amount) > 0)) throw new Error(`${ing.name}: 수량은 0보다 커야 합니다`);
    toBaseUnit(Number(l.amount), l.unit, ing); // 단위 검증
  }
  await db.batch([
    db.prepare('DELETE FROM recipe_lines WHERE menu_item_id = ?').bind(menuId),
    ...lines.map((l) =>
      db
        .prepare('INSERT INTO recipe_lines (menu_item_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)')
        .bind(menuId, Number(l.ingredient_id), Number(l.amount), l.unit),
    ),
  ]);
  return c.json({ ok: true });
});

// 토스 연동 전 테스트용 수동 판매: { menu_item_id, quantity }
admin.post('/sales/manual', async (c) => {
  const { menu_item_id, quantity } = await c.req.json<{ menu_item_id: number; quantity?: number }>();
  const menu = (await repo.listMenuItems(c.env.DB)).find((m) => m.id === Number(menu_item_id));
  if (!menu) throw new Error('메뉴를 찾을 수 없습니다');
  const orderId = `manual-${crypto.randomUUID()}`;
  const order = {
    orderId,
    state: 'COMPLETED',
    status: 'COMPLETED' as const,
    items: [{ tossItemId: menu.toss_item_id, name: menu.name, quantity: Number(quantity ?? 1), options: [] }],
  };
  return c.json(await processOrder(c.env, order, { manual: true, ...order }));
});

// 수동 판매 취소 (토스 취소와 동일한 경로로 원복)
admin.post('/sales/:orderId/cancel', async (c) => {
  const orderId = c.req.param('orderId');
  return c.json(await processOrder(c.env, { orderId, state: 'CANCELED', status: 'CANCELED', items: [] }, { manual: true }));
});

// ── 기록 / 발주 ──────────────────────────────────────
admin.get('/movements', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const ingredientId = c.req.query('ingredient_id');
  // balance: 그 변동 직후 남은 양 (재료별 누적합)
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM (
         SELECT m.*, i.name AS ingredient_name,
                SUM(m.delta) OVER (PARTITION BY m.ingredient_id ORDER BY m.id) AS balance
         FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
       ) WHERE (? IS NULL OR ingredient_id = ?) ORDER BY id DESC LIMIT ?`,
    )
    .bind(ingredientId ?? null, ingredientId ? Number(ingredientId) : null, limit)
    .all<{ ingredient_id: number; delta: number; balance: number }>();
  const ings = new Map((await repo.listIngredients(c.env.DB)).map((i) => [i.id, i]));
  return c.json(
    results.map((r) => {
      const ing = ings.get(r.ingredient_id);
      return {
        ...r,
        delta_display: ing ? formatDelta(r.delta, ing) : String(r.delta),
        balance_display: ing ? (r.balance <= 0 ? `재고 없음${r.balance < 0 ? ` (${formatStock(-r.balance, ing)} 초과)` : ''}` : formatStock(r.balance, ing)) : '',
      };
    }),
  );
});

admin.get('/unmapped', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM unmapped_items ORDER BY last_seen DESC').all();
  return c.json(results);
});

// 미등록 판매 메뉴를 메뉴로 등록 (이후 레시피만 입력)
admin.post('/unmapped/:key/register', async (c) => {
  const key = c.req.param('key');
  const u = await c.env.DB.prepare('SELECT * FROM unmapped_items WHERE key = ?').bind(key).first<{ name: string; toss_item_id: string | null }>();
  if (!u) return c.json({ error: 'not found' }, 404);
  const exists = (await repo.listMenuItems(c.env.DB)).some((m) => m.name === u.name);
  if (!exists) {
    await c.env.DB.prepare('INSERT INTO menu_items (name, toss_item_id) VALUES (?, ?)').bind(u.name, u.toss_item_id).run();
  }
  await c.env.DB.prepare('DELETE FROM unmapped_items WHERE key = ?').bind(key).run();
  return c.json({ ok: true });
});

admin.delete('/unmapped/:key', async (c) => {
  await c.env.DB.prepare('DELETE FROM unmapped_items WHERE key = ?').bind(c.req.param('key')).run();
  return c.json({ ok: true });
});

admin.get('/purchase-orders', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders ORDER BY id DESC LIMIT 50').all<{ lines: string }>();
  return c.json(results.map((r) => ({ ...r, lines: JSON.parse(r.lines) })));
});

admin.post('/purchase-orders', async (c) => c.json({ id: await issueReorderForAllLow(c.env) }));

// ── 설정 ─────────────────────────────────────────────
admin.get('/settings', async (c) => c.json(await repo.getSettings(c.env.DB)));

admin.put('/settings', async (c) => {
  const b = await c.req.json<Record<string, string>>();
  for (const key of ['closing_time', 'business_day_start'] as const) {
    if (b[key] === undefined) continue;
    parseHHMM(b[key]);
    await repo.setSetting(c.env.DB, key, b[key]);
  }
  return c.json(await repo.getSettings(c.env.DB));
});

admin.post('/report/send', async (c) => {
  await sendDailyReport(c.env);
  return c.json({ ok: true });
});

// ── 토스 ─────────────────────────────────────────────
admin.post('/toss/sync', async (c) => c.json(await syncRecentOrders(c.env, Number(c.req.query('pages') ?? 1))));

admin.post('/toss/orders/:orderId/sync', async (c) => c.json(await syncOrderById(c.env, c.req.param('orderId'))));

// 토스 매장 메뉴 불러오기: ?source=catalog(기본) | orders(최근 주문에서)
admin.post('/toss/import-menus', async (c) => {
  const source = c.req.query('source') ?? 'catalog';
  return c.json(source === 'orders' ? await importMenusFromOrders(c.env) : await importMenusFromCatalog(c.env));
});
admin.get('/toss/catalog', async (c) => c.json(await new TossClient(c.env).listCatalogItems(1, Number(c.req.query('size') ?? 5))));

// 실제 응답 필드 확인용 (normalize.ts 필드명 맞출 때 사용)
admin.get('/toss/orders', async (c) => c.json(await new TossClient(c.env).listOrders(1, Number(c.req.query('size') ?? 5))));
admin.get('/toss/orders/:orderId/raw', async (c) => c.json(await new TossClient(c.env).getOrder(c.req.param('orderId'))));

// ── 텔레그램 ─────────────────────────────────────────
// 배포 후 한 번 호출: 이 Worker 주소로 텔레그램 웹훅 등록 + 명령 메뉴 등록
admin.post('/telegram/setup', async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET을 먼저 설정하세요');
  }
  const url = new URL('/webhook/telegram', c.req.url).toString();
  await setWebhook(c.env, url);
  await setCommands(c.env);
  return c.json({ ok: true, url });
});
