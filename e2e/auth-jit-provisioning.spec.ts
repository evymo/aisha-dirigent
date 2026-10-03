/**
 * E2E: First-request user provisioning (FK 23503 regression guard)
 *
 * Demonstrates the backend-mutate → measure → verify loop against the local
 * stack: an authenticated user calls a write RPC whose target FKs
 * aisha_auth.users; before the fix this raised FK 23503 ("Key (user_id)=(...)
 * is not present in table users") for any Keycloak user created after the
 * bootstrap import. After the fix, ensure_current_user JIT-provisions the row.
 *
 * The loop, explicit so it's reusable for the workbench scenarios:
 *   1. authenticate (loginUser) and read the access token
 *   2. MUTATE via RPC (ensure_current_user / update_notification_preferences)
 *   3. MEASURE the RPC outcome (status + body, assert NOT a 23503)
 *   4. VERIFY idempotency (second call still succeeds; same uid)
 *
 * Runs against AISHA_POSTGREST_URL (default local 127.0.0.1:3001); set it to
 * point the same spec at another backend.
 *
 * Run: npm run test:e2e -- auth-jit-provisioning.spec.ts
 */
import { test, expect, TEST_USERS, loginUser } from "./fixtures";
import type { Page } from "@playwright/test";

const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

async function rpc(
  page: Page,
  fn: string,
  params: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const res = await page.request.post(`${AISHA_POSTGREST_URL}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: params,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const k of Object.keys(window.localStorage)) {
      if (!/auth|oidc|token/i.test(k)) continue;
      try {
        const v = JSON.parse(window.localStorage.getItem(k) ?? "");
        const t =
          v?.access_token ??
          v?.currentSession?.access_token ??
          v?.session?.access_token;
        if (typeof t === "string" && t.length > 20) return t;
      } catch {
        /* not JSON */
      }
    }
    return "";
  });
}

test.describe("Backend: first-request user provisioning", () => {
  test("authenticated write RPCs never FK-violate (23503) on first use", async ({ page }) => {
    await page.goto("/");
    await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    const token = await accessToken(page);
    expect(token, "expected an access token after login").not.toEqual("");

    // 2+3. MUTATE: ensure_current_user resolves + provisions the caller.
    const ensure = await rpc(page, "ensure_current_user", {}, token);
    expect(ensure.status, JSON.stringify(ensure.body)).toBe(200);
    // Returns the caller's uuid (provisioned or pre-existing), never an FK error.
    expect(typeof ensure.body === "string" && ensure.body.length === 36).toBe(true);

    // 2+3. MUTATE: the write that used to FK-violate — must succeed now.
    const prefs = await rpc(
      page,
      "update_notification_preferences",
      { p_preferences: { push_enabled: true } },
      token,
    );
    expect(prefs.status, JSON.stringify(prefs.body)).toBe(200);
    // Explicit regression assertion: no FK violation surfaced.
    const bodyStr = JSON.stringify(prefs.body ?? {});
    expect(bodyStr).not.toContain("23503");
    expect(bodyStr).not.toContain("not present in table");

    // 4. VERIFY idempotency: a second provision returns the same uid, no error.
    const ensure2 = await rpc(page, "ensure_current_user", {}, token);
    expect(ensure2.status).toBe(200);
    expect(ensure2.body).toEqual(ensure.body);
  });
});
