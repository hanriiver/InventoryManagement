import { Hono } from 'hono';
import type { Env } from './types';
import { admin } from './routes/admin';
import { verifyTossSignature } from './toss/webhook';
import { findField } from './toss/normalize';
import { tossConfigured } from './toss/client';
import { syncOrderById, syncRecentOrders } from './services/toss-sync';
import { maybeSendDailyReport } from './services/report';
import { handleTelegramUpdate } from './telegram/handler';
import { handleSkill, type SkillRequest } from './kakao/skill';
import { CALLBACK_PATH, handleCallback } from './kakao/auth';
import { sendKakaoMemo } from './kakao/memo';

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

// 카카오 로그인 후 돌아오는 주소 (카카오 개발자 콘솔에 Redirect URI로 등록)
app.get(CALLBACK_PATH, async (c) => {
  const origin = new URL(c.req.url).origin;
  const page = (title: string, msg: string) =>
    c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${title}</title><body style="font-family:system-ui;padding:24px;line-height:1.6"><h2>${title}</h2><p>${msg}</p>
      <p><a href="/">관리자 웹으로 돌아가기</a></p></body>`);
  const error = c.req.query('error_description') ?? c.req.query('error');
  if (error) return page('카카오 연결 실패', error);
  try {
    await handleCallback(c.env, origin, c.req.query('code') ?? '', c.req.query('state') ?? '');
    await sendKakaoMemo(c.env, '✅ 재고 관리 알림이 카카오톡에 연결됐어요.\n발주 알림과 마감 리포트가 여기(나와의 채팅)로 옵니다.');
    return page('카카오톡 연결 완료', '카카오톡 "나와의 채팅"에 테스트 메시지를 보냈어요. 이 창은 닫아도 됩니다.');
  } catch (e) {
    return page('카카오 연결 실패', (e as Error).message);
  }
});

// 카카오 i 오픈빌더 스킬: https://<주소>/webhook/kakao?key=<KAKAO_SKILL_SECRET>
app.post('/webhook/kakao', async (c) => {
  const secret = c.env.KAKAO_SKILL_SECRET;
  if (secret && c.req.query('key') !== secret && c.req.header('x-skill-secret') !== secret) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<SkillRequest>().catch(() => ({}));
  return c.json(await handleSkill(c.env, body, (p) => c.executionCtx.waitUntil(p)));
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
