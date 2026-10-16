/**
 * 토스플레이스 카탈로그(상품) 응답 → 메뉴 목록.
 * 필드명이 문서와 다르면 아래 *_KEYS만 고치면 됩니다.
 */
import { unwrap } from './normalize';

export const CATALOG_LIST_KEYS = ['items', 'catalogItems', 'products', 'content', 'list', 'records', 'data'];
export const CATALOG_ID_KEYS = ['id', 'itemId', 'catalogItemId', 'productId'];
export const CATALOG_NAME_KEYS = ['title', 'name', 'itemName', 'productName', 'displayName'];
export const CATALOG_CATEGORY_KEYS = ['categoryName', 'categoryTitle', 'category'];
export const CATALOG_OPTION_GROUP_KEYS = ['optionGroups', 'options', 'optionSets', 'modifierGroups'];
export const CATALOG_OPTION_CHOICE_KEYS = ['choices', 'options', 'items', 'values', 'optionChoices'];
export const CATALOG_DELETED_KEYS = ['deleted', 'isDeleted', 'archived'];

export interface CatalogEntry {
  tossItemId: string | null;
  name: string;
  category: string | null;
  kind: 'menu' | 'option';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  if (isObj(v)) return str(pick(v, ['title', 'name']));
  return null;
}

export function extractCatalogList(body: unknown): unknown[] {
  const o = unwrap(body);
  if (Array.isArray(o)) return o;
  if (isObj(o)) {
    const list = pick(o, CATALOG_LIST_KEYS);
    if (Array.isArray(list)) return list;
  }
  return [];
}

/** 상품 + 상품 안의 옵션 선택지(샷 추가 등)를 평평한 목록으로 */
export function normalizeCatalog(list: unknown[]): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seenOptions = new Set<string>();
  for (const raw of list) {
    if (!isObj(raw)) continue;
    if (CATALOG_DELETED_KEYS.some((k) => raw[k] === true)) continue;
    const name = str(pick(raw, CATALOG_NAME_KEYS));
    if (!name) continue;
    out.push({
      tossItemId: str(pick(raw, CATALOG_ID_KEYS)),
      name,
      category: str(pick(raw, CATALOG_CATEGORY_KEYS)),
      kind: 'menu',
    });
    const groups = pick(raw, CATALOG_OPTION_GROUP_KEYS);
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const choices = isObj(g) ? pick(g, CATALOG_OPTION_CHOICE_KEYS) : undefined;
      for (const c of Array.isArray(choices) ? choices : [g]) {
        if (!isObj(c)) continue;
        const optName = str(pick(c, ['optionName', 'choiceName', ...CATALOG_NAME_KEYS]));
        if (!optName || seenOptions.has(optName)) continue;
        seenOptions.add(optName);
        out.push({ tossItemId: null, name: optName, category: '옵션', kind: 'option' });
      }
    }
  }
  return out;
}
