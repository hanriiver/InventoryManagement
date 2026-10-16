-- 거래명세서(세계주류, 2026-10-16) 기준 병 용량 수정: 고든스진, 론디아즈 151, 바카디 카르타블랑카는 750ml
-- 재고(ml)는 그대로 두고 1병 기준만 바꿉니다. 700으로 등록된 경우에만 변경 (직접 다른 값으로 고친 건 유지)
UPDATE ingredients SET container_size = 750 WHERE name IN ('고든스 진', '론디아즈', '바카디 화이트 럼') AND container_size = 700;
