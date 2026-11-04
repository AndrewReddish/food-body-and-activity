import type { z } from 'zod';
import type {
  CookTypeSchema, DayLogSchema, DishPartSchema, DishSchema, FoodLogSchema, MeasureSchema, MethodSchema, PlanGroupSchema, PlanItemSchema, PlanSchema,
} from './schema';

export type DateKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM
export type WeekKey = string; // YYYY-Www

export type Method = z.infer<typeof MethodSchema>;
export type CookType = z.infer<typeof CookTypeSchema>;
export type PlanGroup = z.infer<typeof PlanGroupSchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type FoodLog = z.infer<typeof FoodLogSchema>;
export type DayLog = z.infer<typeof DayLogSchema>;
export type Measure = z.infer<typeof MeasureSchema>;
export type MeasureField = 'weight' | 'waist' | 'hips' | 'chest' | 'arm' | 'thigh';
export type Dish = z.infer<typeof DishSchema>;
export type DishPart = z.infer<typeof DishPartSchema>;
export type DishKind = Dish['kind'];
