import { describe, expect, it } from 'vitest';
import { cleanProductName, detectWhisky } from '../src/seed/whisky';
import { normalizeMenuName, nameKeys } from '../src/seed/matching';
import { CLASSIC_INGREDIENTS, CLASSIC_RECIPES } from '../src/seed/classics';
import { HOUSE_INGREDIENTS } from '../src/seed/house-recipes';
import { findSimilarLiquor } from '../src/services/seed';
import type { Ingredient } from '../src/types';

describe('위스키 인식', () => {
  it('브랜드로 인식, 30ml / 더블 60ml / 보틀 1병', () => {
    expect(detectWhisky('발베니 12년')).toEqual({ product: '발베니 12년', amount: 30, unit: 'ml' });
    expect(detectWhisky('발베니 12년 (글라스)')?.product).toBe('발베니 12년');
    expect(detectWhisky('맥캘란 12 더블')).toMatchObject({ product: '맥캘란 12', amount: 60 });
    expect(detectWhisky('글렌피딕 15 보틀')).toMatchObject({ product: '글렌피딕 15', amount: 1, unit: 'bottle' });
    expect(detectWhisky('짐빔 하이볼')).toMatchObject({ product: '짐빔', amount: 30 });
    expect(detectWhisky('잭콕')).toMatchObject({ product: '잭다니엘', amount: 30 });
  });
  it('카테고리가 위스키면 브랜드 몰라도 인식', () => {
    expect(detectWhisky('스모키 몰트 A', '싱글몰트 위스키')).toMatchObject({ product: '스모키 몰트 A', amount: 30 });
  });
  it('위스키 칵테일·일반 메뉴는 제외', () => {
    expect(detectWhisky('아이리시 카밤')).toBeNull();
    expect(detectWhisky('보일러메이커 짐빔')).toBeNull();
    expect(detectWhisky('진토닉')).toBeNull();
    expect(detectWhisky('감자튀김', '안주')).toBeNull();
  });
  it('제품명 정리', () => {
    expect(cleanProductName('라프로익 10년 샷 (30ml)')).toBe('라프로익 10년');
  });
});

describe('이름 매칭', () => {
  it('표기 차이·괄호·띄어쓰기 무시', () => {
    expect(normalizeMenuName('테킬라 선라이즈')).toBe(normalizeMenuName('데킬라선라이즈'));
    expect(normalizeMenuName('모히토 (시그니처)')).toBe(normalizeMenuName('모히또'));
    expect(normalizeMenuName('핸드릭스 진토닉')).toBe(normalizeMenuName('헨드릭스 진토닉'));
    expect(nameKeys('헨드릭스 진토닉')).toContain(normalizeMenuName('헨드릭스 토닉'));
  });
  it('비슷한 술 재사용', () => {
    const mk = (id: number, name: string) => ({ id, name, unit: 'ml' }) as Ingredient;
    const list = [mk(1, '짐빔 화이트'), mk(2, '짐빔 라이'), mk(3, '제임슨')];
    expect(findSimilarLiquor(list, '짐빔')?.name).toBe('짐빔 화이트');
    expect(findSimilarLiquor(list, '제임슨 스탠다드')?.name).toBe('제임슨');
    expect(findSimilarLiquor(list, '발베니 12년')).toBeNull();
  });
});

describe('표준 레시피 데이터', () => {
  it('모든 재료가 정의되어 있음', () => {
    const names = new Set([...HOUSE_INGREDIENTS, ...CLASSIC_INGREDIENTS].map((i) => i.name));
    for (const r of CLASSIC_RECIPES) for (const l of r.lines) expect(names.has(l.ingredient), `${r.menu}: ${l.ingredient}`).toBe(true);
  });
});

describe('맥주 메뉴', async () => {
  const { beerRecipe } = await import('../src/seed/house-recipes');
  it('보일러메이커는 맥주 종류에 맞는 짐빔 + 맥주 1개', () => {
    expect(beerRecipe('보일러메이커 IPA')).toEqual([{ ingredient: '짐빔 라이', amount: 30, unit: 'ml' }, { ingredient: 'IPA', amount: 1, unit: 'ea' }]);
    expect(beerRecipe('보일러메이커 (라거)')).toEqual([{ ingredient: '짐빔 화이트', amount: 30, unit: 'ml' }, { ingredient: '라거', amount: 1, unit: 'ea' }]);
    expect(beerRecipe('보일러메이커')).toBeNull();
  });
  it('맥주 단품은 1개', () => {
    expect(beerRecipe('IPA')).toEqual([{ ingredient: 'IPA', amount: 1, unit: 'ea' }]);
    expect(beerRecipe('앰버 라거')).toEqual([{ ingredient: '라거', amount: 1, unit: 'ea' }]);
    expect(beerRecipe('기네스 드래프트')).toEqual([{ ingredient: '기네스', amount: 1, unit: 'ea' }]);
    expect(beerRecipe('아이리시 카밤 (기네스)')).toBeNull();
    expect(beerRecipe('진토닉')).toBeNull();
  });
});
