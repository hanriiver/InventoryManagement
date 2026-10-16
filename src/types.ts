export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TOSS_API_BASE: string;
  TOSS_ACCESS_KEY?: string;
  TOSS_SECRET_KEY?: string;
  TOSS_MERCHANT_ID?: string;
  /** 메뉴(카탈로그) 조회용 앱 키. 비우면 TOSS_ACCESS_KEY/SECRET_KEY 사용 */
  TOSS_MENU_ACCESS_KEY?: string;
  TOSS_MENU_SECRET_KEY?: string;
  TOSS_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
  /** 카카오 개발자 앱 REST API 키 (나에게 보내기 알림) */
  KAKAO_REST_API_KEY?: string;
  /** 카카오 앱에서 Client Secret을 켰을 때만 */
  KAKAO_CLIENT_SECRET?: string;
  /** 오픈빌더 스킬 URL의 ?key= 값 (명령 받기 보안) */
  KAKAO_SKILL_SECRET?: string;
  /** 명령을 허용할 카카오 챗봇 사용자 ID (쉼표로 여러 명) */
  KAKAO_ALLOWED_USERS?: string;
}

export type BaseUnit = 'ml' | 'ea' | 'g';
export type Supplier = 'manual' | 'coupang';
export type MovementReason = 'SALE' | 'CANCEL' | 'RESTOCK' | 'ADJUST' | 'WASTE';

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  unit: BaseUnit;
  container_size: number;
  container_label: string;
  yield_ml: number | null;
  reorder_point: number;
  par_level: number | null;
  order_alias: string | null;
  supplier: Supplier;
  stock: number;
  alert_active: number;
}

export interface MenuItem {
  id: number;
  name: string;
  toss_item_id: string | null;
  /** 0이면 재고 차감 안 함 (음식 등). 판매돼도 알림 없이 무시 */
  active: number;
  kind?: string;
  category?: string | null;
}

export interface RecipeLine {
  id: number;
  menu_item_id: number;
  ingredient_id: number;
  amount: number;
  unit: string;
}

export interface PurchaseOrderLine {
  ingredientId: number;
  name: string;
  qty: number;
  label: string;
  supplier: Supplier;
}
