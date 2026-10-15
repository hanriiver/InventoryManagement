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
  [/쉬/g, '시'],
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

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** 정규화된 두 이름의 유사도 (0~1). "피치크러시" vs "피치크러쉬" = 0.8 */
export function similarity(a: string, b: string): number {
  const x = normalizeMenuName(a);
  const y = normalizeMenuName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** 이 정도 이상 비슷하면 같은 메뉴로 봄 (한두 글자 차이) */
export const SIMILAR_THRESHOLD = 0.75;

export interface NameMatch<T> {
  item: T;
  /** 1이면 같은 이름(띄어쓰기·표기 차이만), 1 미만이면 비슷한 이름 */
  score: number;
}

/**
 * 후보 중에서 이름이 같거나 가장 비슷한 것을 찾음.
 * 비슷한 후보가 둘 이상 같은 점수면 애매하므로 연결하지 않음.
 */
export function findByName<T extends { name: string }>(candidates: T[], name: string, aliases: string[] = []): NameMatch<T> | null {
  const keys = [name, ...aliases];
  const keySet = new Set(keys.flatMap((k) => nameKeys(k)));
  const exact = candidates.find((c) => keySet.has(normalizeMenuName(c.name)));
  if (exact) return { item: exact, score: 1 };
  let best: NameMatch<T> | null = null;
  let tie = false;
  for (const c of candidates) {
    const score = Math.max(...keys.map((k) => similarity(k, c.name)));
    if (score < SIMILAR_THRESHOLD) continue;
    if (!best || score > best.score) {
      best = { item: c, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

/** 못 찾았을 때 안내용: 가장 비슷한 이름 (기준 이하라도) */
export function closestName<T extends { name: string }>(candidates: T[], name: string): string | null {
  let best: { name: string; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(name, c.name);
    if (!best || score > best.score) best = { name: c.name, score };
  }
  return best && best.score >= 0.4 ? best.name : null;
}
