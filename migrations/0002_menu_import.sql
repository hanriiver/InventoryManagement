-- 토스 카탈로그에서 불러온 메뉴/옵션 구분과 카테고리
ALTER TABLE menu_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'menu';   -- menu | option
ALTER TABLE menu_items ADD COLUMN category TEXT;
