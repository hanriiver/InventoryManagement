/**
 * 레몬과 김부각 레시피 (가게 레시피 문서 기준).
 * - 재료의 병 용량은 일반적인 수입 용량으로 넣었습니다. 실제 병과 다르면 재료 탭에서 수정하세요.
 * - "나머지 토닉워터/콜라/주스"처럼 양이 정해지지 않은 재료와 가니시는 레시피에 넣지 않았습니다.
 * - 레몬/라임 착즙은 ml(즙)로 넣으면 1개당 즙(레몬 40ml, 라임 20ml)으로 개수가 차감됩니다.
 */
import type { BaseUnit, Supplier } from '../types';

export interface SeedIngredient {
  name: string;
  category: 'liquor' | 'fruit' | 'syrup' | 'beer' | 'etc';
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
  liquor('조니워커 블랙', 700, '조니워커블랙'),
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
  liquor('피치트리', 700, '피치트리'),
  liquor('디사론노', 700, '디사론노'),
  liquor('크렘 드 카시스', 700, '크렘드카시스'),
  liquor('론디아즈', 700, '론디아즈'),
  { name: '앙고스투라 비터즈', category: 'syrup', unit: 'ml', container_size: 200, container_label: '병', reorder_point: 0.3, order_alias: '앙고스투라비터즈' },
  // 시럽·주스·기타
  mixer('설탕 시럽', 1000, '설탕시럽'),
  mixer('그레나딘 시럽', 700, '그레나딘시럽'),
  mixer('사워 믹서', 1000, '사워믹서'),
  mixer('크랜베리 주스', 1000, '크랜베리주스', 'etc'),
  mixer('파인애플 주스', 1000, '파인애플주스', 'etc'),
  mixer('자몽 주스', 1000, '자몽주스', 'etc'),
  mixer('우유', 1000, '우유', 'etc'),
  // 맥주 (캔/병 개수)
  { name: 'IPA', category: 'beer', unit: 'ea', container_size: 1, container_label: '개', reorder_point: 6, order_alias: 'IPA' },
  { name: '라거', category: 'beer', unit: 'ea', container_size: 1, container_label: '개', reorder_point: 6, order_alias: '라거' },
  { name: '기네스', category: 'beer', unit: 'ea', container_size: 1, container_label: '개', reorder_point: 6, order_alias: '기네스' },
  // 과일 (쿠팡 자동주문 예정)
  { name: '레몬', category: 'fruit', unit: 'ea', container_size: 1, container_label: '개', yield_ml: 40, reorder_point: 5, order_alias: '레몬', supplier: 'coupang' },
  { name: '라임', category: 'fruit', unit: 'ea', container_size: 1, container_label: '개', yield_ml: 20, reorder_point: 10, order_alias: '라임', supplier: 'coupang' },
];

const ml = (ingredient: string, amount: number) => ({ ingredient, amount, unit: 'ml' as const });
const ea = (ingredient: string, amount = 1) => ({ ingredient, amount, unit: 'ea' as const });

