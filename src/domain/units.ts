import type { Ingredient } from '../types';

type ConvertTarget = Pick<Ingredient, 'name' | 'unit' | 'yield_ml'>;

/** 레시피 수량을 재료의 base unit으로 환산. 레몬(ea, yield 40) 30ml → 0.75개 */
export function toBaseUnit(amount: number, recipeUnit: string, ingredient: ConvertTarget): number {
  if (recipeUnit === ingredient.unit) return amount;
  if (recipeUnit === 'ml' && ingredient.unit === 'ea' && ingredient.yield_ml) {
    return amount / ingredient.yield_ml;
  }
  throw new Error(`'${ingredient.name}'은(는) ${ingredient.unit} 단위라 ${recipeUnit}로 입력할 수 없습니다`);
}

/** base unit 재고 → 병/개 단위 */
export function toContainers(stock: number, ingredient: Pick<Ingredient, 'container_size'>): number {
  return stock / (ingredient.container_size || 1);
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * 사람이 읽는 재고 표기. 700ml 병 1750ml → "2병 + 350ml".
 * 음수(재고 입력 전 판매 등)는 그대로 "-45ml"로 표시되며, 화면에서는 '재고 없음'으로 따로 안내합니다.
 */
export function formatStock(
  stock: number,
  ingredient: Pick<Ingredient, 'unit' | 'container_size' | 'container_label'>,
): string {
  if (ingredient.unit !== 'ml' || ingredient.container_size <= 1) {
    return `${round(stock)}${ingredient.unit === 'ml' ? 'ml' : ingredient.container_label}`;
  }
  const sign = stock < 0 ? '-' : '';
  const abs = Math.abs(stock);
  const full = Math.floor(abs / ingredient.container_size + 1e-9);
  const rest = round(abs - full * ingredient.container_size, 0);
  if (full === 0) return `${sign}${rest}ml`;
  return `${sign}${full}${ingredient.container_label}${rest > 0 ? ` + ${rest}ml` : ''}`;
}

/**
 * 봇/웹에서 입력한 수량을 base unit으로. "2" → 2병(=1400ml), "350ml" → 350ml.
 * ea/g 재료는 숫자 그대로.
 */
export function parseQuantity(input: string, ingredient: Pick<Ingredient, 'unit' | 'container_size'>): number {
  // "1병+300ml", "1병 300ml"
  const mixed = input.trim().match(/^(\d+(?:\.\d+)?)\s*병\s*\+?\s*(\d+(?:\.\d+)?)\s*ml$/i);
  if (mixed) return Number(mixed[1]) * ingredient.container_size + Number(mixed[2]);
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*(ml|g|개|병)?$/i);
  if (!m) throw new Error(`수량 형식이 올바르지 않습니다: ${input}`);
  const n = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'ml' || suffix === 'g') return n;
  return n * (ingredient.unit === 'ml' ? ingredient.container_size : 1);
}

/** 변동량 표기. -45 → "-45ml", +1400 → "+2병", -0.75(레몬) → "-0.75개" */
export function formatDelta(
  delta: number,
  ingredient: Pick<Ingredient, 'unit' | 'container_size' | 'container_label'>,
): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return sign + formatStock(Math.abs(delta), ingredient);
}

/** 병 기준 소수 표기용 (1355ml/700 → 1.94) */
export function containersRounded(stock: number, ingredient: Pick<Ingredient, 'container_size'>): number {
  return round(toContainers(stock, ingredient), 2);
}
