import { z } from 'zod';

/**
 * Data contract v1 for Tonus.
 * Missing fields mean "not logged", never zero.
 * Every read and write of IndexedDB and the data repo goes through these schemas.
 */
export const SCHEMA_VERSION = 1 as const;

const DateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
const Id = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** How a food was weighed. Plan grams are always for raw food. */
export const METHODS = ['raw', 'boiled', 'baked', 'fried'] as const;
export const MethodSchema = z.enum(METHODS);

/** Food type that decides the raw → cooked weight change (see cooking.ts). */
export const COOK_TYPES = [
  'none', 'eggs', 'meat', 'poultry', 'offal', 'fish', 'seafood',
  'rice', 'grain', 'pasta', 'legumes', 'potato', 'vegetables', 'mushrooms',
] as const;
export const CookTypeSchema = z.enum(COOK_TYPES);

export const PlanGroupSchema = z.object({
  id: Id,
  letter: z.string().min(1).max(3),
  labelUk: z.string().min(1).max(60),
  labelEn: z.string().min(1).max(60),
  /** The coach's "~ kcal" for the whole group (100%). */
  kcal: z.number().min(0).max(5000),
  /** Palette id from tokens.css (`--d-<palette>`). */
  palette: z.string().min(1).max(40),
  order: z.number().int(),
  /** Keep this group's amounts when the plan is scaled to another calorie goal (default: vegetables, nuts). */
  fixed: z.boolean().optional(),
});

export const PlanItemSchema = z.object({
  id: Id,
  group: Id,
  nameUk: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
  /** 100% of the group, in raw weight (g) or pieces. */
  max: z.number().positive().max(10000),
  unit: z.enum(['g', 'pcs']),
  cook: CookTypeSchema,
  /** Protein at `max`, grams (estimate from a raw-food reference table). */
  protein: z.number().min(0).max(1000),
  order: z.number().int(),
  active: z.boolean(),
  note: z.string().max(120).optional(),
});

export const DISH_KINDS = ['breakfast', 'main', 'salad', 'dessert', 'snack'] as const;

/** One ingredient slot of a dish: a group plus the foods that may fill it, in order of preference. */
export const DishPartSchema = z.object({
  group: Id,
  items: z.array(Id).min(1).max(20),
  method: MethodSchema.optional(),
  /** Share of this meal's portion of the group (default 1 = all of it). */
  weight: z.number().min(0.05).max(1).optional(),
});

export const DishSchema = z.object({
  id: Id,
  nameUk: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
  kind: z.enum(DISH_KINDS),
  parts: z.array(DishPartSchema).min(1).max(8),
});

export const BodySchema = z.object({
  sex: z.enum(['f', 'm']).optional(),
  birthYear: z.number().int().min(1900).max(2100).optional(),
  height: z.number().min(80).max(250).optional(),
  weight: z.number().min(20).max(400).optional(),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active']).optional(),
  goal: z.enum(['lose', 'maintain', 'gain']).optional(),
  /** On: kcal, protein, steps and macros are computed; off: they are whatever was typed in. */
  auto: z.boolean().optional(),
  /** The owner's per-person tweak on top of the formula, kcal (e.g. −100 after the dietitian's feedback). */
  kcalAdjust: z.number().int().min(-2000).max(2000).optional(),
  /** Per-person protein, g per kg, instead of the formula's. */
  proteinPerKg: z.number().min(0.5).max(4).optional(),
});

export const PlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kcalTarget: z.number().int().min(0).max(10000),
  /** The calories the group amounts are written for (default 2210). A different kcalTarget scales them (scale.ts). */
  planKcal: z.number().int().min(500).max(10000).optional(),
  macros: z.object({ protein: z.number(), fat: z.number(), carbs: z.number() }).optional(),
  stepsGoal: z.number().int().min(0).max(100000),
  groups: z.array(PlanGroupSchema),
  items: z.array(PlanItemSchema),
  /** The user's own dish ideas (built-in ones live in code). */
  dishes: z.array(DishSchema).max(100).optional(),
  /** Built-in dish ids the user switched off. */
  hiddenDishes: z.array(Id).max(200).optional(),
  /**
   * Body data and weight goal, for automatic targets (targets.ts). Also columns in the `goals` table, so the
   * owner can fill them in for a person. `weight` is used only until the first measured weight.
   */
  body: BodySchema.optional(),
  /** When kcalTarget / macros.protein / stepsGoal last changed (they also live in the `goals` table). */
  goalsUpdatedAt: z.string().optional(),
  updatedAt: z.string(),
});

export const FoodLogSchema = z.object({
  id: z.string().min(1).max(40),
  item: Id,
  group: Id,
  method: MethodSchema,
  /** What the scale showed, in the item's unit, in the chosen state. */
  weighed: z.number().min(0).max(100000),
  /** Raw-equivalent amount — the number the plan counts. */
  raw: z.number().min(0).max(100000),
  /** Share of the group used, 0..n (1 = the whole group). Snapshot, so plan edits don't rewrite history. */
  frac: z.number().min(0).max(100),
  kcal: z.number().min(0),
  protein: z.number().min(0),
  at: z.string(),
});

export const DayLogSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  date: z.string().regex(DateKeyRe),
  food: z.array(FoodLogSchema),
  steps: z.number().int().min(0).max(200000).optional(),
  /** Coffee/tea cups (limit 4, first half of the day). */
  cups: z.number().int().min(0).max(30).optional(),
  /** Zero-calorie soda, ml (limit 330). */
  soda: z.number().int().min(0).max(10000).optional(),
  /** The goals that applied that day (they change: automatic targets, the coach's edits), for history. */
  targets: z.object({ kcal: z.number().min(0), protein: z.number().min(0), steps: z.number().min(0) }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MEASURE_FIELDS = ['weight', 'waist', 'hips', 'chest', 'arm', 'thigh'] as const;
const Cm = z.number().positive().max(400);

export const MeasureSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  date: z.string().regex(DateKeyRe),
  weight: z.number().positive().max(500).optional(),
  waist: Cm.optional(),
  hips: Cm.optional(),
  chest: Cm.optional(),
  arm: Cm.optional(),
  thigh: Cm.optional(),
  /** Photo ids; files live at `photos/<id>.jpg`. */
  photos: z.array(z.string().regex(/^[\w-]{1,60}$/)).max(12).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** `days/YYYY-MM.json` → `{ "YYYY-MM-DD": DayLog }`. */
export const DaysFileSchema = z.record(z.string().regex(DateKeyRe), DayLogSchema);
/** `measures/YYYY.json` → `{ "YYYY-MM-DD": Measure }`. */
export const MeasuresFileSchema = z.record(z.string().regex(DateKeyRe), MeasureSchema);