export const HOUSE_RECIPES: (SeedRecipe & { aliases?: string[] })[] = [
  // 맥주 베이스 (보일러메이커는 메뉴 이름의 IPA/라거로 beerRecipe에서 처리)
  { menu: '아이리시 카밤', lines: [ea('기네스'), ml('제임슨', 15), ml('베일리스', 15)] },
  // 진
  { menu: '진토닉', lines: [ml('고든스 진', 45), ml('레몬', 10)] },
  { menu: '진피즈', lines: [ml('고든스 진', 45), ml('레몬', 30), ml('설탕 시럽', 10)] },
  { menu: '김렛', lines: [ml('고든스 진', 45), ml('라임', 15), ml('설탕 시럽', 10)] },
  { menu: '헨드릭스 진토닉', lines: [ml('헨드릭스 진', 45)] },
  { menu: '마티니', lines: [ml('고든스 진', 60), ml('마티니 드라이', 10)] },
  { menu: '네그로니', lines: [ml('고든스 진', 30), ml('캄파리', 30), ml('마티니 로쏘', 30)] },
  // 보드카
  { menu: '코스모폴리탄', lines: [ml('티토스', 45), ml('트리플 섹', 15), ml('라임', 15), ml('크랜베리 주스', 15)] },
  { menu: '블랙 러시안', lines: [ml('티토스', 45), ml('깔루아', 20)] },
  { menu: '화이트 러시안', lines: [ml('티토스', 30), ml('깔루아', 30), ml('우유', 30)] },
  // 럼
  { menu: '모히또', lines: [ml('바카디 화이트 럼', 60), ml('라임', 20), ml('설탕 시럽', 15)] },
  { menu: '다이키리', lines: [ml('바카디 화이트 럼', 45), ml('라임', 22.5), ml('설탕 시럽', 15)] },
  { menu: '쿠바 리브레', lines: [ml('바카디 화이트 럼', 45), ml('라임', 10)] },
  { menu: '준벅', lines: [ml('바카디 화이트 럼', 15), ml('미도리', 30), ml('디카이퍼 바나나', 15), ml('사워 믹서', 60), ml('파인애플 주스', 60)] },
  { menu: '파우스트', lines: [ml('론디아즈', 30), ml('바카디 화이트 럼', 30), ml('크렘 드 카시스', 15)] },
  { menu: '카타르시스', lines: [ml('론디아즈', 45), ml('라임', 15), ml('디사론노', 15)] },
  // 데킬라
  { menu: '데킬라 선라이즈', lines: [ml('호세쿠엘보 실버', 45), ml('그레나딘 시럽', 15)] },
  { menu: '팔로마', lines: [ml('호세쿠엘보 실버', 45), ml('라임', 15), ml('자몽 주스', 60)] },
  { menu: '마가리타', lines: [ml('호세쿠엘보 실버', 45), ml('트리플 섹', 15), ml('라임', 15)] },
  // 위스키
  { menu: '위스키 사워', lines: [ml('짐빔 화이트', 45), ml('레몬', 22.5), ml('설탕 시럽', 15)] },
  { menu: '갓파더', lines: [ml('조니워커 블랙', 45), ml('디사론노', 15)] },
  { menu: '올드 패션드', aliases: ['올드패션드', '올드 패션', '올드패션'], lines: [ml('짐빔 화이트', 45), ml('설탕 시럽', 10), ml('앙고스투라 비터즈', 2)] },
  // 리큐르
  { menu: '피치 크러시', lines: [ml('피치트리', 45), ml('사워 믹서', 60), ml('크랜베리 주스', 60)] },
  { menu: '미도리 사워', lines: [ml('미도리', 45), ml('사워 믹서', 60)] },
  { menu: '깔루아 밀크', lines: [ml('깔루아', 45), ml('우유', 90)] },
  { menu: '스푸모니', lines: [ml('캄파리', 30), ml('자몽 주스', 90), ml('그레나딘 시럽', 15)] },
  { menu: '제패니즈 슬리퍼', aliases: ['재패니즈 슬리퍼'], lines: [ml('미도리', 40), ml('트리플 섹', 30), ml('레몬', 22.5)] },
  { menu: '롱티', aliases: ['롱 아일랜드 아이스티', '롱아일랜드', '롱 아일랜드'], lines: [ml('고든스 진', 15), ml('티토스', 15), ml('바카디 화이트 럼', 15), ml('호세쿠엘보 실버', 15), ml('트리플 섹', 15), ml('사워 믹서', 45)] },
  // 논알콜
  { menu: '레몬에이드', aliases: ['레모네이드'], lines: [ml('레몬', 45), ml('설탕 시럽', 15)] },
  { menu: '버진 모히또', aliases: ['버진모히토', '논알콜 모히또', '무알콜 모히또'], lines: [ml('라임', 20), ml('설탕 시럽', 15)] },
];

/**
 * 맥주가 들어가는 메뉴: 토스 메뉴 이름으로 판단 (위스키 한 샷 30ml)
 * - 보일러메이커 + IPA → 짐빔 라이 30ml + IPA 1개
 * - 보일러메이커 + 라거 → 짐빔 화이트 30ml + 라거 1개
 * - 그 외 이름에 IPA / 라거 / 기네스 → 그 맥주 1개
 */
export function beerRecipe(menuName: string): SeedRecipe['lines'] | null {
  const n = menuName.replace(/\s+/g, '').toLowerCase();
  const ipa = n.includes('ipa');
  const lager = n.includes('라거');
  if (n.includes('보일러')) {
    if (ipa) return [ml('짐빔 라이', 30), ea('IPA')];
    if (lager) return [ml('짐빔 화이트', 30), ea('라거')];
    return null;
  }
  if (n.includes('카밤')) return null;
  if (ipa) return [ea('IPA')];
  if (lager) return [ea('라거')];
  if (n.includes('기네스')) return [ea('기네스')];
  return null;
}

/** 레시피 문서에 양이 없어 입력이 필요한 항목 */
export const HOUSE_RECIPE_TODO = [
  '보일러메이커: 토스 메뉴 이름에 IPA/라거가 없으면(예: "보일러메이커" 하나에 맥주를 옵션으로 고름) 자동으로 못 넣습니다 — 토스에 어떻게 등록돼 있는지 알려 주세요',
  '토닉워터·탄산수·콜라·오렌지 주스("나머지"로 채우는 것)와 민트·소금·필 같은 가니시는 양이 없어 차감하지 않습니다',
  '올드 패션드 앙고스투라 2~3dash는 2ml로 계산했습니다',
];
