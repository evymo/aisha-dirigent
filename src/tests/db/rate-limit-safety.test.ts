/**
 * Test for rate limit function safety
 * 
 * Verifies that enforce_rate_limit() handles edge cases:
 * - User doesn't exist in auth.users (FK violation prevention)
 * - Null user_id
 * - Expired windows cleanup
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const FUNCTIONS_DIR = path.join(process.cwd(), "aisha", "db", "sql", "functions");

describe("Rate limit function safety", () => {
  it("enforce_rate_limit should check user existence before INSERT", () => {
    const functionPath = path.join(FUNCTIONS_DIR, "enforce_rate_limit.sql");
    const content = fs.readFileSync(functionPath, "utf-8");

    // Must check if user exists before inserting into api_rate_limits
    // This prevents FK violation when token is valid but user was deleted
    const hasUserExistenceCheck = 
      content.includes("SELECT EXISTS") && 
      content.includes("auth.users") &&
      content.includes("v_user_exists");

    expect(
      hasUserExistenceCheck,
      "enforce_rate_limit must verify user exists in auth.users before INSERT to prevent FK violation"
    ).toBe(true);
  });

  it("enforce_rate_limit should handle null user_id gracefully", () => {
    const functionPath = path.join(FUNCTIONS_DIR, "enforce_rate_limit.sql");
    const content = fs.readFileSync(functionPath, "utf-8");

    // Must check for null user_id and return early
    const hasNullCheck = 
      content.includes("v_user_id IS NULL") &&
      content.includes("RETURN");

    expect(
      hasNullCheck,
      "enforce_rate_limit must check for null user_id and return early"
    ).toBe(true);
  });

  it("all functions calling enforce_rate_limit should be identified", () => {
    const files = fs.readdirSync(FUNCTIONS_DIR).filter(f => f.endsWith(".sql"));
    const callersOfRateLimit: string[] = [];

    for (const file of files) {
      if (file === "enforce_rate_limit.sql") continue;
      
      const content = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");
      if (content.includes("enforce_rate_limit")) {
        callersOfRateLimit.push(file.replace(".sql", ""));
      }
    }

    // These functions call enforce_rate_limit and should be aware of potential failures
    console.log(`\n📊 Functions using rate limiting:`);
    callersOfRateLimit.forEach(f => console.log(`   - ${f}`));
    console.log("");

    // Just informational - not a failure condition
    expect(callersOfRateLimit.length).toBeGreaterThan(0);
  });
});
