import type { Env } from '../types';

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

export function telegramConfigured(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

async function call(env: Env, method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`텔레그램 ${method} 실패: ${json.description}`);
  return json.result;
}

/** 설정된 사장님 채팅으로 전송. 텔레그램 미설정이면 로그만 남김 */
export async function sendMessage(env: Env, text: string, keyboard?: InlineKeyboard, chatId?: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !(chatId ?? env.TELEGRAM_CHAT_ID)) {
    console.log('[telegram 미설정] ' + text);
    return;
  }
  // 텔레그램 메시지 최대 4096자
  const chunks = text.match(/[\s\S]{1,4000}(?:\n|$)/g) ?? [text];
  for (let i = 0; i < chunks.length; i++) {
    await call(env, 'sendMessage', {
      chat_id: chatId ?? env.TELEGRAM_CHAT_ID,
      text: chunks[i],
      ...(keyboard && i === chunks.length - 1 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }
}

export async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  await call(env, 'answerCallbackQuery', { callback_query_id: callbackId, text });
}

export async function editKeyboard(env: Env, chatId: number | string, messageId: number, keyboard: InlineKeyboard): Promise<void> {
  await call(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function setWebhook(env: Env, url: string): Promise<unknown> {
  return call(env, 'setWebhook', {
    url,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function setCommands(env: Env): Promise<unknown> {
  return call(env, 'setMyCommands', {
    commands: [
      { command: 'stock', description: '재고 현황 (/재고)' },
      { command: 'order', description: '발주서 만들기 (/발주)' },
      { command: 'restock', description: '입고: /restock 이름 수량 (/입고)' },
      { command: 'count', description: '실사 보정: /count 이름 수량 (/실사)' },
      { command: 'report', description: '오늘 리포트 (/리포트)' },
      { command: 'sync', description: '토스 주문 동기화 (/동기화)' },
      { command: 'help', description: '도움말 (/도움)' },
    ],
  });
}
