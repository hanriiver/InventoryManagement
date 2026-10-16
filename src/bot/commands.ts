import type { Env, Ingredient, PurchaseOrderLine } from '../types';
import * as repo from '../db/repo';
import { parseQuantity, formatStock } from '../domain/units';
import { CATEGORY_WORDS, parseCommand, parseItems, parseNewIngredient } from '../telegram/commands';
import { needsReorder, toOrderLine } from '../domain/reorder';
import { HELP_TEXT, stockLine, stockListText } from '../telegram/messages';
import { addMovement, issueReorderForAllLow, receivePurchaseOrder, setActualStock } from '../services/inventory';
import { buildDailyReport } from '../services/report';
import { syncRecentOrders } from '../services/toss-sync';
import { tossConfigured } from '../toss/client';

/** 텔레그램 명령 처리. 슬래시(/)는 있어도 없어도 됩니다. */
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
      const all = await repo.listIngredients(env.DB);
      if (!cmd.rest) return stockListText(all);
      const cat = CATEGORY_WORDS[cmd.rest];
      if (cat) {
        const list = all.filter((i) => i.category === cat);
        return list.length ? stockListText(list) : `'${cmd.rest}' 분류에 재료가 없습니다`;
      }
      const found = await repo.searchIngredients(env.DB, cmd.rest);
      return found.length ? found.map(stockLine).join('\n') : `'${cmd.rest}' 재료를 찾을 수 없습니다`;
    }
    case 'low': {
      const all = await repo.listIngredients(env.DB);
      const empty = all.filter((i) => i.stock <= 0);
      const low = all.filter((i) => i.stock > 0 && needsReorder(i));
      if (!empty.length && !low.length) return '부족한 재료가 없습니다';
      const out: string[] = [];
      if (empty.length) out.push(`[재고 없음] ${empty.length}개`, ...empty.map((i) => `· ${i.name}`), '');
      if (low.length) out.push(`[발주 필요] ${low.length}개`, ...low.map(stockLine), '');
      const lines = [...empty, ...low].map(toOrderLine);
      out.push('▼ 발주서 (복사용)', ...lines.map((l) => `${l.name} ${l.qty}`), '', '발주서를 저장하려면 /발주');
      return out.join('\n');
    }
    case 'add': {
      const spec = parseNewIngredient(cmd.rest);
      if ((await repo.searchIngredients(env.DB, spec.name)).some((i) => i.name.replace(/\s/g, '') === spec.name.replace(/\s/g, ''))) {
        throw new Error(`'${spec.name}'은(는) 이미 등록돼 있어요. 입고는 /입고 ${spec.name} 수량`);
      }
      await env.DB
        .prepare(
          `INSERT INTO ingredients (name, category, unit, container_size, container_label, reorder_point, order_alias)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(spec.name, spec.category, spec.unit, spec.container_size, spec.container_label, spec.unit === 'ml' ? 1 : 5, spec.name.replace(/\s+/g, ''))
        .run();
      const unitText = spec.unit === 'ml' ? `${spec.container_size}ml ${spec.container_label}` : `${spec.container_label} 단위`;
      const reorder = spec.unit === 'ml' ? `1${spec.container_label}` : `5${spec.container_label}`;
      return [
        `재료 등록: ${spec.name} (${unitText})`,
        `발주 알림 기준: ${reorder} 이하 (관리자 웹 재료 탭에서 변경)`,
        '',
        `지금 재고는 0이에요. 들어온 양을 입고하세요:`,
        `/입고 ${spec.name} ${spec.unit === 'ml' ? '2' : '24'}`,
        '레시피 연결은 관리자 웹 메뉴·레시피 탭에서 할 수 있어요.',
      ].join('\n');
    }
    case 'restock': {
      const items = parseItems(cmd.rest);
      if (!items.length || items.some((i) => !i.quantity)) {
        throw new Error('사용법: 입고 이름 수량  (예: 입고 고든스진 2)\n여러 개는 쉼표나 줄바꿈으로: 입고 고든스진 2, 레몬 20, IPA 24');
      }
      const out: string[] = [];
      for (const item of items) {
        try {
          const ing = await resolveIngredient(env, item.name);
          const amount = parseQuantity(item.quantity!, ing);
          const after = await addMovement(env, ing.id, amount, 'RESTOCK', '텔레그램 입고');
          out.push(`입고 ${ing.name} +${formatStock(amount, ing)} → 현재 ${formatStock(after.stock, after)}`);
        } catch (e) {
          out.push(`실패 ${item.name}: ${(e as Error).message}`);
        }
      }
      return out.join('\n');
    }
    case 'count': {
      if (!cmd.quantity) throw new Error('사용법: /실사 이름 수량  (예: /실사 레몬 12, /실사 핸드릭스 1.5)');
      const ing = await resolveIngredient(env, cmd.target);
      const actual = parseQuantity(cmd.quantity, ing);
      const after = await setActualStock(env, ing.id, actual);
      const diff = actual - ing.stock;
      return `실사 보정: ${ing.name}\n${formatStock(ing.stock, ing)} → ${formatStock(after.stock, after)} (차이 ${diff >= 0 ? '+' : ''}${Math.round(diff * 100) / 100})`;
    }
    case 'order': {
      const id = await issueReorderForAllLow(env);
      return id ? `발주서 #${id}를 보냈습니다.` : '기준 이하인 재료가 없습니다.';
    }
    case 'report':
      return buildDailyReport(env);
    case 'sync': {
      if (!tossConfigured(env)) return '토스 API 키가 아직 설정되지 않았습니다.';
      const r = await syncRecentOrders(env);
      return `동기화 완료: 변경된 주문 ${r.length}건`;
    }
    case 'po_sent': {
      const id = Number(cmd.target.replace('#', ''));
      if (!id) throw new Error('사용법: 발주완료 발주서번호  (예: 발주완료 12)');
      return (await markPurchaseOrderSent(env, id)) ? `발주 #${id}를 발주 완료로 표시했어요` : `발주 #${id}는 이미 처리됐거나 없는 발주서예요`;
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
  return `발주 #${id} 입고 완료\n${lines.map((l) => `${l.name} +${l.qty}${l.label}`).join('\n')}`;
}

