export type CommandName = 'stock' | 'restock' | 'count' | 'order' | 'report' | 'sync' | 'help' | 'po_sent' | 'po_recv';

const ALIASES: Record<string, CommandName> = {
  stock: 'stock', 재고: 'stock',
  restock: 'restock', 입고: 'restock',
  count: 'count', 실사: 'count',
  order: 'order', 발주: 'order',
  report: 'report', 리포트: 'report', 마감: 'report',
  sync: 'sync', 동기화: 'sync',
  help: 'help', start: 'help', 도움: 'help', 도움말: 'help', 시작: 'help', 메뉴: 'help',
  발주완료: 'po_sent', 입고처리: 'po_recv',
};

export interface ParsedCommand {
  name: CommandName;
  /** 수량 앞까지의 재료 이름 */
  target: string;
  /** 마지막 토큰이 수량이면 그 값 */
  quantity: string | null;
}

/** "/입고 핸드릭스 진 2" → {restock, target:"핸드릭스 진", quantity:"2"} */
export function parseCommand(text: string): ParsedCommand | null {
  const m = text.trim().match(/^\/?([^\s@]+)(?:@\S+)?\s*(.*)$/s);
  if (!m) return null;
  const name = ALIASES[m[1]!.toLowerCase()];
  if (!name) return null;
  const rest = m[2]!.trim();
  const qm = rest.match(/^(.*?)\s+(-?\d+(?:\.\d+)?\s*(?:ml|g|개|병)?(?:\s*\+?\s*\d+(?:\.\d+)?\s*ml)?)$/i);
  if (qm) return { name, target: qm[1]!.trim(), quantity: qm[2]!.replace(/\s+/g, '') };
  return { name, target: rest, quantity: null };
}
