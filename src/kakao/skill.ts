/**
 * 카카오 i 오픈빌더 스킬 서버. 카카오톡 채널에 보낸 메시지가 여기로 옵니다.
 * - 응답은 5초 안에 해야 해서, 4초 넘게 걸리는 명령(토스 동기화 등)은 먼저 답하고 결과는 "나에게 보내기"로 보냄
 * - KAKAO_ALLOWED_USERS에 등록된 사용자만 명령 실행. 처음엔 사용자 ID를 알려 줌
 */
import type { Env } from '../types';
import { runCommand } from '../bot/commands';
import { notify } from '../notify';

export interface SkillRequest {
  userRequest?: { utterance?: string; user?: { id?: string } };
}

const QUICK_REPLIES = ['재고', '발주', '리포트', '동기화', '도움'].map((label) => ({ label, action: 'message', messageText: label }));
const SIMPLE_TEXT_MAX = 1000;

export function skillReply(text: string) {
  const t = text.length > SIMPLE_TEXT_MAX ? text.slice(0, SIMPLE_TEXT_MAX - 30) + '\n… (전체는 관리자 웹에서)' : text;
  return { version: '2.0', template: { outputs: [{ simpleText: { text: t } }], quickReplies: QUICK_REPLIES } };
}

export function allowedUsers(env: Env): string[] {
  return (env.KAKAO_ALLOWED_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export async function handleSkill(env: Env, req: SkillRequest, waitUntil: (p: Promise<unknown>) => void) {
  const userId = req.userRequest?.user?.id ?? '';
  const utterance = (req.userRequest?.utterance ?? '').trim();
  if (!allowedUsers(env).includes(userId)) {
    return skillReply(
      `이 카카오 계정은 아직 등록되지 않았어요.\n\n사용자 ID:\n${userId || '(알 수 없음)'}\n\n이 값을 KAKAO_ALLOWED_USERS 비밀값에 넣으면 명령을 쓸 수 있어요.`,
    );
  }
  const work = runCommand(env, utterance).catch((e: Error) => `⚠️ ${e.message}`);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  const text = await Promise.race([work, timeout]);
  if (text !== null) return skillReply(text);
  // 오래 걸리는 명령: 끝나면 나와의 채팅으로 결과 전송
  waitUntil(work.then((t) => notify(env, { text: t })));
  return skillReply('처리 중이에요. 끝나면 카카오톡 "나와의 채팅"으로 결과를 보내 드릴게요.');
}
