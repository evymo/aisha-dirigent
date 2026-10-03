/**
 * Null handling utilities for Supabase data
 * 
 * Supabase generates types with `| null` for nullable columns.
 * These utilities help work with null values consistently.
 * 
 * sensitive dataLOSOPHY: We keep `| null` from Supabase as-is instead of converting to undefined.
 * This is cleaner and avoids unnecessary transformations.
 * 
 * @module lib/types/nullToUndefined
 */

/**
 * Type guard to check if a value is defined (not null or undefined).
 * Useful for filtering arrays and conditional rendering.
 * 
 * @example
 * const values = [1, null, 2, undefined, 3];
 * const defined = values.filter(isDefined); // [1, 2, 3]
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard to check if a value is null or undefined.
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Provides a default value for null/undefined.
 * Type-safe alternative to `??` operator with explicit typing.
 * 
 * @example
 * const name = withDefault(user.name, "Anonymous");
 */
export function withDefault<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

/**
 * Converts undefined to null (for Supabase writes).
 * Supabase expects null for "no value", not undefined.
 * 
 * @example
 * const data = { name: "John", email: undefinedToNull(formValues.email) };
 */
export function undefinedToNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Converts all undefined values in an object to null.
 * Useful for preparing data for Supabase inserts/updates.
 */
export function undefinedToNullDeep<T extends Record<string, unknown>>(
  obj: T
): { [K in keyof T]: T[K] extends undefined ? null : T[K] } {
  const result = {} as Record<string, unknown>;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key] === undefined ? null : obj[key];
    }
  }
  return result as { [K in keyof T]: T[K] extends undefined ? null : T[K] };
}

/**
 * Safe array filter that removes null/undefined values.
 * Returns typed array without nulls.
 * 
 * @example
 * const names: (string | null)[] = ["John", null, "Jane"];
 * const valid = filterNullish(names); // string[]
 */
export function filterNullish<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter(isDefined);
}

/**
 * Maps over array, applying transform and filtering out null results.
 * 
 * @example
 * const users = [{ name: "John" }, { name: null }];
 * const names = compactMap(users, u => u.name); // ["John"]
 */
export function compactMap<T, U>(
  arr: T[],
  transform: (item: T) => U | null | undefined
): U[] {
  return arr.map(transform).filter(isDefined);
}

/**
 * Safely access nested nullable properties.
 * 
 * @example
 * const city = safeGet(user, u => u.address?.city, "Unknown");
 */
export function safeGet<T, U>(
  value: T | null | undefined,
  accessor: (val: T) => U | null | undefined,
  defaultValue: U
): U {
  if (value === null || value === undefined) return defaultValue;
  const result = accessor(value);
  return result ?? defaultValue;
}
