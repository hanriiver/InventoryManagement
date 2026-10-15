-- 재료(술, 과일, 시럽 등). stock은 base unit 기준 현재고 캐시이며 stock_movements 합계와 항상 같게 유지합니다.
CREATE TABLE ingredients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  category       TEXT NOT NULL DEFAULT 'liquor',          -- liquor | fruit | syrup | etc
  unit           TEXT NOT NULL DEFAULT 'ml',              -- ml | ea | g
  container_size REAL NOT NULL DEFAULT 1,                 -- 1병 용량(ml). ea/g 재료는 1
  container_label TEXT NOT NULL DEFAULT '병',             -- 발주·표시 단위 이름 (병, 개, 팩)
  yield_ml       REAL,                                    -- 과일 1개당 즙(ml). 레몬 40, 라임 20
  reorder_point  REAL NOT NULL DEFAULT 1,                 -- 이 수량(container 단위) 이하이면 발주 알림
  par_level      REAL,                                    -- 적정재고. 발주수량 = par_level - 현재 (없으면 1)
  order_alias    TEXT,                                    -- 발주서에 찍힐 이름 (예: 핸드릭스진)
  supplier       TEXT NOT NULL DEFAULT 'manual',          -- manual | coupang
  stock          REAL NOT NULL DEFAULT 0,
  alert_active   INTEGER NOT NULL DEFAULT 0,              -- 발주 알림을 이미 보냈는지 (중복 알림 방지)
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE menu_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  toss_item_id TEXT UNIQUE,                               -- 토스 상품 ID (없으면 이름으로 매칭)
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 메뉴 1잔에 들어가는 재료. unit이 'ml'이고 재료가 ea+yield_ml이면 즙 ml → 개수로 환산합니다.
CREATE TABLE recipe_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  amount        REAL NOT NULL,
  unit          TEXT NOT NULL,
  UNIQUE (menu_item_id, ingredient_id)
);

-- 재고 원장. reason: SALE | CANCEL | RESTOCK | ADJUST | WASTE
CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  delta         REAL NOT NULL,
  reason        TEXT NOT NULL,
  ref           TEXT,                                     -- 주문 ID 등
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_movements_ref ON stock_movements(ref);
CREATE INDEX idx_movements_created ON stock_movements(created_at);

-- 토스 주문. 같은 주문을 여러 번 받아도 재고는 "목표 차감량과의 차이"만 반영됩니다.
CREATE TABLE sales_orders (
  order_id   TEXT PRIMARY KEY,
  state      TEXT,
  status     TEXT NOT NULL,                               -- COMPLETED | CANCELED | PENDING
  raw        TEXT,
  version    INTEGER NOT NULL DEFAULT 0,                  -- 동시 처리 시 중복 차감 방지용 낙관적 잠금
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 레시피가 없는 메뉴가 팔렸을 때 기록
CREATE TABLE unmapped_items (
  key          TEXT PRIMARY KEY,                          -- toss id 또는 이름
  name         TEXT NOT NULL,
  toss_item_id TEXT,
  count        INTEGER NOT NULL DEFAULT 0,
  last_order   TEXT,
  last_seen    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  status     TEXT NOT NULL DEFAULT 'DRAFT',               -- DRAFT | SENT | RECEIVED
  lines      TEXT NOT NULL,                               -- JSON [{ingredientId, name, qty, label, supplier}]
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('closing_time', '02:00'),        -- 마감 리포트 전송 시각 (KST)
  ('business_day_start', '06:00'),  -- 영업일이 바뀌는 시각 (KST). 새벽 마감 대비
  ('last_report_day', ''),
  ('last_sync_at', '');
