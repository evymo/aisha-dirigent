/**
 * Type-safe JSON casting utilities for Supabase database operations.
 * 
 * The Json type from Supabase is intentionally loose to accommodate
 * any valid JSON structure. These utilities provide a clean way to
 * convert typed objects to Json for database writes.
 */

import type { Json } from "@/integrations/db/types";

/**
 * Safely casts a value to the Supabase Json type for database writes.
 * 
 * This is preferred over `as unknown as Json` because:
 * 1. It's more readable and self-documenting
 * 2. It centralizes the casting pattern
 * 3. It ensures the value is JSON-serializable at runtime
 * 
 * @param value - Any JSON-serializable value
 * @returns The value typed as Json
 * 
 * @example
 * // Instead of:
 * workflow_data: { nodes: [], edges: [] } as unknown as Json,
 * 
 * // Use:
 * workflow_data: toJson({ nodes: [], edges: [] }),
 */
export function toJson<T>(value: T): Json {
  // Runtime check: ensure the value is JSON-serializable
  // This will throw if the value contains non-serializable data (functions, symbols, etc.)
  try {
    JSON.stringify(value);
  } catch {
    throw new Error("Value is not JSON-serializable");
  }
  
  return value as unknown as Json;
}

/**
 * Safely casts a value to Json, returning null for undefined values.
 * Useful for optional JSON fields in database operations.
 * 
 * @param value - Any JSON-serializable value or undefined
 * @returns The value typed as Json, or null if undefined
 */
export function toJsonOrNull<T>(value: T | undefined | null): Json | null {
  if (value === undefined || value === null) {
    return null;
  }
  return toJson(value);
}
