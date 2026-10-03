/**
 * Base Zod schemas - primitives and common patterns
 * 
 * @module lib/schemas/_base
 */

import { z } from "zod";

// ==========================================
// Primitives
// ==========================================

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export const emailSchema = z.string().email();
export const phoneSchema = z.string().min(5).max(20);

// ==========================================
// Nullable to Optional Transform
// ==========================================

/** Transform null to undefined for frontend consistency */
export function nullableToOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().transform((val) => val ?? undefined);
}

/** String that transforms null to undefined */
export const optionalString = nullableToOptional(z.string());

/** Number that transforms null to undefined */
export const optionalNumber = nullableToOptional(z.number());

/** Boolean that transforms null to undefined */
export const optionalBoolean = nullableToOptional(z.boolean());

/** UUID that transforms null to undefined */
export const optionalUuid = nullableToOptional(uuidSchema);

/** Date string that transforms null to undefined */
export const optionalDate = nullableToOptional(isoDateSchema);

/** String array that transforms null to undefined */
export const optionalStringArray = nullableToOptional(z.array(z.string()));

// ==========================================
// Common Object Schemas
// ==========================================

export const addressSchema = z.object({
  street: optionalString,
  city: optionalString,
  postalCode: optionalString,
  country: optionalString,
  state: optionalString,
});

export const contactInfoSchema = z.object({
  email: optionalString,
  phone: optionalString,
  website: optionalString,
});

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
});

export const dateRangeSchema = z.object({
  from: optionalDate,
  to: optionalDate,
});

// ==========================================
// Base Entity Schema
// ==========================================

export const baseEntitySchema = z.object({
  id: uuidSchema,
  created_at: isoDateSchema,
  updated_at: optionalDate,
});

export const userOwnedEntitySchema = baseEntitySchema.extend({
  user_id: uuidSchema,
});
