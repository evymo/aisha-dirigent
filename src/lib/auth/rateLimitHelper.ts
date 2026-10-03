/**
 * Helper for parsing Supabase Auth rate limit errors
 * 
 * Supabase returns errors like:
 * - "429: For security purposes, you can only request this after 37 seconds."
 * - Status 429 with error_code: "over_email_send_rate_limit"
 */

export interface RateLimitInfo {
  isRateLimited: boolean;
  waitSeconds: number | null;
}

/**
 * Extracts rate limit information from Supabase Auth error
 */
export function parseRateLimitError(error: unknown): RateLimitInfo {
  if (!error || typeof error !== "object") {
    return { isRateLimited: false, waitSeconds: null };
  }

  const err = error as Record<string, unknown>;

  // Check for 429 status
  const status = err.status ?? err.statusCode ?? (err.code === "over_email_send_rate_limit" ? 429 : null);
  
  if (status !== 429 && err.code !== "over_email_send_rate_limit") {
    return { isRateLimited: false, waitSeconds: null };
  }

  // Try to extract seconds from message
  // Pattern: "you can only request this after X seconds"
  const message = String(err.message ?? err.msg ?? "");
  const match = message.match(/after\s+(\d+)\s+seconds?/i);
  
  const waitSeconds = match ? parseInt(match[1], 10) : null;

  return { isRateLimited: true, waitSeconds };
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  return parseRateLimitError(error).isRateLimited;
}
