/**
 * 사장님에게 알림 보내기: 텔레그램. 아직 설정 전이면 서버 로그에 남김.
 */
import type { Env } from './types';
import type { InlineKeyboard } from './telegram/api';
import { sendMessage as sendTelegram } from './telegram/api';

export interface Notice {
  text: string;
  /** 텔레그램 버튼 */
  buttons?: InlineKeyboard;
}

export async function notify(env: Env, n: Notice): Promise<void> {
  await sendTelegram(env, n.text, n.buttons);
}
