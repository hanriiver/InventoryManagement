/**
 * 로컬 개발용: 텔레그램에 쌓인 메시지를 가져와(getUpdates) 로컬 서버 웹훅으로 넘겨 줍니다.
 * 배포 전에도 봇 명령(/재고, /입고 …)을 시험할 수 있어요.
 *
 *   터미널 1: npm run dev
 *   터미널 2: npm run bot:local
 *
 * 배포 후 웹훅을 등록했다면 이 도구는 쓰지 마세요 (텔레그램이 둘 중 하나만 허용).
 */
import { readFileSync } from 'node:fs';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const token = vars.TELEGRAM_BOT_TOKEN;
const secret = vars.TELEGRAM_WEBHOOK_SECRET;
const local = process.env.LOCAL_URL ?? 'http://localhost:8787';
if (!token) throw new Error('.dev.vars에 TELEGRAM_BOT_TOKEN을 넣어 주세요');
if (!secret) throw new Error('.dev.vars에 TELEGRAM_WEBHOOK_SECRET을 아무 문자열로 넣어 주세요 (예: localtest123)');

const tg = async (method, body) => {
  const res = await fetch(`${process.env.TELEGRAM_API ?? 'https://api.telegram.org'}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
};

// 켜기 전에 쌓여 있던 메시지는 건너뜀
const pending = await tg('getUpdates', { timeout: 0 });
if (!pending.ok) {
  if (pending.error_code === 409) {
    console.error('이 봇에 웹훅이 등록돼 있어서 로컬 모드를 쓸 수 없어요. (배포된 서버가 메시지를 받고 있음)');
  } else console.error('텔레그램 오류:', pending.description);
  process.exit(1);
}
let offset = pending.result.length ? pending.result.at(-1).update_id + 1 : 0;
console.log(`✅ 텔레그램 로컬 연결됨 → ${local}/webhook/telegram`);
console.log('봇에게 /재고 를 보내 보세요. (끄려면 Ctrl+C)');

for (;;) {
  try {
    const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) throw new Error(r.description);
    for (const update of r.result) {
      offset = update.update_id + 1;
      const text = update.message?.text ?? update.callback_query?.data ?? '';
      const res = await fetch(`${local}/webhook/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify(update),
      });
      console.log(`→ ${text}  (${res.status})`);
    }
  } catch (e) {
    console.error('연결 오류, 3초 후 다시 시도:', e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
