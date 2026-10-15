/**
 * 메뉴 이름 비교용 정규화. 표기 차이(테킬라/데킬라, 모히토/모히또 등), 괄호, 띄어쓰기,
 * "칵테일" 같은 꾸밈말을 없애서 비슷한 이름끼리 같은 메뉴로 봅니다.
 */
const SPELLING: [RegExp, string][] = [
  [/테킬라/g, '데킬라'],
  [/아이리쉬/g, '아이리시'],
  [/핸드릭스|헨드릭/g, '헨드릭스'],
  [/헨드릭스스/g, '헨드릭스'],
  [/모히토/g, '모히또'],
  [/재패니즈|재패니스|제패니스/g, '제패니즈'],
  [/레모네이드/g, '레몬에이드'],
  [/다이퀴리|다이커리/g, '다이키리'],
  [/마르가리타/g, '마가리타'],
  [/리브르/g, '리브레'],
  [/러시앤|러시안/g, '러시안'],
  [/코스모폴리탄|코스모 폴리탄/g, '코스모폴리탄'],
  [/맥켈란/g, '맥캘란'],
  [/글렌피딕|글랜피딕/g, '글렌피딕'],
];

const DECORATION = /칵테일|클래식|오리지널|시그니처|cocktail/gi;

export function normalizeMenuName(name: string): string {
  let s = name.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '');
  for (const [re, to] of SPELLING) s = s.replace(re, to);
  return s.replace(DECORATION, '').replace(/[\s·.\-_/]+/g, '');
}

/** 이름 별칭: 레시피 이름 → 토스에서 쓰일 수 있는 다른 이름 */
export const MENU_ALIASES: Record<string, string[]> = {
  '헨드릭스 진토닉': ['헨드릭스 토닉', '헨드릭스'],
  '코스모폴리탄': ['코스모'],
  '쿠바 리브레': ['럼콕'],
  '진토닉': ['진 토닉'],
};

export function nameKeys(name: string): string[] {
  return [name, ...(MENU_ALIASES[name] ?? [])].map(normalizeMenuName);
}
