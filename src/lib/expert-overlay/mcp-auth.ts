/**
 * MCP Auth Scopes — Token management utilities
 *
 * Client-side helpers for MCP token validation and hashing.
 * The raw token is hashed before being sent to the server;
 * the server only stores and validates hashes.
 *
 * @module lib/expert-overlay/mcp-auth
 */

/**
 * Hash a raw MCP token to produce the token_hash expected by the server.
 * Uses SHA-256, matching the PostgreSQL `encode(digest(token, 'sha256'), 'hex')`.
 *
 * @param rawToken - The raw token string (e.g. "mcp_a1b2c3...")
 * @returns Hex-encoded SHA-256 hash
 *
 * @example
 * ```typescript
 * const hash = await hashMcpToken("mcp_abc123...");
 * const result = await supabase.rpc("validate_mcp_token", {
 *   p_token_hash: hash,
 *   p_tool_name: "search_knowledge_v2",
 * });
 * ```
 */
export async function hashMcpToken(rawToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * MCP token prefix used for token generation.
 * All platform-generated MCP tokens start with this prefix.
 */
export const MCP_TOKEN_PREFIX = "mcp_" as const;

/**
 * Validate the format of a raw MCP token (client-side, before RPC).
 *
 * @param token - The token string to validate
 * @returns true if the token has valid format
 */
export function isValidMcpTokenFormat(token: string): boolean {
  // Format: "mcp_" + 64 hex characters (32 random bytes)
  return /^mcp_[a-f0-9]{64}$/.test(token);
}

/**
 * Extract scope information from a token validation result.
 * Useful for determining what resources the current token can access.
 *
 * @param validationResult - Result from validate_mcp_token() RPC
 * @returns Parsed scope info or null if invalid
 */
export function parseMcpTokenScope(
  validationResult: Record<string, unknown>,
): {
  scope: "global" | "account" | "project";
  accountId?: string;
  projectId?: string;
  rateLimitRpm: number;
  rateLimitDaily: number;
} | null {
  if (!validationResult.valid) return null;

  return {
    scope: validationResult.scope as "global" | "account" | "project",
    accountId: validationResult.account_id as string | undefined,
    projectId: validationResult.project_id as string | undefined,
    rateLimitRpm: (validationResult.rate_limit_rpm as number) ?? 60,
    rateLimitDaily: (validationResult.rate_limit_daily as number) ?? 1000,
  };
}
