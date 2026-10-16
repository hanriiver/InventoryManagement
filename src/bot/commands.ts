import type { Env, Ingredient, PurchaseOrderLine } from '../types';
import * as repo from '../db/repo';
import { parseQuantity, formatStock } from '../domain/units';
import { parseCommand } from '../telegram/commands';
import { HELP_TEXT, stockLine, stockListText } from '../telegram/messages';
import { addMovement, issueReorderForAllLow, receivePurchaseOrder, setActualStock } from '../services/inventory';
import { buildDailyReport } from '../services/report';
import { syncRecentOrders } from '../services/toss-sync';
import { tossConfigured } from '../toss/client';

/** 텔레그램·카카오톡 공통 명령 처리. 슬래시(/)는 있어도 없어도 됩니다. */
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
      const after = await addMovement(env, ing.id, amount, 'RESTOCK', '메신저 입고');
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
    case 'po_sent': {
      const id = Number(cmd.target.replace('#', ''));
      if (!id) throw new Error('사용법: 발주완료 발주서번호  (예: 발주완료 12)');
      return (await markPurchaseOrderSent(env, id)) ? `✅ 발주 #${id}를 발주 완료로 표시했어요` : `발주 #${id}는 이미 처리됐거나 없는 발주서예요`;
    }
    case 'po_recv': {
      const id = Number(cmd.target.replace('#', ''));
      if (!id) throw new Error('사용법: 입고처리 발주서번호  (예: 입고처리 12)');
      const lines = await receivePurchaseOrder(env, id);
      return lines ? receivedText(id, lines) : `발주 #${id}는 이미 입고됐거나 없는 발주서예요`;
    }
  }
}

export function markPurchaseOrderSent(env: Env, id: number): Promise<boolean> {
  return repo.setPurchaseOrderStatus(env.DB, id, 'SENT', ['DRAFT']);
}

export function receivedText(id: number, lines: PurchaseOrderLine[]): string {
  return `📦 발주 #${id} 입고 완료\n${lines.map((l) => `${l.name} +${l.qty}${l.label}`).join('\n')}`;
}

