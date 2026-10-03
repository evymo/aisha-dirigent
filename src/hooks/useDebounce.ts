/**
 * Debounce hook — delays updating the output value until `delay` ms
 * after the last change of the input value.
 *
 * @param value - The raw (fast-changing) value.
 * @param delay - Debounce delay in milliseconds (default 300).
 * @returns The debounced value.
 *
 * @example
 * const debouncedQuery = useDebounce(searchQuery, 300);
 */
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
