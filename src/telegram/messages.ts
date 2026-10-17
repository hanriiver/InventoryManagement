import type { Ingredient, PurchaseOrderLine } from '../types';
import type { InlineKeyboard } from './api';
import { formatStock } from '../domain/units';
import { needsReorder } from '../domain/reorder';
import { formatKst } from '../domain/time';

export function purchaseOrderText(id: number, lines: PurchaseOrderLine[], now = new Date()): string {
  const manual = lines.filter((l) => l.supplier !== 'coupang');
  const coupang = lines.filter((l) => l.supplier === 'coupang');
  const out = [`[발주 필요] #${id} (${formatKst(now)})`, ''];
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
    { text: '발주 완료', callback_data: `po:sent:${id}` },
    { text: '입고 처리', callback_data: `po:recv:${id}` },
  ]];
}

export function stockLine(i: Ingredient): string {
  if (i.stock <= 0) return `${i.name}: 재고 없음${i.stock < 0 ? ` (장부상 ${formatStock(-i.stock, i)} 초과 사용, /실사로 맞춰 주세요)` : ''}`;
  return `${i.name}: ${formatStock(i.stock, i)}${needsReorder(i) ? ' (부족)' : ''}`;
}

export function stockListText(ingredients: Ingredient[], recipeCounts?: Map<number, number>): string {
  if (!ingredients.length) return '등록된 재료가 없습니다. 관리자 웹에서 재료를 먼저 등록하세요.';

  const catOrder = ['liquor', 'beer', 'syrup', 'fruit', 'etc'];
  const catRank = (c: string) => (catOrder.includes(c) ? catOrder.indexOf(c) : catOrder.length);

  if (recipeCounts && recipeCounts.size > 0) {
    const inRecipe = ingredients
      .filter((i) => (recipeCounts.get(i.id) ?? 0) > 0)
      .sort((a, b) => (recipeCounts.get(b.id) ?? 0) - (recipeCounts.get(a.id) ?? 0));
    const notInRecipe = ingredients.filter((i) => (recipeCounts.get(i.id) ?? 0) === 0);

    const recipeLabel: Record<string, string> = { liquor: '베이스 주류', beer: '맥주', fruit: '과일', syrup: '시럽', etc: '음료·기타' };
    const recipeCatOrder = ['liquor', 'beer', 'fruit', 'syrup', 'etc'];
    const recipeCatRank = (c: string) => (recipeCatOrder.includes(c) ? recipeCatOrder.indexOf(c) : recipeCatOrder.length);

    const out: string[] = [];
    if (inRecipe.length) {
      const recipeCats = [...new Set(inRecipe.map((i) => i.category))].sort((a, b) => recipeCatRank(a) - recipeCatRank(b));
      for (const cat of recipeCats) {
        const items = inRecipe
          .filter((i) => i.category === cat)
          .sort((a, b) => (recipeCounts.get(b.id) ?? 0) - (recipeCounts.get(a.id) ?? 0));
        out.push(`[${recipeLabel[cat] ?? cat}]`, ...items.map(stockLine), '');
      }
    }
    if (notInRecipe.length) {
      const label: Record<string, string> = { liquor: '기타 주류', beer: '맥주', fruit: '과일', syrup: '시럽', etc: '기타' };
      const cats = [...new Set(notInRecipe.map((i) => i.category))].sort((a, b) => catRank(a) - catRank(b));
      for (const cat of cats) {
        out.push(`[${label[cat] ?? cat}]`, ...notInRecipe.filter((i) => i.category === cat).map(stockLine), '');
      }
    }
    return out.join('\n').trim();
  }

  const label: Record<string, string> = { liquor: '술', beer: '맥주', fruit: '과일', syrup: '시럽', etc: '기타' };
  const cats = [...new Set(ingredients.map((i) => i.category))].sort((a, b) => catRank(a) - catRank(b));
  const out: string[] = [];
  for (const cat of cats) {
    out.push(`[${label[cat] ?? cat}]`, ...ingredients.filter((i) => i.category === cat).map(stockLine), '');
  }
  return out.join('\n').trim();
}

export const HELP_TEXT = [
  '명령어 (앞에 / 는 붙여도 되고 안 붙여도 됩니다)',
  '',
  '[재고 보기]',
  '/재고 — 전체 재고',
  '/재고 고든스 — 특정 재료',
  '/재고 맥주 — 분류별 (술·맥주·과일·시럽·기타)',
  '/부족 — 발주 필요·재고 없는 재료만 + 복사용 발주서',
  '',
  '[재고 넣기]',
  '/입고 고든스진 2 — 2병 입고 (350ml처럼 ml도 가능)',
  '/입고 고든스진 2, 레몬 20, IPA 24 — 한 번에 여러 개',
  '/실사 헨드릭스 1병+300ml — 실제 남은 양으로 맞추기',
  '/재료추가 탱커레이 700 — 새 술 등록 (700ml 병)',
  '/재료추가 코로나 캔 맥주 — 개수 단위 재료 등록',
  '/서비스 고든스진 1 — 토스 미결제 서비스(무료 제공) 재고 차감',
  '/서비스 고든스진 1, 레몬 5 — 한 번에 여러 개',
  '',
  '[발주·기타]',
  '/발주 — 기준 이하 재료로 발주서 만들기',
  '/발주완료 12 · /입고처리 12 — 발주서 상태 변경',
  '/리포트 — 오늘 영업 리포트',
  '/동기화 — 토스 주문 바로 가져오기',
].join('\n');
