-- 칵테일 레시피에 들어가는 베이스 주류(HOUSE_INGREDIENTS)는 liquor 유지,
-- 싱글몰트·프리미엄 버번 등 단독 서브 위스키는 whisky 카테고리로 분리
UPDATE ingredients
SET category = 'whisky'
WHERE category = 'liquor'
AND name NOT IN (
  '고든스 진', '헨드릭스 진',
  '마티니 드라이', '마티니 로쏘', '캄파리',
  '티토스',
  '바카디 화이트 럼', '호세쿠엘보 실버',
  '트리플 섹', '깔루아', '미도리', '디사론노', '크렘 드 카시스', '론디아즈', '피치트리',
  '제임슨', '베일리스', '짐빔 화이트', '조니워커 블랙'
);
