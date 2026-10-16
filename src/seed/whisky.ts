/**
 * 위스키 메뉴 자동 인식. 위스키 한 잔 = 30ml (더블 60ml, 보틀 1병).
 * 메뉴 이름에서 "샷/잔/하이볼/(…)" 같은 꾸밈을 떼어 낸 제품명으로 재료(700ml)를 만듭니다.
 */
export const WHISKY_BRANDS = [
  // 스카치 싱글몰트
  '발베니', '맥캘란', '글렌피딕', '글렌리벳', '글렌모렌지', '글렌드로낙', '글렌알라키', '글렌그란트', '글렌고인', '글렌킨치',
  '라프로익', '아드벡', '라가불린', '보모어', '쿨일라', '탈리스커', '하이랜드파크', '스프링뱅크', '오반', '달위니', '벤리악',
  '아벨라워', '달모어', '토마틴', '부나하벤', '브룩라디', '옥토모어', '포트샬롯', '킬호만', '아란', '딘스톤', '토버모리',
  '크라겐모어', '카듀', '싱글톤', '오켄토션', '로크로몬드', '벤로막', '글렌파클라스', '글렌스코샤', '스캐파',
  // 블렌디드 스카치
  '조니워커', '발렌타인', '시바스', '로얄살루트', '듀어스', '몽키숄더', '페이머스그라우스', '커티삭', '제이앤비', '올드파', '블랙앤화이트', '윈저', '임페리얼',
  // 아메리칸
  '잭다니엘', '잭콕', '짐빔', '메이커스마크', '와일드터키', '버팔로트레이스', '우드포드', '불렛', '노브크릭', '에반윌리엄스',
  '포로지스', '러셀', '이글레어', '블랜튼', '부커스', '베이커스', '엘리자크레이그', '헤븐힐', '올드포레스터', '젠틀맨잭', '조지디켈',
  // 아이리시·기타
  '제임슨', '부쉬밀', '털러모어', '레드브레스트', '틸링', '크라운로얄', '캐나디안클럽',
  // 재패니즈·대만
  '히비키', '야마자키', '하쿠슈', '가쿠빈', '산토리', '니카', '요이치', '미야기쿄', '치타', '토키', '카발란',
];

const WHISKY_CATEGORY = /위스키|whisk|싱글몰트|몰트|버번|스카치|블렌디드|아이리시|재패니즈/i;
const COCKTAIL_WORDS = /사워|올드\s*패션|맨해튼|맨하탄|러스티|갓파더|카밤|보일러|아이리시\s*커피|칵테일/;

export interface WhiskyMatch {
  /** 재료 이름 (꾸밈 제거한 제품명) */
  product: string;
  amount: number;
  /** 'bottle' 이면 amount는 병 수 */
  unit: 'ml' | 'bottle';
  note?: string;
}

const STRIP = /\([^)]*\)|\[[^\]]*\]|\d+\s*ml|샷|글라스|한\s*잔|1\s*잔|잔|싱글|더블|하이볼|온더락|온 더 락|니트|스트레이트|보틀|bottle|병/gi;

export function cleanProductName(menu: string): string {
  return menu.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
}

export function detectWhisky(menuName: string, category?: string | null): WhiskyMatch | null {
  const compact = menuName.replace(/\s+/g, '');
  const brand = WHISKY_BRANDS.find((b) => compact.includes(b));
  if (!brand && !(category && WHISKY_CATEGORY.test(category))) return null;
  if (COCKTAIL_WORDS.test(menuName)) return null; // 위스키 칵테일은 칵테일 레시피로

  let product = cleanProductName(menuName) || menuName;
  if (brand === '잭콕') product = '잭다니엘';
  if (/보틀|bottle|병/i.test(menuName)) return { product, amount: 1, unit: 'bottle', note: '보틀 판매 → 1병 차감' };
  if (/더블/.test(menuName)) return { product, amount: 60, unit: 'ml', note: '더블 → 60ml' };
  if (/하이볼|콕/.test(menuName)) return { product, amount: 30, unit: 'ml', note: '하이볼 — 위스키 30ml만 차감' };
  return { product, amount: 30, unit: 'ml' };
}
