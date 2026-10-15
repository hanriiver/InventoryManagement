import type { Env, Ingredient } from '../types';
import * as repo from '../db/repo';
import { parseQuantity, formatStock } from '../domain/units';
import { answerCallback, editKeyboard, sendMessage } from './api';
import { parseCommand } from './commands';
import { HELP_TEXT, stockLine, stockListText } from './messages';
import { addMovement, issueReorderForAllLow, receivePurchaseOrder, setActualStock } from '../services/inventory';
import { buildDailyReport } from '../services/report';
import { syncRecentOrders } from '../services/toss-sync';
import { tossConfigured } from '../toss/client';

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

async function resolveIngredient(env: Env, target: string): Promise<Ingredient> {
  if (!target) throw new Error('재료 이름을 입력하세요');
  const found = await repo.searchIngredients(env.DB, target);
  if (found.length === 0) throw new Error(`'${target}' 재료를 찾을 수 없습니다`);
  if (found.length > 1) throw new Error(`여러 재료가 일치합니다: ${found.map((i) => i.name).join(', ')}`);
  return found[0]!;
}

export async function runCommand(env: Env, text: string): Promise<string> {
  const cmd = parseCommand(text);
  if (!cmd) return '알 수 없는 명령입니다.\n\n' + HELP_TEXT;
  switch (cmd.name) {
    case 'help':
      return HELP_TEXT;
    case 'stock': {
      if (!cmd.target && !cmd.quantity) return stockListText(await repo.listIngredients(env.DB));
      const found = await repo.searchIngredients(env.DB, [cmd.target, cmd.quantity].filter(Boolean).join(' '));
      return found.length ? found.map(stockLine).join('\n') : `'${cmd.target}' 재료를 찾을 수 없습니다`;
    }
    case 'restock': {
      if (!cmd.quantity) throw new Error('사용법: /입고 이름 수량  (예: /입고 핸드릭스진 2)');
      const ing = await resolveIngredient(env, cmd.target);
      const amount = parseQuantity(cmd.quantity, ing);
      const after = await addMovement(env, ing.id, amount, 'RESTOCK', '텔레그램 입고');
      return `📦 입고: ${ing.name} +${formatStock(amount, ing)}\n현재: ${formatStock(after.stock, after)}`;
    }
    case 'count': {
      if (!cmd.quantity) throw new Error('사용법: /실사 이름 수량  (예: /실사 레몬 12, /실사 핸드릭스 1.5)');
      const ing = await resolveIngredient(env, cmd.target);
      const actual = parseQuantity(cmd.quantity, ing);
      const after = await setActualStock(env, ing.id, actual);
      const diff = actual - ing.stock;
      return `📝 실사 보정: ${ing.name}\n${formatStock(ing.stock, ing)} → ${formatStock(after.stock, after)} (차이 ${diff >= 0 ? '+' : ''}${Math.round(diff * 100) / 100})`;
    }
    case 'order': {
      const id = await issueReorderForAllLow(env);
      return id ? `발주서 #${id}를 보냈습니다.` : '✅ 기준 이하인 재료가 없습니다.';
    }
    case 'report':
      return buildDailyReport(env);
    case 'sync': {
      if (!tossConfigured(env)) return '토스 API 키가 아직 설정되지 않았습니다.';
      const r = await syncRecentOrders(env);
      return `🔄 동기화 완료: 변경된 주문 ${r.length}건`;
    }
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
    const ok = await repo.setPurchaseOrderStatus(env.DB, id, 'SENT', ['DRAFT']);
    await answerCallback(env, cq.id, ok ? '발주 완료로 표시했어요' : '이미 처리된 발주서예요');
    if (ok) await editKeyboard(env, msg.chat.id, msg.message_id, [[{ text: '📦 입고 처리', callback_data: `po:recv:${id}` }]]);
    return;
  }
  if (action === 'recv') {
    const lines = await receivePurchaseOrder(env, id);
    await answerCallback(env, cq.id, lines ? '입고 처리했어요' : '이미 입고된 발주서예요');
    if (lines) {
      await editKeyboard(env, msg.chat.id, msg.message_id, []);
      await sendMessage(env, `📦 발주 #${id} 입고 완료\n${lines.map((l) => `${l.name} +${l.qty}${l.label}`).join('\n')}`);
    }
  }
}
