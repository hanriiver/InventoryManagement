import { describe, expect, it } from 'vitest';
import { classifyStatus, extractOrderList, findField, normalizeOrder } from '../src/toss/normalize';
import { verifyTossSignature } from '../src/toss/webhook';
import { parseCommand } from '../src/telegram/commands';

describe('toss normalize', () => {
  it('공통 응답 껍데기와 다양한 필드명 처리', () => {
    const o = normalizeOrder({
      resultType: 'SUCCESS',
      success: {
        id: 'ORD-1', state: 'COMPLETED',
        lineItems: [
          { itemId: 'T-GT', itemName: '진토닉', quantity: 3, canceledQuantity: 1, options: [{ optionName: '샷 추가', quantity: 1 }] },
          { productId: 99, productName: '하이볼', count: 1, state: 'CANCELED' },
        ],
      },
    });
    expect(o.orderId).toBe('ORD-1');
    expect(o.status).toBe('COMPLETED');
    expect(o.items[0]).toMatchObject({ tossItemId: 'T-GT', name: '진토닉', quantity: 2 });
    expect(o.items[0]!.options[0]).toMatchObject({ name: '샷 추가', quantity: 1 });
    expect(o.items[1]).toMatchObject({ tossItemId: '99', quantity: 0 });
  });
  it('상태 분류', () => {
    expect(classifyStatus('CANCELED')).toBe('CANCELED');
    expect(classifyStatus('PARTIAL_REFUNDED')).toBe('CANCELED');
    expect(classifyStatus('APPROVED')).toBe('COMPLETED');
    expect(classifyStatus('OPEN')).toBe('PENDING');
  });
  it('목록·웹훅 payload에서 값 찾기', () => {
    expect(extractOrderList({ success: { orders: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractOrderList({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(findField({ eventType: 'PAYMENT_APPROVED', data: { merchantId: 'M1', orderId: 'O9' } }, 'orderId')).toBe('O9');
  });
});

describe('toss webhook signature', () => {
  it('v1=hex(HMAC-SHA256(secret, timestamp))', async () => {
    const expected = 'v1=' + (await hmacHex('secret', '1700000000000'));
    // printf '1700000000000' | openssl dgst -sha256 -hmac secret 로 얻은 값과 동일해야 함
    expect(await verifyTossSignature('secret', '1700000000000', 'v1=4fe2ce12fd6bec5e0648b23bfbff158ba5fc18b3a214b4c207314671448a95e1')).toBe(true);
    expect(await verifyTossSignature('secret', '1700000000000', expected)).toBe(true);
    expect(await verifyTossSignature('secret', '1700000000001', expected)).toBe(false);
    expect(await verifyTossSignature('secret', null, expected)).toBe(false);
  });
});

async function hmacHex(secret: string, msg: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('telegram commands', () => {
  it('한글/영문 명령과 수량 분리', () => {
    expect(parseCommand('/입고 핸드릭스 진 2')).toMatchObject({ name: 'restock', target: '핸드릭스 진', quantity: '2' });
    expect(parseCommand('/count 레몬 12개')).toMatchObject({ name: 'count', target: '레몬', quantity: '12개' });
    expect(parseCommand('/실사 핸드릭스 350 ml')).toMatchObject({ name: 'count', target: '핸드릭스', quantity: '350ml' });
    expect(parseCommand('/재고')).toMatchObject({ name: 'stock', target: '', quantity: null });
    expect(parseCommand('/stock@my_bot')).toMatchObject({ name: 'stock', target: '', quantity: null });
    expect(parseCommand('안녕')).toBeNull();
  });
});

describe('order time and quantity', () => {
  it('주문 시각: ISO / epoch 초 / epoch 밀리초', async () => {
    const { parseTime } = await import('../src/toss/normalize');
    expect(parseTime('2026-10-15T10:00:00Z')).toBe('2026-10-15T10:00:00.000Z');
    expect(parseTime(1792058400)).toBe('2026-10-15T10:00:00.000Z');
    expect(parseTime('1792058400000')).toBe('2026-10-15T10:00:00.000Z');
    expect(parseTime('')).toBeNull();
  });
  it('amount(금액)를 수량으로 읽지 않음', () => {
    const o = normalizeOrder({ id: 'X', state: 'COMPLETED', createdAt: 1792058400, lineItems: [{ itemName: '진토닉', amount: 15000 }] });
    expect(o.items[0]!.quantity).toBe(1);
    expect(o.orderedAt).toBe('2026-10-15T10:00:00.000Z');
  });
});

describe('메뉴 항목 찾기 (필드명이 다를 때)', () => {
  it('중첩된 상품 정보와 알 수 없는 배열 이름', () => {
    const o = normalizeOrder({
      resultType: 'SUCCESS',
      success: {
        id: '744', orderState: 'COMPLETED', createdAt: '2026-08-16T14:14:25Z',
        payments: [{ method: 'CARD', amount: 15000 }],
        discounts: [{ title: '단골 할인', amount: 1000 }],
        orderLines: [{ item: { id: 'C1', title: '진토닉' }, quantity: 2, optionChoices: [{ title: '샷 추가', quantity: 1 }] }],
      },
    });
    expect(o.status).toBe('COMPLETED');
    expect(o.items).toEqual([{ tossItemId: 'C1', name: '진토닉', quantity: 2, options: [{ tossItemId: null, name: '샷 추가', quantity: 1 }] }]);
  });
});

describe('토스 오류 메시지', async () => {
  const { describeError } = await import('../src/toss/client');
  it('HTML 403은 차단 안내', () => {
    expect(describeError(403, '/x', '<html><title>403 Forbidden</title></html>')).toContain('차단');
    expect(describeError(401, '/x', '{"error":"bad key"}')).toContain('인증 실패');
    expect(describeError(500, '/x', '<html>err</html>')).toContain('HTML 응답');
  });
});
