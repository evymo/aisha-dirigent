/**
 * Type guard utilities for runtime type checking
 * 
 * These guards provide type-safe runtime validation
 * for data from Supabase RPC responses and JSON fields.
 * 
 * @module lib/types/guards
 */

import type { Json } from "@/integrations/db/types";

// ==========================================
// Primitive Guards
// ==========================================

/**
 * Type guard for string values.
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for non-empty string values.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard for number values (excludes NaN).
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Type guard for finite number values.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Type guard for boolean values.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// ==========================================
// UUID Guards
// ==========================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Type guard for valid UUID v4 strings.
 */
export function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

// ==========================================
// Date Guards
// ==========================================

/**
 * Type guard for Date objects.
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Type guard for ISO date strings (YYYY-MM-DD or full ISO 8601).
 */
export function isISODateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

// ==========================================
// Object Guards
// ==========================================

/**
 * Type guard for non-null objects.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard for arrays.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard for arrays of a specific type.
 */
export function isArrayOf<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(itemGuard);
}

// ==========================================
// JSON Guards (for Supabase Json type)
// ==========================================

/**
 * Type guard for Json type from Supabase.
 * Validates that value matches Supabase's Json type definition.
 */
export function isJson(value: unknown): value is Json {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(
      (v) => v === undefined || isJson(v)
    );
  }
  return false;
}

/**
 * Safely parses a JSON string, returning undefined on failure.
 */
export function safeJsonParse<T = Json>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Safely accesses a property from a Json object.
 * Returns undefined if path doesn't exist or type doesn't match.
 */
export function getJsonProperty<T>(
  json: Json | null | undefined,
  path: string[],
  guard?: (value: unknown) => value is T
): T | undefined {
  if (json === null || json === undefined) return undefined;
  
  let current: unknown = json;
  
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  
  if (guard) {
    return guard(current) ? current : undefined;
  }
  
  return current as T | undefined;
}

// ==========================================
// Enum Guards
// ==========================================

/**
 * Creates a type guard for enum-like string literals.
 * 
 * @example
 * const isStatus = createEnumGuard(['active', 'inactive', 'pending'] as const);
 * if (isStatus(value)) {
 *   // value is 'active' | 'inactive' | 'pending'
 * }
 */
export function createEnumGuard<T extends readonly string[]>(
  values: T
): (value: unknown) => value is T[number] {
  const valueSet = new Set(values);
  return (value: unknown): value is T[number] => {
    return typeof value === 'string' && valueSet.has(value);
  };
}

// ==========================================
// Supabase Response Guards
// ==========================================

/**
 * Type guard for Supabase error responses.
 */
export function isSupabaseError(value: unknown): value is { message: string; code?: string } {
  return (
    isObject(value) &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Type guard for checking if RPC response has expected structure.
 * Use with specific property checks for each RPC.
 */
export function hasRequiredProperties<T extends Record<string, unknown>>(
  value: unknown,
  requiredKeys: (keyof T)[]
): value is T {
  if (!isObject(value)) return false;
  return requiredKeys.every((key) => key in value);
}
