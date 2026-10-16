import { describe, expect, it } from 'vitest';
import { splitForKakao } from '../src/kakao/memo';
import { handleSkill, skillReply } from '../src/kakao/skill';
import { parseCommand } from '../src/telegram/commands';
import type { Env } from '../src/types';

describe('카카오 메시지 나누기 (200자)', () => {
  it('짧으면 하나', () => {
    expect(splitForKakao('안녕\n하세요')).toEqual(['안녕\n하세요']);
  });
  it('줄 단위로 200자 이하 조각', () => {
    const text = Array.from({ length: 40 }, (_, i) => `재료${i} 1병 + 300ml`).join('\n');
    const parts = splitForKakao(text, 200, 10);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join('\n')).toBe(text);
  });
  it('너무 긴 한 줄도 자름', () => {
    const parts = splitForKakao('가'.repeat(450), 200, 10);
    expect(parts.map((p) => p.length)).toEqual([200, 200, 50]);
  });
  it('최대 개수를 넘으면 마지막에 안내', () => {
    const parts = splitForKakao('가'.repeat(2000), 200, 3);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toContain('관리자 웹');
    expect(parts[2]!.length).toBeLessThanOrEqual(200);
  });
});

describe('슬래시 없는 명령', () => {
  it('카카오톡에서 그대로 입력', () => {
    expect(parseCommand('재고')).toEqual({ name: 'stock', target: '', quantity: null });
    expect(parseCommand('입고 고든스진 2')).toEqual({ name: 'restock', target: '고든스진', quantity: '2' });
    expect(parseCommand('입고처리 12')).toMatchObject({ name: 'po_recv', target: '12' });
    expect(parseCommand('발주완료 #3')).toMatchObject({ name: 'po_sent', target: '#3' });
    expect(parseCommand('/실사 레몬 12')).toMatchObject({ name: 'count', target: '레몬', quantity: '12' });
    expect(parseCommand('안녕하세요')).toBeNull();
  });
});

describe('카카오 챗봇 스킬', () => {
  it('등록 안 된 사용자에게는 ID만 알려 줌', async () => {
    const env = { KAKAO_ALLOWED_USERS: 'owner-1' } as Env;
    const res = await handleSkill(env, { userRequest: { utterance: '재고', user: { id: 'stranger-9' } } }, () => {});
    const text = res.template.outputs[0]!.simpleText.text;
    expect(text).toContain('stranger-9');
    expect(text).toContain('KAKAO_ALLOWED_USERS');
  });
  it('응답 형식과 1000자 제한', () => {
    const r = skillReply('가'.repeat(1500));
    expect(r.version).toBe('2.0');
    expect(r.template.outputs[0]!.simpleText.text.length).toBeLessThanOrEqual(1000);
    expect(r.template.quickReplies.map((q) => q.label)).toContain('재고');
  });
});
