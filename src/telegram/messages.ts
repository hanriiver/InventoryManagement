import type { Ingredient, PurchaseOrderLine } from '../types';
import type { InlineKeyboard } from './api';
import { formatStock } from '../domain/units';
import { needsReorder } from '../domain/reorder';
import { formatKst } from '../domain/time';

export function purchaseOrderText(id: number, lines: PurchaseOrderLine[], now = new Date()): string {
  const manual = lines.filter((l) => l.supplier !== 'coupang');
  const coupang = lines.filter((l) => l.supplier === 'coupang');
  const out = [`🚨 발주 필요 #${id} (${formatKst(now)})`, ''];
  if (manual.length) {
    out.push('▼ 아래를 그대로 복사해 발주하세요');
    out.push(...manual.map((l) => `${l.name} ${l.qty}`));
  }
  if (coupang.length) {
    if (manual.length) out.push('');
    out.push('▼ 쿠팡 (자동주문 준비 중 — 현재는 직접 주문)');
    out.push(...coupang.map((l) => `${l.name} ${l.qty}${l.label}`));
  }
  return out.join('\n');
}

export function purchaseOrderKeyboard(id: number): InlineKeyboard {
  return [[
    { text: '✅ 발주 완료', callback_data: `po:sent:${id}` },
    { text: '📦 입고 처리', callback_data: `po:recv:${id}` },
  ]];
}

export function stockLine(i: Ingredient): string {
  if (i.stock <= 0) return `⛔ ${i.name}: 재고 없음${i.stock < 0 ? ` (장부상 ${formatStock(-i.stock, i)} 초과 사용 — 실사로 현재 양 입력)` : ''}`;
  const warn = needsReorder(i) ? '⚠️ ' : '';
  return `${warn}${i.name}: ${formatStock(i.stock, i)}`;
}

export function stockListText(ingredients: Ingredient[]): string {
  if (!ingredients.length) return '등록된 재료가 없습니다. 관리자 웹에서 재료를 먼저 등록하세요.';
  const groups = new Map<string, Ingredient[]>();
  for (const i of ingredients) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  const label: Record<string, string> = { liquor: '🍾 술', beer: '🍺 맥주', fruit: '🍋 과일', syrup: '🍯 시럽', etc: '📦 기타' };
  const out: string[] = [];
  for (const [cat, list] of groups) {
    out.push(`[${label[cat] ?? cat}]`, ...list.map(stockLine), '');
  }
  return out.join('\n').trim();
}

export const HELP_TEXT = [
  '📋 사용 가능한 명령 (앞에 / 는 붙여도 되고 안 붙여도 됩니다)',
  '재고 [이름] — 재고 현황',
  '입고 이름 수량 — 입고. 수량은 병/개 단위, 350ml처럼 ml도 가능',
  '실사 이름 수량 — 실제 남은 양으로 보정',
  '발주 — 기준 이하 재료로 발주서 만들기',
  '발주완료 번호 / 입고처리 번호 — 발주서 상태 변경',
  '리포트 — 오늘 영업 리포트',
  '동기화 — 토스 주문 즉시 동기화',
  '',
  '예) 입고 고든스진 2',
  '예) 실사 레몬 12',
  '예) 실사 헨드릭스 1병+300ml',
  '예) 입고처리 12',
].join('\n');
