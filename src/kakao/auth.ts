/**
 * 카카오 로그인(OAuth)으로 "나에게 보내기" 권한(talk_message)을 받아 토큰을 D1 설정에 저장합니다.
 * - 액세스 토큰은 몇 시간마다 만료 → 리프레시 토큰으로 자동 갱신
 * - 리프레시 토큰(약 2개월)은 갱신 때 만료가 1개월 미만이면 새로 발급되어 같이 저장
 *   (크론이 매일 리포트를 보내므로 계속 연장됨)
 */
import type { Env } from '../types';
import * as repo from '../db/repo';

const AUTH_HOST = 'https://kauth.kakao.com';
export const CALLBACK_PATH = '/oauth/kakao/callback';

export function kakaoKeyConfigured(env: Env): boolean {
  return Boolean(env.KAKAO_REST_API_KEY);
}

export async function kakaoConnected(env: Env): Promise<boolean> {
  return kakaoKeyConfigured(env) && Boolean(await repo.getSetting(env.DB, 'kakao_refresh_token'));
}

/** 카카오 로그인 주소 (state는 10분간 유효) */
export async function buildAuthUrl(env: Env, origin: string): Promise<string> {
  if (!env.KAKAO_REST_API_KEY) throw new Error('KAKAO_REST_API_KEY가 설정되지 않았습니다');
  const state = crypto.randomUUID();
  await repo.setSetting(env.DB, 'kakao_oauth_state', `${state}:${Date.now() + 10 * 60_000}`);
  const url = new URL(`${AUTH_HOST}/oauth/authorize`);
  url.searchParams.set('client_id', env.KAKAO_REST_API_KEY);
  url.searchParams.set('redirect_uri', origin + CALLBACK_PATH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'talk_message');
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: env.KAKAO_REST_API_KEY!, ...params });
  if (env.KAKAO_CLIENT_SECRET) body.set('client_secret', env.KAKAO_CLIENT_SECRET);
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) throw new Error(`카카오 토큰 발급 실패: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

async function saveTokens(env: Env, t: TokenResponse): Promise<void> {
  await repo.setSetting(env.DB, 'kakao_access_token', t.access_token);
  await repo.setSetting(env.DB, 'kakao_access_expires_at', String(Date.now() + (t.expires_in - 60) * 1000));
  if (t.refresh_token) await repo.setSetting(env.DB, 'kakao_refresh_token', t.refresh_token);
}

/** 로그인 후 돌아온 code로 토큰 발급 */
export async function handleCallback(env: Env, origin: string, code: string, state: string): Promise<void> {
  const saved = await repo.getSetting(env.DB, 'kakao_oauth_state');
  const [savedState, expires] = saved.split(':');
  if (!savedState || savedState !== state || Number(expires) < Date.now()) throw new Error('로그인 요청이 만료됐거나 올바르지 않습니다. 관리자 웹에서 다시 연결해 주세요.');
  await repo.setSetting(env.DB, 'kakao_oauth_state', '');
  const t = await tokenRequest(env, { grant_type: 'authorization_code', redirect_uri: origin + CALLBACK_PATH, code });
  await saveTokens(env, t);
  await repo.setSetting(env.DB, 'public_url', origin);
  await repo.setSetting(env.DB, 'kakao_last_error', '');
}

/** 유효한 액세스 토큰 (만료됐거나 force면 갱신) */
export async function getAccessToken(env: Env, force = false): Promise<string> {
  const [access, expiresAt, refresh] = await Promise.all([
    repo.getSetting(env.DB, 'kakao_access_token'),
    repo.getSetting(env.DB, 'kakao_access_expires_at'),
    repo.getSetting(env.DB, 'kakao_refresh_token'),
  ]);
  if (!force && access && Number(expiresAt) > Date.now()) return access;
  if (!refresh) throw new Error('카카오톡이 연결되지 않았습니다');
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
  await saveTokens(env, t);
  return t.access_token;
}

export async function disconnect(env: Env): Promise<void> {
  for (const k of ['kakao_access_token', 'kakao_access_expires_at', 'kakao_refresh_token']) await repo.setSetting(env.DB, k, '');
}
