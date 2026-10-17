import { describe, expect, it } from 'vitest';
import { extractCatalogList, normalizeCatalog } from '../src/toss/catalog';
import { computeConsumption } from '../src/domain/reconcile';
import { formatDelta, parseQuantity } from '../src/domain/units';
import { parseCommand } from '../src/telegram/commands';
import type { Ingredient } from '../src/types';

const gin: Ingredient = {
  id: 1, name: '핸드릭스 진', category: 'liquor', unit: 'ml', container_size: 700, container_label: '병',
  yield_ml: null, reorder_point: 1, par_level: null, order_alias: null, supplier: 'manual', stock: 0, alert_active: 0, bot_hidden: 0,
};

describe('toss catalog', () => {
  it('상품과 옵션 선택지를 메뉴 목록으로', () => {
    const list = extractCatalogList({
      resultType: 'SUCCESS',
      success: {
        items: [
          { id: 'C1', title: '진토닉', category: { title: '칵테일' }, optionGroups: [{ title: '추가', choices: [{ title: '샷 추가' }, { title: '샷 추가' }] }] },
          { id: 'C2', name: '감자튀김', categoryName: '안주' },
          { id: 'C3', title: '삭제된 메뉴', deleted: true },
        ],
      },
    });
    expect(normalizeCatalog(list)).toEqual([
      { tossItemId: 'C1', name: '진토닉', category: '칵테일', kind: 'menu' },
      { tossItemId: null, name: '샷 추가', category: '옵션', kind: 'option' },
      { tossItemId: 'C2', name: '감자튀김', category: '안주', kind: 'menu' },
    ]);
  });
});

describe('차감 안 함 메뉴', () => {
  it('비활성 메뉴는 차감도, 미등록 알림도 없음', () => {
    const r = computeConsumption(
      { orderId: 'o', state: 'COMPLETED', status: 'COMPLETED', items: [{ tossItemId: 'C2', name: '감자튀김', quantity: 1, options: [] }] },
      [{ id: 1, name: '감자튀김', toss_item_id: 'C2', active: 0 }],
      [],
      new Map(),
    );
    expect(r.consumption.size).toBe(0);
    expect(r.unmapped).toEqual([]);
  });
});

describe('병 + ml 입력과 표시', () => {
  it('1병+300ml', () => {
    expect(parseQuantity('1병+300ml', gin)).toBe(1000);
    expect(parseQuantity('0병+350ml', gin)).toBe(350);
    expect(parseQuantity('2병 0ml', gin)).toBe(1400);
  });
  it('변동량', () => {
    expect(formatDelta(-45, gin)).toBe('-45ml');
    expect(formatDelta(1400, gin)).toBe('+2병');
    expect(formatDelta(-750, gin)).toBe('-1병 + 50ml');
  });
  it('텔레그램 명령에서 병+ml', () => {
    expect(parseCommand('/실사 핸드릭스 1병+300ml')).toMatchObject({ name: 'count', target: '핸드릭스', quantity: '1병+300ml' });
  });
});
