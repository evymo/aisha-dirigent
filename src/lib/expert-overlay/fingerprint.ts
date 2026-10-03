/**
 * Ruleset Fingerprint Utility
 *
 * Deterministic fingerprint algorithm matching the PostgreSQL implementation
 * in `create_story_ruleset()`. Ensures the same set of rules always produces
 * the same fingerprint, regardless of the order they were provided.
 *
 * Algorithm: sha256(sorted(rule_id:version).join('|'))
 *
 * @module lib/expert-overlay/fingerprint
 */

/**
 * Rule input for fingerprint computation.
 * At minimum, you need the rule ID and its version.
 */
export interface FingerprintRuleInput {
  /** UUID of the expert rule */
  id: string;
  /** Version number of the rule snapshot */
  version: number;
}

/**
 * Compute the SHA-256 fingerprint for a set of expert rules.
 *
 * The algorithm:
 * 1. Map each rule to `{id}:{version}` string
 * 2. Sort alphabetically (lexicographic — deterministic)
 * 3. Join with `|`
 * 4. SHA-256 hash the resulting string
 * 5. Return hex-encoded hash
 *
 * This matches the PostgreSQL implementation:
 * ```sql
 * encode(digest(
 *   array_to_string(ARRAY(
 *     SELECT er.id || ':' || er.version
 *     FROM expert_rules er WHERE er.id = ANY(p_rule_ids)
 *     ORDER BY er.id
 *   ), '|'),
 *   'sha256'
 * ), 'hex')
 * ```
 *
 * @param rules - Array of rules with id and version
 * @returns Hex-encoded SHA-256 fingerprint
 *
 * @example
 * ```typescript
 * const fingerprint = await computeRulesetFingerprint([
 *   { id: "abc-123", version: 1 },
 *   { id: "def-456", version: 2 },
 * ]);
 * // fingerprint = "a1b2c3d4e5f6..."
 * ```
 */
export async function computeRulesetFingerprint(
  rules: FingerprintRuleInput[],
): Promise<string> {
  if (rules.length === 0) {
    // Empty ruleset → deterministic empty hash
    return hashString("");
  }

  // Step 1-3: Map, sort, join
  const canonical = rules
    .map((r) => `${r.id}:${r.version}`)
    .sort() // Lexicographic sort for determinism
    .join("|");

  // Step 4-5: SHA-256 → hex
  return hashString(canonical);
}

/**
 * Verify that a fingerprint matches the expected rules.
 * Useful for compliance checks to ensure ruleset hasn't been tampered with.
 *
 * @param expected - Expected fingerprint hash
 * @param rules - Rules to verify against
 * @returns true if fingerprints match
 */
export async function verifyRulesetFingerprint(
  expected: string,
  rules: FingerprintRuleInput[],
): Promise<boolean> {
  const actual = await computeRulesetFingerprint(rules);
  return actual === expected;
}

/**
 * SHA-256 hash of a string, returned as hex.
 * Uses the Web Crypto API (works in browsers, Node.js, and Deno).
 */
async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
