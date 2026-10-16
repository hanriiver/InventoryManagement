/**
 * 카카오톡 "나에게 보내기". 텍스트 템플릿은 메시지당 200자 제한이라 줄 단위로 나눠 보냅니다.
 * 메시지 아래 버튼은 관리자 웹으로 연결 (카카오 앱 설정의 Web 도메인에 등록된 주소여야 함).
 */
import type { Env } from '../types';
import * as repo from '../db/repo';
import { getAccessToken } from './auth';

export const MEMO_MAX = 200;
const MAX_MESSAGES = 5;

/** 200자 이하 조각으로 나누기 (줄 단위, 너무 긴 줄은 자름) */
export function splitForKakao(text: string, max = MEMO_MAX, maxMessages = MAX_MESSAGES): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const raw of text.split('\n')) {
    for (let line = raw; ; ) {
      const piece = line.slice(0, max);
      const next = cur ? `${cur}\n${piece}` : piece;
      if (next.length > max) {
        chunks.push(cur);
        cur = piece;
      } else cur = next;
      line = line.slice(max);
      if (!line) break;
    }
  }
  if (cur.trim()) chunks.push(cur);
  const nonEmpty = chunks.filter((c) => c.trim());
  if (nonEmpty.length <= maxMessages) return nonEmpty;
  const kept = nonEmpty.slice(0, maxMessages);
  const tail = '\n… 나머지는 관리자 웹에서 확인하세요';
  kept[maxMessages - 1] = kept[maxMessages - 1]!.slice(0, max - tail.length) + tail;
  return kept;
}

async function sendOne(env: Env, token: string, text: string, url: string): Promise<Response> {
  const template = {
    object_type: 'text',
    text,
    link: { web_url: url, mobile_web_url: url },
    button_title: '관리자 웹 열기',
  };
  return fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
}

export async function sendKakaoMemo(env: Env, text: string): Promise<void> {
  const url = (await repo.getSetting(env.DB, 'public_url')) || 'https://www.kakao.com';
  let token = await getAccessToken(env);
  for (const chunk of splitForKakao(text)) {
    let res = await sendOne(env, token, chunk, url);
    if (res.status === 401) {
      token = await getAccessToken(env, true);
      res = await sendOne(env, token, chunk, url);
    }
    if (!res.ok) {
      const msg = `카카오 메시지 전송 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`;
      await repo.setSetting(env.DB, 'kakao_last_error', msg);
      throw new Error(msg);
    }
  }
}
