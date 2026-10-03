/**
 * Canonical JSON — deterministic serialization for signing and hashing.
 * Objects get lexicographically sorted keys; arrays keep order. Rejects
 * values that cannot round-trip (undefined, functions, NaN, cycles) —
 * reject, don't coerce.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();

  const encode = (v: unknown): string => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v);
      case 'boolean':
        return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new Error('acs-sdk: non-finite number is not canonicalizable');
        return JSON.stringify(v);
      case 'object': {
        const obj = v as object;
        if (seen.has(obj)) throw new Error('acs-sdk: cyclic structure is not canonicalizable');
        seen.add(obj);
        try {
          if (Array.isArray(obj)) {
            return `[${obj.map(encode).join(',')}]`;
          }
          const entries = Object.entries(obj as Record<string, unknown>)
            .filter(([, val]) => val !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, val]) => `${JSON.stringify(k)}:${encode(val)}`);
          return `{${entries.join(',')}}`;
        } finally {
          seen.delete(obj);
        }
      }
      default:
        throw new Error(`acs-sdk: value of type ${typeof v} is not canonicalizable`);
    }
  };

  return encode(value);
}
