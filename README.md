# InventoryManagement

바 재고 관리 시스템. 토스플레이스 POS 주문이 완료되면 레시피대로 술·과일 재고를 차감하고,
발주 기준 이하가 되면 텔레그램으로 **발주서**(`핸드릭스진 1` 형식)를 보내고, 매일 마감 시각에 재고 리포트를 보냅니다.

- 런타임: Cloudflare Workers (Hono) + D1(SQLite) + Cron Triggers — 무료 플랜으로 운영 가능
- 알림/조작: 텔레그램 봇
- 관리자 웹: 같은 Worker가 `public/` 정적 파일로 제공

```
[토스플레이스] ─웹훅(결제 승인/취소)─┐
                                     ▼
[텔레그램] ⇄ Worker ── /webhook/toss      서명 검증 → 토스 API로 주문 재조회 → 재고 반영
                     ── /webhook/telegram  봇 명령, 발주서 버튼
                     ── /api/*             관리자 웹 REST (Bearer ADMIN_TOKEN)
                     ── cron 15분          토스 주문 동기화(웹훅 누락 보정) + 마감 리포트
                         │
                         ▼
                        D1
```

## 핵심 동작

| 기능 | 설명 |
|---|---|
| 재고 단위 | 내부는 ml(또는 개/g)로 저장, 화면은 `2병 + 350ml`로 표시 |
| 레몬/라임 | 재료를 `ea` 단위 + `1개당 즙(ml)` 40/20으로 등록 → 레시피에 `레몬 30ml(즙)`이면 0.75개 차감 |
| 발주 기준 | `reorder_point`(병/개) 이하가 되는 순간 1회 알림. 입고되어 기준 위로 올라가면 알림 해제 |
| 발주 수량 | `par_level`(적정재고)까지 채우는 수량, 미설정이면 1 |
| 주문 반영 | 주문마다 "목표 차감량 − 이미 반영된 양"만 기록 → 웹훅 중복, 크론 재처리, 취소, 부분취소 모두 안전 |
| 미등록 메뉴 | 레시피 없는 메뉴가 팔리면 텔레그램 알림 + 관리자 웹 `기록·발주` 탭에 표시 |
| 옵션 | 토스 옵션 이름과 같은 메뉴(예: `샷 추가`)를 등록하면 그 레시피만큼 추가 차감 |
| 마감 리포트 | `closing_time`(KST) 이후 첫 크론에 1회 전송. `business_day_start`(기본 06:00) 기준으로 새벽 영업을 전날로 계산 |
| 쿠팡 | `supplier = coupang` 재료는 발주서에 별도 표시. 자동주문은 `src/suppliers/index.ts`에 자리만 있음 |

## 텔레그램 명령

```
/재고 [이름]        재고 현황            (/stock)
/입고 이름 수량     입고 (2 = 2병, 350ml) (/restock)
/실사 이름 수량     실제 남은 양으로 보정  (/count)
/발주               기준 이하 재료 발주서  (/order)
/리포트             오늘 리포트           (/report)
/동기화             토스 주문 즉시 동기화  (/sync)
```
발주서 메시지의 `✅ 발주 완료` / `📦 입고 처리` 버튼으로 상태 변경 및 입고가 한 번에 됩니다.

## 설치 & 배포

```bash
npm install
npx wrangler login
npx wrangler d1 create inventory        # 출력된 database_id를 wrangler.toml에 입력
npm run db:migrate:remote

# 비밀값 등록
npx wrangler secret put ADMIN_TOKEN              # 관리자 웹 로그인용 임의 문자열
npx wrangler secret put TELEGRAM_BOT_TOKEN       # @BotFather에서 발급
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # 임의 문자열 (영문/숫자/_-)
npx wrangler secret put TOSS_ACCESS_KEY          # 토스플레이스 개발자센터
npx wrangler secret put TOSS_SECRET_KEY
npx wrangler secret put TOSS_MERCHANT_ID         # ⚠️ POS 로그인용 10자리 매장번호와 다른 값
npx wrangler secret put TOSS_WEBHOOK_SECRET      # 웹훅 서명 secret

npm run deploy
```

배포 후:
1. `https://<worker 주소>/` 접속 → ADMIN_TOKEN 입력
2. 설정 탭 → **텔레그램 웹훅 등록**
3. 텔레그램에서 봇에게 `/start` → 답장으로 온 chat_id를 `npx wrangler secret put TELEGRAM_CHAT_ID`로 등록
4. 토스플레이스 개발자센터에서 웹훅 URL을 `https://<worker 주소>/webhook/toss`로 지정
5. 재료 → 메뉴·레시피 등록 → 설정 탭의 **테스트 판매**로 차감 확인

토스 키를 넣기 전에도 테스트 판매, 텔레그램 명령, 마감 리포트는 모두 동작합니다.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars   # 값 채우기
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test                         # 단위 테스트
npm run typecheck
```

## 토스플레이스 연동 메모

공개 문서에서 확인한 내용으로 구현했습니다:
- 인증 헤더 `x-access-key`, `x-secret-key`
- 주문 목록 `GET {TOSS_API_BASE}/merchants/{merchantId}/order/orders?page&size&sortOrder`
- 웹훅 서명 `x-toss-signature == "v1=" + hex(HMAC-SHA256(secret, x-toss-timestamp))`

확정하지 못한 부분 (실제 응답을 보고 한 곳만 고치면 됨):
- **주문 단건 조회 경로**: `src/toss/client.ts`의 `TOSS_PATHS.getOrder` (현재 `/order/orders/{orderId}`로 추정)
- **주문 항목/옵션/상태 필드명**: `src/toss/normalize.ts` 상단의 `*_KEYS` 배열. 여러 후보 이름을 순서대로 찾도록 되어 있음
- **주문 상태값**: `COMPLETE|PAID|APPROV|DONE|CLOSE|SETTLE|SUCCESS` → 완료, `CANCEL|REFUND|VOID` → 취소, 그 외는 대기(차감 안 함)

키를 넣은 뒤 관리자 웹 설정 탭의 **토스 주문 원본 보기**(또는 `GET /api/toss/orders/:orderId/raw`)로
실제 응답을 확인하고 필드명이 다르면 위 두 파일만 수정하면 됩니다.

## 구조

```
src/
  index.ts              Worker 진입점 (웹훅, 크론)
  routes/admin.ts       관리자 REST API
  domain/               순수 로직 (단위 환산, 발주 판단, 주문 차감 diff, KST 시간)
  services/             재고 반영, 토스 동기화, 마감 리포트
  toss/                 토스플레이스 클라이언트, 응답 정규화, 웹훅 서명 검증
  telegram/             봇 API, 명령 파서, 메시지
  suppliers/            공급처 어댑터 (manual, coupang 예정)
  db/repo.ts            D1 쿼리
migrations/             D1 스키마
public/                 관리자 웹
test/                   단위 테스트 (vitest)
```
