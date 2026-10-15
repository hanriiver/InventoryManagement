export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TOSS_API_BASE: string;
  TOSS_ACCESS_KEY?: string;
  TOSS_SECRET_KEY?: string;
  TOSS_MERCHANT_ID?: string;
  TOSS_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
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
  active: number;
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
