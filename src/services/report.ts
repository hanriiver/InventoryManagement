import type { Env } from '../types';
import * as repo from '../db/repo';
import { businessDay, businessDayStartUtc, formatKst, isReportDue } from '../domain/time';
import { formatStock } from '../domain/units';
import { needsReorder, toOrderLine } from '../domain/reorder';
import { sendMessage } from '../telegram/api';
import { stockListText } from '../telegram/messages';

export async function buildDailyReport(env: Env, now = new Date()): Promise<string> {
  const db = env.DB;
  const settings = await repo.getSettings(db);
  const start = businessDayStartUtc(now, settings.business_day_start || '06:00');
  const day = businessDay(now, settings.business_day_start || '06:00');

  const orders = await db
    .prepare(`SELECT COUNT(*) AS n FROM sales_orders WHERE status = 'COMPLETED' AND first_seen >= ?`)
    .bind(start)
    .first<{ n: number }>();
  const { results: usage } = await db
    .prepare(
      `SELECT ingredient_id, -SUM(delta) AS used FROM stock_movements
       WHERE reason IN ('SALE', 'CANCEL') AND created_at >= ? GROUP BY ingredient_id HAVING used > 0`,
    )
    .bind(start)
    .all<{ ingredient_id: number; used: number }>();
  const ingredients = await repo.listIngredients(db);
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const out = [`🌙 마감 리포트 ${day} (${formatKst(now)} 기준)`, `완료 주문: ${orders?.n ?? 0}건`, ''];
  if (usage.length) {
    out.push('[오늘 사용량]');
    for (const u of usage) {
      const ing = byId.get(u.ingredient_id);
      if (ing) out.push(`${ing.name}: ${formatStock(u.used, ing)}`);
    }
    out.push('');
  }
  out.push('[현재 재고]', stockListText(ingredients));

  const low = ingredients.filter(needsReorder);
  if (low.length) {
    out.push('', '[발주 필요]', ...low.map((i) => { const l = toOrderLine(i); return `${l.name} ${l.qty}`; }));
  }
  return out.join('\n');
}

export async function sendDailyReport(env: Env, now = new Date()): Promise<void> {
  await sendMessage(env, await buildDailyReport(env, now));
}

/** 크론에서 호출: 마감 시각이 지났고 오늘 아직 안 보냈으면 전송 */
export async function maybeSendDailyReport(env: Env, now = new Date()): Promise<boolean> {
  const s = await repo.getSettings(env.DB);
  const start = s.business_day_start || '06:00';
  if (!isReportDue(now, s.closing_time || '02:00', start, s.last_report_day ?? '')) return false;
  // 먼저 기록해 중복 전송 방지
  await repo.setSetting(env.DB, 'last_report_day', businessDay(now, start));
  await sendDailyReport(env, now);
  return true;
}
