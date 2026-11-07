import type { Plan, PlanGroup, PlanItem, CookType } from './types';
import { SCHEMA_VERSION } from './schema';

/** Stamped at the epoch so a fresh install never overwrites the plan in the data repo. */
const EPOCH = '1970-01-01T00:00:00.000Z';

/** Palettes from tokens.css, one per group (close to the old app's letter colours). */
const G = (id: string, letter: string, labelUk: string, labelEn: string, kcal: number, palette: string, order: number): PlanGroup =>
  ({ id, letter, labelUk, labelEn, kcal, palette, order });

export const DEFAULT_GROUPS: PlanGroup[] = [
  G('a', 'а', 'Крупи, хліб, картопля', 'Grains, bread, potato', 270, 'leisure', 0),
  G('b', 'б', 'М’ясо, риба, яйця', 'Meat, fish, eggs', 520, 'relationships', 1),
  G('v', 'в', 'Овочі та гриби', 'Vegetables & mushrooms', 120, 'nature', 2),
  G('g', 'г', 'Жири та соуси', 'Fats & sauces', 180, 'money', 3),
  G('d', 'д', 'Молочне', 'Dairy', 260, 'sleep', 4),
  G('e', 'е', 'Фрукти та ягоди', 'Fruit & berries', 250, 'mood', 5),
  G('ye', 'є', 'Горіхи та насіння', 'Nuts & seeds', 120, 'work', 6),
  G('zh', 'ж', 'Вільний вибір', 'Free choice', 475, 'home', 7),
];

let order = 0;
/** max in raw grams (or pieces); protein per 100 g raw from a reference table → protein at max. */
const I = (group: string, id: string, nameUk: string, nameEn: string, max: number, cook: CookType, protein100: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, group, nameUk, nameEn, max, unit: 'g', cook,
  protein: Math.round((protein100 * max) / 10) / 10,
  order: order++, active: true, ...extra,
});

/** The coach's ration (~2210 kcal; Б 165 / Ж 62 / В 205). Weights are RAW. */
export const DEFAULT_ITEMS: PlanItem[] = [
  I('a', 'legumes', 'Бобові', 'Legumes', 84, 'legumes', 22),
  I('a', 'potato', 'Картопля', 'Potato', 350, 'potato', 2),
  I('a', 'corn', 'Кукурудза свіжа', 'Fresh corn', 312, 'none', 3.3),
  I('a', 'rice', 'Рис нешліфований', 'Brown rice', 80, 'rice', 7.5),
  I('a', 'grain', 'Будь-яка крупа', 'Any grain', 80, 'grain', 11),
  I('a', 'flour', 'Цільнозернове борошно', 'Wholegrain flour', 84, 'none', 13),
  I('a', 'crispbread', 'Хлібці', 'Crispbread', 84, 'none', 11),
  I('a', 'bread', 'Цільнозерновий хліб', 'Wholegrain bread', 110, 'none', 8.5),
  I('a', 'pasta', 'Макарони т.с.', 'Durum pasta', 80, 'pasta', 12),
  I('a', 'lavash', 'Лаваш', 'Lavash', 114, 'none', 8),

  I('b', 'veal', 'Телятина', 'Veal', 304, 'meat', 20),
  I('b', 'liver', 'Печінка', 'Liver', 398, 'offal', 18),
  I('b', 'fillet', 'Куряче або індиче філе', 'Chicken or turkey fillet', 475, 'poultry', 23),
  I('b', 'fish-lean', 'Риба до 5% жиру', 'Fish up to 5% fat', 475, 'fish', 18),
  I('b', 'fish-fat', 'Риба від 5% жиру', 'Fish over 5% fat', 304, 'fish', 19),
  { ...I('b', 'eggs', 'Яйця (цілі)', 'Eggs (whole)', 7, 'eggs', 0), unit: 'pcs', protein: 43.8 },
  I('b', 'seafood', 'Морепродукти', 'Seafood', 520, 'seafood', 18),

  I('v', 'veg', 'Овочі (квашені також і зелень)', 'Vegetables (pickled & greens too)', 600, 'vegetables', 1.5),
  I('v', 'mushrooms', 'Гриби', 'Mushrooms', 600, 'mushrooms', 3.5),

  I('g', 'oil', 'Будь-яка олія', 'Any oil', 20, 'none', 0, { note: 'рекомендуємо лляну' }),
  I('g', 'mayo', 'Майонез', 'Mayonnaise', 30, 'none', 1.1),
  I('g', 'avocado', 'Авокадо', 'Avocado', 110, 'none', 2),
  I('g', 'olives', 'Оливки', 'Olives', 155, 'none', 1),
  I('g', 'mustard', 'Гірчиця', 'Mustard', 135, 'none', 5),
  I('g', 'ketchup', 'Кетчуп', 'Ketchup', 90, 'none', 1),

  I('d', 'cottage', 'Сир кисломолочний нежирний (0,2%)', 'Cottage cheese 0.2%', 325, 'none', 18),
  I('d', 'cheese', 'Сири м’які, тверді, плавлені', 'Cheese, any', 75, 'none', 20),
  I('d', 'sourcream', 'Сметана 15%', 'Sour cream 15%', 175, 'none', 2.6),
  I('d', 'kefir', 'Кефір 1%', 'Kefir 1%', 630, 'none', 3.1),
  I('d', 'yogurt', 'Несолодкий йогурт 1%', 'Plain yogurt 1%', 555, 'none', 4.1),
  I('d', 'milk', 'Молоко 1%', 'Milk 1%', 635, 'none', 3.5),

  I('e', 'fruit', 'Фрукти та ягоди', 'Fruit & berries', 500, 'none', 1),
  I('e', 'sweet-fruit', 'Банани, виноград, хурма', 'Bananas, grapes, persimmon', 265, 'none', 1.1),

  I('ye', 'nuts', 'Будь-які горіхи', 'Any nuts', 20, 'none', 15, { note: 'рекомендуємо грецькі' }),
  I('ye', 'seeds', 'Насіння', 'Seeds', 20, 'none', 20),

  I('zh', 'anything', 'Будь-що (солодощі, снеки, ковбаса)', 'Anything (sweets, snacks, sausage)', 95, 'none', 5),
  I('zh', 'zh-fruit', 'Фрукти', 'Fruit', 950, 'none', 1),
  I('zh', 'zh-banana', 'Банани', 'Bananas', 500, 'none', 1.1),
];

export function defaultPlan(): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    kcalTarget: 2210,
    planKcal: 2210,
    macros: { protein: 165, fat: 62, carbs: 205 },
    stepsGoal: 7000,
    groups: DEFAULT_GROUPS.map((g) => ({ ...g })),
    items: DEFAULT_ITEMS.map((i) => ({ ...i })),
    updatedAt: EPOCH,
  };
}

/** Group palette → CSS vars for the letter chip, rings and cards. */
export const PALETTES = ['leisure', 'relationships', 'nature', 'money', 'sleep', 'mood', 'work', 'home', 'growth', 'body'];
