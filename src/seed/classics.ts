/**
 * 레시피 문서에 없는 메뉴용 표준 레시피 (IBA 기준을 가게 술로 맞춤).
 * 토스에 같은 이름의 메뉴가 있고 아직 레시피가 없을 때만 넣고, "확인 필요"로 표시합니다.
 * 버번=짐빔 화이트, 라이=짐빔 라이, 보드카=티토스, 럼=바카디, 데킬라=호세쿠엘보, 진=고든스.
 */
import type { SeedIngredient, SeedRecipe } from './house-recipes';

const liquor = (name: string, alias: string, size = 700): SeedIngredient => ({
  name, category: 'liquor', unit: 'ml', container_size: size, container_label: '병', reorder_point: 1, order_alias: alias,
});
const juice = (name: string, alias: string): SeedIngredient => ({
  name, category: 'etc', unit: 'ml', container_size: 1000, container_label: '병', reorder_point: 1, order_alias: alias,
});
const can = (name: string): SeedIngredient => ({
  name, category: 'etc', unit: 'ea', container_size: 1, container_label: '개', reorder_point: 6, order_alias: name,
});

/** 표준 레시피에서 새로 필요한 재료 (해당 메뉴가 있을 때만 생성) */
export const CLASSIC_INGREDIENTS: SeedIngredient[] = [
  liquor('잭다니엘', '잭다니엘'),
  liquor('블루 큐라소', '블루큐라소'),
  liquor('아페롤', '아페롤'),
  liquor('예거마이스터', '예거마이스터'),
  liquor('말리부', '말리부'),
  juice('오렌지 주스', '오렌지주스'),
  juice('코코넛 크림', '코코넛크림'),
  can('콜라'),
  can('사이다'),
  can('토닉워터'),
  can('진저에일'),
  can('탄산수'),
  can('레드불'),
];

const ml = (ingredient: string, amount: number) => ({ ingredient, amount, unit: 'ml' as const });
const ea = (ingredient: string, amount = 1) => ({ ingredient, amount, unit: 'ea' as const });

export const CLASSIC_RECIPES: (SeedRecipe & { aliases?: string[] })[] = [
  // 위스키 칵테일
  { menu: '맨해튼', aliases: ['맨하탄'], lines: [ml('짐빔 라이', 50), ml('마티니 로쏘', 20)] },
  { menu: '잭콕', lines: [ml('잭다니엘', 30), ea('콜라')] },
  // 보드카
  { menu: '스크류 드라이버', aliases: ['스크류드라이버'], lines: [ml('티토스', 45), ml('오렌지 주스', 90)] },
  { menu: '섹스 온 더 비치', aliases: ['섹스온더비치'], lines: [ml('티토스', 40), ml('피치트리', 20), ml('크랜베리 주스', 40), ml('오렌지 주스', 40)] },
  { menu: '에스프레소 마티니', lines: [ml('티토스', 50), ml('깔루아', 30)] },
  { menu: '모스코 뮬', aliases: ['모스크바 뮬', '모스코뮬'], lines: [ml('티토스', 45), ml('라임', 15), ea('진저에일')] },
  // 진
  { menu: '진 하이볼', lines: [ml('고든스 진', 45), ea('탄산수')] },
  // 럼
  { menu: '피냐 콜라다', aliases: ['피나콜라다', '피냐콜라다'], lines: [ml('바카디 화이트 럼', 50), ml('파인애플 주스', 50), ml('코코넛 크림', 30)] },
  { menu: '블루 하와이', aliases: ['블루 하와이안'], lines: [ml('바카디 화이트 럼', 30), ml('블루 큐라소', 15), ml('파인애플 주스', 60), ml('사워 믹서', 30)] },
  { menu: '말리부 파인', aliases: ['말리부 파인애플'], lines: [ml('말리부', 45), ml('파인애플 주스', 120)] },
  // 데킬라
  { menu: '데킬라 샷', lines: [ml('호세쿠엘보 실버', 30)] },
  // 리큐르
  { menu: '아페롤 스프리츠', lines: [ml('아페롤', 60), ea('탄산수')] },
  { menu: '예거밤', lines: [ml('예거마이스터', 30), ea('레드불')] },
  // 논알콜
  { menu: '라임에이드', lines: [ml('라임', 30), ml('설탕 시럽', 20), ea('탄산수')] },
  { menu: '자몽에이드', lines: [ml('자몽 주스', 90), ml('설탕 시럽', 10), ea('탄산수')] },
  { menu: '오렌지 주스', lines: [ml('오렌지 주스', 200)] },
  { menu: '크랜베리 주스', lines: [ml('크랜베리 주스', 200)] },
  { menu: '콜라', aliases: ['코카콜라', '코크'], lines: [ea('콜라')] },
  { menu: '사이다', aliases: ['칠성사이다', '스프라이트'], lines: [ea('사이다')] },
  { menu: '토닉워터', lines: [ea('토닉워터')] },
  { menu: '진저에일', lines: [ea('진저에일')] },
  { menu: '탄산수', aliases: ['페리에', '트레비'], lines: [ea('탄산수')] },
];
