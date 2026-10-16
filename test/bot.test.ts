import { describe, expect, it } from 'vitest';
import { parseCommand, parseItems, parseNewIngredient } from '../src/telegram/commands';

describe('명령 (슬래시 있어도 없어도)', () => {
  it('재고·부족·재료추가', () => {
    expect(parseCommand('/재고 맥주')).toMatchObject({ name: 'stock', rest: '맥주' });
    expect(parseCommand('재고')).toMatchObject({ name: 'stock', rest: '' });
    expect(parseCommand('/부족')).toMatchObject({ name: 'low' });
    expect(parseCommand('/재료추가 탱커레이 700')).toMatchObject({ name: 'add', rest: '탱커레이 700' });
    expect(parseCommand('/입고처리 12')).toMatchObject({ name: 'po_recv', target: '12' });
    expect(parseCommand('안녕하세요')).toBeNull();
  });
});

describe('여러 개 입고', () => {
  it('쉼표·줄바꿈으로 나눔', () => {
    expect(parseItems('고든스진 2, 레몬 20\nIPA 24')).toEqual([
      { name: '고든스진', quantity: '2' },
      { name: '레몬', quantity: '20' },
      { name: 'IPA', quantity: '24' },
    ]);
    expect(parseItems('헨드릭스 진 1병+300ml')).toEqual([{ name: '헨드릭스 진', quantity: '1병+300ml' }]);
    expect(parseItems('고든스진')).toEqual([{ name: '고든스진', quantity: null }]);
  });
});

describe('재료추가', () => {
  it('병 용량 / 개수 단위 / 분류', () => {
    expect(parseNewIngredient('탱커레이 700')).toEqual({ name: '탱커레이', unit: 'ml', container_size: 700, container_label: '병', category: 'liquor' });
    expect(parseNewIngredient('글렌피딕 12년 1L')).toMatchObject({ name: '글렌피딕 12년', container_size: 1000 });
    expect(parseNewIngredient('코로나 캔 맥주')).toEqual({ name: '코로나', unit: 'ea', container_size: 1, container_label: '캔', category: 'beer' });
    expect(parseNewIngredient('오렌지 개 과일')).toMatchObject({ name: '오렌지', unit: 'ea', category: 'fruit' });
    expect(parseNewIngredient('잭다니엘')).toMatchObject({ name: '잭다니엘', unit: 'ml', container_size: 700 });
    expect(() => parseNewIngredient('')).toThrow();
  });
});
