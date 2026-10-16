import type { Env } from '../types';
import { answerCallback, editKeyboard, sendMessage } from './api';
import { markPurchaseOrderSent, receivedText, runCommand } from '../bot/commands';
import { receivePurchaseOrder } from '../services/inventory';

interface TgUpdate {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

export async function handleTelegramUpdate(env: Env, update: TgUpdate): Promise<void> {
  const allowed = String(env.TELEGRAM_CHAT_ID ?? '');
  if (update.callback_query) {
    const cq = update.callback_query;
    if (String(cq.message?.chat.id) !== allowed) return;
    await handleCallback(env, cq);
    return;
  }
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  if (chatId !== allowed) {
    // 처음 설정할 때 chat_id를 알 수 있도록 안내만 하고 아무 것도 실행하지 않음
    if (msg.text.startsWith('/start') || msg.text.startsWith('/id')) {
      await sendMessage(env, `이 채팅의 chat_id: ${chatId}\nTELEGRAM_CHAT_ID 비밀값에 등록하세요.`, undefined, chatId);
    }
    return;
  }
  try {
    await sendMessage(env, await runCommand(env, msg.text));
  } catch (e) {
    await sendMessage(env, `⚠️ ${(e as Error).message}`);
  }
}

async function handleCallback(
  env: Env,
  cq: NonNullable<TgUpdate['callback_query']>,
): Promise<void> {
  const [kind, action, idStr] = (cq.data ?? '').split(':');
  const id = Number(idStr);
  if (kind !== 'po' || !id) return answerCallback(env, cq.id, '알 수 없는 버튼');
  const msg = cq.message!;
  if (action === 'sent') {
    const ok = await markPurchaseOrderSent(env, id);
    await answerCallback(env, cq.id, ok ? '발주 완료로 표시했어요' : '이미 처리된 발주서예요');
    if (ok) await editKeyboard(env, msg.chat.id, msg.message_id, [[{ text: '📦 입고 처리', callback_data: `po:recv:${id}` }]]);
    return;
  }
  if (action === 'recv') {
    const lines = await receivePurchaseOrder(env, id);
    await answerCallback(env, cq.id, lines ? '입고 처리했어요' : '이미 입고된 발주서예요');
    if (lines) {
      await editKeyboard(env, msg.chat.id, msg.message_id, []);
      await sendMessage(env, receivedText(id, lines));
    }
  }
}
