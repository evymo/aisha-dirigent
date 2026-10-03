/**
 * Expert Overlay Layer — Utilities
 *
 * Central barrel export for Expert Overlay runtime utilities:
 * - Ruleset fingerprint computation & verification
 * - MCP token hashing & validation helpers
 *
 * @module lib/expert-overlay
 */

export {
  computeRulesetFingerprint,
  verifyRulesetFingerprint,
  type FingerprintRuleInput,
} from "./fingerprint";

export {
  hashMcpToken,
  isValidMcpTokenFormat,
  parseMcpTokenScope,
  MCP_TOKEN_PREFIX,
} from "./mcp-auth";
