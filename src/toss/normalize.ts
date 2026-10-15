/**
 * 토스플레이스 주문 응답 → 내부 형식.
 *
 * 공개 문서에서 주문 상세의 항목/옵션 필드명을 확정하지 못해, 흔히 쓰이는 이름 후보를 순서대로 찾습니다.
 * 실제 응답을 보고 필드명이 다르면 아래 *_KEYS 배열만 고치면 됩니다.
 * (관리자 API `GET /api/toss/orders/:orderId/raw` 로 원본 응답을 확인할 수 있습니다)
 */
export const ORDER_ID_KEYS = ['orderId', 'id', 'orderKey'];
export const ORDER_STATE_KEYS = ['state', 'status', 'orderState', 'orderStatus'];
export const ORDER_TIME_KEYS = ['orderedAt', 'createdAt', 'openedAt', 'paidAt', 'completedAt', 'createdDate', 'orderDate', 'createdDateTime'];
export const ORDER_ITEMS_KEYS = ['lineItems', 'orderLineItems', 'items', 'orderItems', 'products', 'menus'];
export const ITEM_ID_KEYS = ['catalogItemId', 'itemId', 'productId', 'menuId', 'id'];
export const ITEM_NAME_KEYS = ['itemName', 'productName', 'menuName', 'name', 'title'];
export const ITEM_QTY_KEYS = ['quantity', 'count', 'qty']; // 'amount'는 금액일 수 있어 제외
export const ITEM_CANCELED_QTY_KEYS = ['canceledQuantity', 'cancelledQuantity', 'cancelQuantity'];
export const ITEM_OPTIONS_KEYS = ['options', 'optionItems', 'selectedOptions', 'modifiers', 'optionChoices'];
export const LIST_KEYS = ['orders', 'content', 'items', 'list', 'records', 'data'];

const CANCELED_RE = /CANCEL|REFUND|VOID/i;
const COMPLETED_RE = /COMPLETE|PAID|APPROV|DONE|CLOSE|SETTLE|SUCCESS/i;

export type OrderStatus = 'COMPLETED' | 'CANCELED' | 'PENDING';

export interface NormalizedOption {
  tossItemId: string | null;
  name: string;
  quantity: number;
}

export interface NormalizedItem extends NormalizedOption {
  options: NormalizedOption[];
}

export interface NormalizedOrder {
  orderId: string;
  state: string;
  status: OrderStatus;
  items: NormalizedItem[];
  /** 주문 시각 (ISO). 응답에 없으면 null */
  orderedAt?: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function pickString(o: Obj, keys: string[]): string | null {
  const v = pick(o, keys);
  if (typeof v === 'string' && v) return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function pickNumber(o: Obj, keys: string[], fallback: number): number {
  const v = Number(pick(o, keys));
  return Number.isFinite(v) ? v : fallback;
}

/** {resultType, success: {...}} / {data: {...}} 같은 공통 응답 껍데기 제거 */
export function unwrap(body: unknown): unknown {
  let cur = body;
  for (let i = 0; i < 3 && isObj(cur); i++) {
    const inner = cur.success ?? cur.data ?? cur.result;
    if (inner === undefined || typeof inner === 'boolean') break;
    cur = inner;
  }
  return cur;
}

export function classifyStatus(state: string): OrderStatus {
  if (CANCELED_RE.test(state)) return 'CANCELED';
  if (COMPLETED_RE.test(state)) return 'COMPLETED';
  return 'PENDING';
}

function normalizeOption(o: unknown): NormalizedOption | null {
  if (typeof o === 'string') return { tossItemId: null, name: o, quantity: 1 };
  if (!isObj(o)) return null;
  const name = pickString(o, ['optionName', 'choiceName', ...ITEM_NAME_KEYS]);
  if (!name) return null;
  return {
    tossItemId: pickString(o, ['optionId', 'choiceId', ...ITEM_ID_KEYS]),
    name,
    quantity: pickNumber(o, ITEM_QTY_KEYS, 1),
  };
}

function normalizeItem(o: unknown): NormalizedItem | null {
  if (!isObj(o)) return null;
  const name = pickString(o, ITEM_NAME_KEYS);
  if (!name) return null;
  let quantity = pickNumber(o, ITEM_QTY_KEYS, 1) - pickNumber(o, ITEM_CANCELED_QTY_KEYS, 0);
  const itemState = pickString(o, ORDER_STATE_KEYS);
  if (itemState && CANCELED_RE.test(itemState)) quantity = 0;

  const rawOptions = pick(o, ITEM_OPTIONS_KEYS);
  const options: NormalizedOption[] = [];
  if (Array.isArray(rawOptions)) {
    for (const ro of rawOptions) {
      // 옵션 그룹 안에 선택지 배열이 있는 형태도 처리
      const nested = isObj(ro) ? pick(ro, ['choices', 'items', 'values', 'options']) : undefined;
      if (Array.isArray(nested)) nested.forEach((n) => { const x = normalizeOption(n); if (x) options.push(x); });
      else { const x = normalizeOption(ro); if (x) options.push(x); }
    }
  }
  return { tossItemId: pickString(o, ITEM_ID_KEYS), name, quantity: Math.max(0, quantity), options };
}

export function normalizeOrder(body: unknown): NormalizedOrder {
  const o = unwrap(body);
  if (!isObj(o)) throw new Error('주문 응답 형식을 해석할 수 없습니다');
  const orderId = pickString(o, ORDER_ID_KEYS);
  if (!orderId) throw new Error('주문 응답에 orderId가 없습니다');
  const state = pickString(o, ORDER_STATE_KEYS) ?? 'UNKNOWN';
  const rawItems = pick(o, ORDER_ITEMS_KEYS);
  const items = Array.isArray(rawItems)
    ? rawItems.map(normalizeItem).filter((x): x is NormalizedItem => x !== null)
    : [];
  return { orderId, state, status: classifyStatus(state), items, orderedAt: parseTime(pick(o, ORDER_TIME_KEYS)) };
}

/** 주문 목록 응답에서 주문 배열 추출 */
export function extractOrderList(body: unknown): unknown[] {
  const o = unwrap(body);
  if (Array.isArray(o)) return o;
  if (isObj(o)) {
    const list = pick(o, LIST_KEYS);
    if (Array.isArray(list)) return list;
  }
  return [];
}

/** 웹훅 payload 어디에 있든 orderId / merchantId 찾기 */
export function findField(payload: unknown, key: string, depth = 4): string | null {
  if (depth < 0) return null;
  if (Array.isArray(payload)) {
    for (const v of payload) { const r = findField(v, key, depth - 1); if (r) return r; }
    return null;
  }
  if (!isObj(payload)) return null;
  const direct = payload[key];
  if (typeof direct === 'string' && direct) return direct;
  if (typeof direct === 'number') return String(direct);
  for (const v of Object.values(payload)) {
    const r = findField(v, key, depth - 1);
    if (r) return r;
  }
  return null;
}

/** ISO 문자열, epoch(초/밀리초) → ISO */
export function parseTime(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
