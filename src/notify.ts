/**
 * 사장님에게 알림 보내기. 카카오톡이 연결돼 있으면 카카오톡(나에게 보내기),
 * 아니면 텔레그램, 둘 다 없으면 서버 로그.
 */
import type { Env } from './types';
import type { InlineKeyboard } from './telegram/api';
import { sendMessage as sendTelegram, telegramConfigured } from './telegram/api';
import { kakaoConnected } from './kakao/auth';
import { sendKakaoMemo } from './kakao/memo';

export interface Notice {
  text: string;
  /** 카카오톡용 짧은 버전 (메시지당 200자 제한) */
  short?: string;
  /** 텔레그램 버튼 */
  buttons?: InlineKeyboard;
}

export async function notify(env: Env, n: Notice): Promise<void> {
  if (await kakaoConnected(env)) {
    try {
      await sendKakaoMemo(env, n.short ?? n.text);
      return;
    } catch (e) {
      console.error('카카오톡 알림 실패', e);
      if (!telegramConfigured(env)) return;
    }
  }
  if (telegramConfigured(env)) return sendTelegram(env, n.text, n.buttons);
  console.log('[알림 미설정] ' + n.text);
}
