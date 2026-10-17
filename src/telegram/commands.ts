export type CommandName = 'stock' | 'low' | 'add' | 'restock' | 'count' | 'order' | 'report' | 'sync' | 'help' | 'po_sent' | 'po_recv' | 'service';

const ALIASES: Record<string, CommandName> = {
  stock: 'stock', 재고: 'stock',
  low: 'low', 부족: 'low',
  add: 'add', 재료추가: 'add', 재료등록: 'add',
  restock: 'restock', 입고: 'restock',
  count: 'count', 실사: 'count',
  order: 'order', 발주: 'order',
  report: 'report', 리포트: 'report', 마감: 'report',
  sync: 'sync', 동기화: 'sync',
  help: 'help', start: 'help', 도움: 'help', 도움말: 'help', 시작: 'help', 메뉴: 'help',
  발주완료: 'po_sent', 입고처리: 'po_recv',
  service: 'service', 서비스: 'service',
};

export interface ParsedCommand {
  name: CommandName;
  /** 수량 앞까지의 재료 이름 */
  target: string;
  /** 마지막 토큰이 수량이면 그 값 */
  quantity: string | null;
  /** 명령 뒤 전체 (여러 개 입고 등) */
  rest: string;
}

/** "/입고 핸드릭스 진 2" → {restock, target:"핸드릭스 진", quantity:"2"} */
export function parseCommand(text: string): ParsedCommand | null {
  const m = text.trim().match(/^\/?([^\s@]+)(?:@\S+)?\s*(.*)$/s);
  if (!m) return null;
  const name = ALIASES[m[1]!.toLowerCase()];
  if (!name) return null;
  const rest = m[2]!.trim();
  const qm = rest.match(/^(.*?)\s+(-?\d+(?:\.\d+)?\s*(?:ml|g|개|병)?(?:\s*\+?\s*\d+(?:\.\d+)?\s*ml)?)$/i);
  if (qm) return { name, target: qm[1]!.trim(), quantity: qm[2]!.replace(/\s+/g, ''), rest };
  return { name, target: rest, quantity: null, rest };
}

const QTY = /^(.*?)\s+(-?\d+(?:\.\d+)?\s*(?:ml|g|개|병)?(?:\s*\+?\s*\d+(?:\.\d+)?\s*ml)?)$/i;

/** "고든스진 2, 레몬 20\nIPA 24" → [{name:'고든스진', quantity:'2'}, ...] (쉼표·줄바꿈 구분) */
export function parseItems(rest: string): { name: string; quantity: string | null }[] {
  return rest
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(QTY);
      return m ? { name: m[1]!.trim(), quantity: m[2]!.replace(/\s+/g, '') } : { name: part, quantity: null };
    });
}

export const CATEGORY_WORDS: Record<string, 'liquor' | 'beer' | 'fruit' | 'syrup' | 'etc'> = {
  술: 'liquor', 주류: 'liquor', 맥주: 'beer', 과일: 'fruit', 시럽: 'syrup', 기타: 'etc', 주스: 'etc', 음료: 'etc',
};

export interface NewIngredientSpec {
  name: string;
  unit: 'ml' | 'ea';
  container_size: number;
  container_label: string;
  category: 'liquor' | 'beer' | 'fruit' | 'syrup' | 'etc';
}

/**
 * "/재료추가 탱커레이 700" → 700ml 병 술
 * "/재료추가 토닉워터 개 기타" → 개수 단위
 * "/재료추가 코로나 캔 맥주" → 개수 단위(표시 '캔'), 맥주
 */
export function parseNewIngredient(rest: string): NewIngredientSpec {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  let size: number | null = null;
  let label: string | null = null;
  let category: NewIngredientSpec['category'] | null = null;
  const nameParts: string[] = [];
  for (const t of tokens) {
    const ml = t.match(/^(\d+(?:\.\d+)?)(ml|l)?$/i);
    if (ml && size === null && label === null) {
      size = Number(ml[1]) * (ml[2]?.toLowerCase() === 'l' ? 1000 : 1);
      continue;
    }
    if (/^(개|캔|팩|봉)$/.test(t) && label === null && size === null) {
      label = t;
      continue;
    }
    if (CATEGORY_WORDS[t] && category === null && nameParts.length) {
      category = CATEGORY_WORDS[t]!;
      continue;
    }
    nameParts.push(t);
  }
  const name = nameParts.join(' ');
  if (!name) throw new Error('사용법: 재료추가 이름 병용량  (예: 재료추가 탱커레이 700, 재료추가 코로나 캔 맥주)');
  if (size !== null) return { name, unit: 'ml', container_size: size, container_label: '병', category: category ?? 'liquor' };
  if (label !== null) return { name, unit: 'ea', container_size: 1, container_label: label, category: category ?? 'etc' };
  return { name, unit: 'ml', container_size: 700, container_label: '병', category: category ?? 'liquor' };
}
