import { Hono } from 'hono';
import type { Env } from './types';
import { admin } from './routes/admin';
import { verifyTossSignature } from './toss/webhook';
import { findField } from './toss/normalize';
import { tossConfigured } from './toss/client';
import { syncOrderById, syncRecentOrders } from './services/toss-sync';
import { maybeSendDailyReport } from './services/report';
import { handleTelegramUpdate } from './telegram/handler';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', admin);

app.post('/webhook/toss', async (c) => {
  const secret = c.env.TOSS_WEBHOOK_SECRET;
  if (!secret || !tossConfigured(c.env)) return c.json({ error: 'toss not configured' }, 503);
  const ok = await verifyTossSignature(secret, c.req.header('x-toss-timestamp'), c.req.header('x-toss-signature'));
  if (!ok) return c.json({ error: 'invalid signature' }, 401);

  const payload = await c.req.json().catch(() => null);
  const merchantId = findField(payload, 'merchantId');
  if (merchantId && merchantId !== c.env.TOSS_MERCHANT_ID) return c.json({ ignored: 'other merchant' });
  const orderId = findField(payload, 'orderId');
  if (!orderId) return c.json({ ignored: 'no orderId' });

  // 토스에는 바로 200을 주고, 주문 조회·차감은 백그라운드에서. 실패해도 15분 크론이 다시 맞춥니다.
  c.executionCtx.waitUntil(
    syncOrderById(c.env, orderId).catch((e) => console.error('토스 주문 처리 실패', orderId, e)),
  );
  return c.json({ ok: true });
});

app.post('/webhook/telegram', async (c) => {
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const update = await c.req.json();
  c.executionCtx.waitUntil(handleTelegramUpdate(c.env, update).catch((e) => console.error('텔레그램 처리 실패', e)));
  return c.json({ ok: true });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          await syncRecentOrders(env);
        } catch (e) {
          console.error('토스 동기화 실패', e);
        }
        await maybeSendDailyReport(env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
