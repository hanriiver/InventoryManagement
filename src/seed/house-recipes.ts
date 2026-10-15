/**
 * 레몬과 김부각 레시피 (가게 레시피 문서 기준).
 * - 재료의 병 용량은 일반적인 수입 용량으로 넣었습니다. 실제 병과 다르면 재료 탭에서 수정하세요.
 * - "나머지 토닉워터/콜라/주스"처럼 양이 정해지지 않은 재료와 가니시는 레시피에 넣지 않았습니다.
 * - 레몬/라임 착즙은 ml(즙)로 넣으면 1개당 즙(레몬 40ml, 라임 20ml)으로 개수가 차감됩니다.
 */
import type { BaseUnit, Supplier } from '../types';

export interface SeedIngredient {
  name: string;
  category: 'liquor' | 'fruit' | 'syrup' | 'etc';
  unit: BaseUnit;
  container_size: number;
  container_label: string;
  yield_ml?: number;
  reorder_point: number;
  order_alias: string;
  supplier?: Supplier;
}

export interface SeedRecipe {
  menu: string;
  lines: { ingredient: string; amount: number; unit: 'ml' | 'ea' }[];
}

const liquor = (name: string, size: number, alias: string): SeedIngredient => ({
  name, category: 'liquor', unit: 'ml', container_size: size, container_label: '병', reorder_point: 1, order_alias: alias,
});
const mixer = (name: string, size: number, alias: string, category: SeedIngredient['category'] = 'syrup'): SeedIngredient => ({
  name, category, unit: 'ml', container_size: size, container_label: '병', reorder_point: 1, order_alias: alias,
});

export const HOUSE_INGREDIENTS: SeedIngredient[] = [
  // 위스키·리큐르
  liquor('제임슨', 700, '제임슨'),
  liquor('베일리스', 700, '베일리스'),
  liquor('짐빔 화이트', 700, '짐빔화이트'),
  liquor('짐빔 라이', 700, '짐빔라이'),
  // 진
  liquor('고든스 진', 700, '고든스진'),
  liquor('헨드릭스 진', 700, '헨드릭스진'),
  // 베르무트·비터
  liquor('마티니 드라이', 750, '마티니드라이'),
  liquor('마티니 로쏘', 750, '마티니로쏘'),
  liquor('캄파리', 700, '캄파리'),
  // 보드카·럼·데킬라
  liquor('티토스', 750, '티토스'),
  liquor('바카디 화이트 럼', 700, '바카디화이트'),
  liquor('호세쿠엘보 실버', 750, '호세쿠엘보실버'),
  // 리큐르
  liquor('트리플 섹', 700, '트리플섹'),
  liquor('깔루아', 700, '깔루아'),
  liquor('미도리', 700, '미도리'),
  liquor('디카이퍼 바나나', 700, '디카이퍼바나나'),
  // 시럽·주스·기타
  mixer('설탕 시럽', 1000, '설탕시럽'),
  mixer('그레나딘 시럽', 700, '그레나딘시럽'),
  mixer('사워 믹서', 1000, '사워믹서'),
  mixer('크랜베리 주스', 1000, '크랜베리주스', 'etc'),
  mixer('우유', 1000, '우유', 'etc'),
  // 과일 (쿠팡 자동주문 예정)
  { name: '레몬', category: 'fruit', unit: 'ea', container_size: 1, container_label: '개', yield_ml: 40, reorder_point: 5, order_alias: '레몬', supplier: 'coupang' },
  { name: '라임', category: 'fruit', unit: 'ea', container_size: 1, container_label: '개', yield_ml: 20, reorder_point: 10, order_alias: '라임', supplier: 'coupang' },
];

const ml = (ingredient: string, amount: number) => ({ ingredient, amount, unit: 'ml' as const });

export const HOUSE_RECIPES: SeedRecipe[] = [
  // 드랍 앤 밤
  { menu: '아이리시 카밤', lines: [ml('제임슨', 15), ml('베일리스', 15)] },
  // 진 베이스
  { menu: '진토닉', lines: [ml('고든스 진', 45), ml('레몬', 10)] },
  { menu: '진피즈', lines: [ml('고든스 진', 45), ml('레몬', 30), ml('설탕 시럽', 10)] },
  { menu: '김렛', lines: [ml('고든스 진', 45), ml('라임', 15), ml('설탕 시럽', 10)] },
  { menu: '헨드릭스 진토닉', lines: [ml('헨드릭스 진', 45)] },
  { menu: '마티니', lines: [ml('고든스 진', 60), ml('마티니 드라이', 10)] },
  { menu: '네그로니', lines: [ml('고든스 진', 30), ml('캄파리', 30), ml('마티니 로쏘', 30)] },
  // 보드카 베이스
  { menu: '코스모폴리탄', lines: [ml('티토스', 30), ml('트리플 섹', 15), ml('라임', 15), ml('크랜베리 주스', 15)] },
  { menu: '블랙 러시안', lines: [ml('티토스', 60), ml('깔루아', 30)] },
  { menu: '화이트 러시안', lines: [ml('티토스', 60), ml('깔루아', 30), ml('우유', 60)] },
  // 럼 베이스
  { menu: '모히또', lines: [ml('바카디 화이트 럼', 60), ml('라임', 20), ml('설탕 시럽', 15)] },
  { menu: '다이키리', lines: [ml('바카디 화이트 럼', 45), ml('라임', 22.5), ml('설탕 시럽', 15)] },
  { menu: '쿠바 리브레', lines: [ml('바카디 화이트 럼', 45), ml('라임', 10)] },
  { menu: '준 벅', lines: [ml('미도리', 30), ml('디카이퍼 바나나', 15), ml('바카디 화이트 럼', 15), ml('사워 믹서', 60)] },
  // 데킬라 베이스
  { menu: '데킬라 선라이즈', lines: [ml('호세쿠엘보 실버', 45), ml('그레나딘 시럽', 15)] },
  { menu: '팔로마', lines: [ml('호세쿠엘보 실버', 45), ml('라임', 15)] },
  { menu: '마가리타', lines: [ml('호세쿠엘보 실버', 45), ml('트리플 섹', 15), ml('라임', 15)] },
];

/** 레시피 문서에 양이 없어 입력이 필요한 항목 */
export const HOUSE_RECIPE_TODO = [
  '아이리시 카밤: 기네스 양 (잔의 70%) — 기네스를 캔/병 단위로 관리하려면 재료 추가 후 레시피에 1개로 넣기',
  '보일러메이커: 짐빔 화이트·라이 한 샷 양과 맥주(앰버 라거·IPA) — 토스 메뉴 이름에 맞춰 레시피 입력',
];
