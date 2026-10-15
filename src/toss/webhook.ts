/**
 * 토스플레이스 웹훅 서명 검증.
 * x-toss-signature == "v1=" + hex(HMAC-SHA256(secret, x-toss-timestamp))
 *
 * 서명이 timestamp만 대상으로 하므로 본문은 신뢰하지 않고, orderId만 꺼내 토스 API로 다시 조회합니다.
 */
export async function verifyTossSignature(
  secret: string,
  timestamp: string | null | undefined,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (!timestamp || !signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));
  const expected = 'v1=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatureHeader.split(',').some((s) => timingSafeEqual(s.trim(), expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
