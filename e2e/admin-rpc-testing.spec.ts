/**
 * E2E Tests: Admin RPC Endpoints Comprehensive Testing
 * 
 * Pokrývá všechny admin RPC funkce s CRUD operacemi, 
 * přístupovou kontrolou a validací chování
 */

import { test, expect, TEST_USERS, loginUser } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN_USER = TEST_USERS.admin;
const MEMBER_USER = TEST_USERS.member;
const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

const rpcCall = async (
  page: Page,
  functionName: string,
  params: Record<string, unknown> = {},
  authToken?: string
) => {
  const response = await page.request.post(
    `${AISHA_POSTGREST_URL}/rest/v1/rpc/${functionName}`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: authToken ? `Bearer ${authToken}` : `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      data: params,
    }
  );

  return {
    status: response.status(),
    data: await response.json().catch(() => null),
  };
};

const getAccessTokenFromStorage = async (page: Page): Promise<string> => {
  const token = await page.evaluate(() => {
    const extractAccessToken = (value: unknown): string | null => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;

      const directToken = record["access_token"];
      if (typeof directToken === "string") return directToken;

      const session = record["session"];
      if (session && typeof session === "object") {
        const sessionToken = (session as Record<string, unknown>)["access_token"];
        if (typeof sessionToken === "string") return sessionToken;
      }

      const currentSession = record["currentSession"];
      if (currentSession && typeof currentSession === "object") {
        const currentToken = (currentSession as Record<string, unknown>)["access_token"];
        if (typeof currentToken === "string") return currentToken;
      }

      const data = record["data"];
      if (data && typeof data === "object") {
        const dataToken = (data as Record<string, unknown>)["access_token"];
        if (typeof dataToken === "string") return dataToken;
      }

      return null;
    };

    const readFromStorage = (storage: Storage | null): string | null => {
      if (!storage) return null;
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key) keys.push(key);
      }

      const candidateKeys: string[] = [];
      const addKey = (key: string) => {
        if (!candidateKeys.includes(key)) candidateKeys.push(key);
      };

      addKey("sb-e2e-auth-token");
      for (const key of keys) {
        if (key.includes("auth-token")) addKey(key);
      }

      for (const key of candidateKeys) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as unknown;
          const accessToken = extractAccessToken(parsed);
          if (accessToken) return accessToken;
        } catch {
          // ignore
        }
      }

      return null;
    };

    return readFromStorage(window.localStorage) ?? readFromStorage(window.sessionStorage);
  });

  if (!token) {
    throw new Error("Expected access token in browser storage after login.");
  }

  return token;
};

/**
 * Decode JWT payload without verification (just for email check)
 */
const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Correct Base64URL to Base64
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const loginAndGetToken = async (page: Page, email: string, password: string) => {
  // First, try to get token from storage (may be set via storageState from setup)
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  
  try {
    const existingToken = await getAccessTokenFromStorage(page);
    if (existingToken) {
      // Verify the token belongs to the requested user
      const payload = decodeJwtPayload(existingToken);
      if (payload?.email === email) {
        return existingToken;
      }
      // Token exists but for different user - need to logout and login
    }
  } catch {
    // Token not in storage, need to login
  }
  
  // Clear storage and perform fresh login
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  
  await loginUser(page, email, password);
  return getAccessTokenFromStorage(page);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object";

const extractIds = (data: unknown): string[] => {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => typeof id === "string");
};

// ============================================================================
// AUDIT & MONITORING
// ============================================================================

test.describe("Admin RPC: Audit Functions", () => {
  test("get_audit_journal - should return audit entries", async ({
    page,
  }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(
      page,
      "get_audit_journal",
      {
        p_limit: 10,
      },
      adminToken
    );

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data) || result.data === null).toBe(true);
  });

  test("get_audit_journal - should reject non-admin users", async ({
    page,
  }) => {
    const memberToken = await loginAndGetToken(
      page,
      MEMBER_USER.email,
      MEMBER_USER.password
    );

    const result = await rpcCall(
      page,
      "get_audit_journal",
      {
        p_limit: 10,
      },
      memberToken
    );

    expect([403, 401, 400]).toContain(result.status);
  });
});

// ============================================================================
// HEALTH & WELLNESS DATA
// ============================================================================

test.describe("Admin RPC: Health Data Functions", () => {
  test("get_admin_health_check_ins_audited - should return health check-ins", async ({
    page,
  }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(
      page,
      "get_admin_health_check_ins_audited",
      {
        p_limit: 20,
      },
      adminToken
    );

    // Function exists and returns data
    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("get_admin_health_check_ins_audited - should honor limit", async ({
    page,
  }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );
    const limit = 5;

    const result = await rpcCall(
      page,
      "get_admin_health_check_ins_audited",
      {
        p_limit: limit,
      },
      adminToken
    );

    expect(result.status).toBe(200);
    if (Array.isArray(result.data)) {
      expect(result.data.length).toBeLessThanOrEqual(limit);
    }
  });
});

// ============================================================================
// STUDIES & ENROLLMENTS
// ============================================================================

test.describe("Admin RPC: Study Management Functions", () => {
  test("get_studies_admin - should return all studies", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(page, "get_studies_admin", {}, adminToken);

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("get_study_registrations_admin - should return registrations", async ({
    page,
  }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(page, "get_study_registrations_admin", {}, adminToken);

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("update_study_registration_status_admin - should require admin role", async ({
    page,
  }) => {
    // Without auth - should be denied (400 for RAISE EXCEPTION in function)
    let result = await rpcCall(page, "update_study_registration_status_admin", {
      p_registration_id: "00000000-0000-0000-0000-000000000000",
      p_status: "active",
    });

    // 400 for RAISE EXCEPTION, 401 for no auth, 403 for forbidden
    expect([400, 401, 403]).toContain(result.status);

    // With admin auth
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );
    result = await rpcCall(
      page,
      "update_study_registration_status_admin",
      {
        p_registration_id: "00000000-0000-0000-0000-000000000000",
        p_status: "active",
      },
      adminToken
    );

    // Should return 400 for invalid ID, not 401/403
    expect(result.status).toBe(400);
  });
});

// ============================================================================
// PRODUCTS & SHOP
// ============================================================================

test.describe("Admin RPC: Product Management", () => {
  test("get_products_admin - should return all products", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(page, "get_products_admin", {}, adminToken);

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("create_product_admin - should validate inputs", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    // Missing required fields
    const result = await rpcCall(
      page,
      "create_product_admin",
      {
        // p_name and p_slug missing (required)
        p_description: "Test",
      },
      adminToken
    );

    // 400 for validation OR 404 if PostgREST can't find matching function signature
    expect([400, 404]).toContain(result.status);
  });

  test("create_product_admin - should reject non-admin users", async ({ page }) => {
    const memberToken = await loginAndGetToken(
      page,
      MEMBER_USER.email,
      MEMBER_USER.password
    );
    const slug = `e2e-nonadmin-${Date.now()}`;

    const result = await rpcCall(
      page,
      "create_product_admin",
      {
        p_name: "E2E Non-Admin Product",
        p_slug: slug,
      },
      memberToken
    );

    expect([401, 403, 400]).toContain(result.status);
  });

  test("update_product_admin - should deny non-admin users", async ({ page }) => {
    const memberToken = await loginAndGetToken(
      page,
      MEMBER_USER.email,
      MEMBER_USER.password
    );
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const result = await rpcCall(
      page,
      "update_product_admin",
      {
        p_id: unknownId,
        p_name: "Test",
      },
      memberToken
    );

    expect([401, 403, 400]).toContain(result.status);
  });
});

// ============================================================================
// TOKENS & REWARDS
// ============================================================================

test.describe("Admin RPC: Token Management", () => {
  test("get_token_locks_admin - should return token locks", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(page, "get_token_locks_admin", {}, adminToken);

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("update_token_lock_admin - should deny non-admin users", async ({
    page,
  }) => {
    const memberToken = await loginAndGetToken(
      page,
      MEMBER_USER.email,
      MEMBER_USER.password
    );
    const lockId = "00000000-0000-0000-0000-000000000000";
    const result = await rpcCall(
      page,
      "update_token_lock_admin",
      {
        p_lock_id: lockId,
        p_unlocked_amount: 100,
      },
      memberToken
    );

    expect([401, 403, 400]).toContain(result.status);
  });

  test("update_token_lock_admin - should handle unknown locks", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );
    const lockId = "00000000-0000-0000-0000-000000000000";

    const result = await rpcCall(
      page,
      "update_token_lock_admin",
      {
        p_lock_id: lockId,
        p_unlocked_amount: 100,
      },
      adminToken
    );

    expect(result.status).toBe(400);
  });
});

// ============================================================================
// ROLE-BASED SECURITY TESTS
// ============================================================================

test.describe("Admin Functions: Access Control", () => {
  const adminFunctions = [
    { name: "get_audit_journal", params: { p_limit: 10 } },
    { name: "get_admin_health_check_ins_audited", params: { p_limit: 10 } },
    { name: "get_studies_admin", params: {} },
    { name: "get_study_registrations_admin", params: {} },
    { name: "get_products_admin", params: {} },
    { name: "get_token_locks_admin", params: {} },
    { name: "get_partner_profiles_admin", params: {} },
  ];

  adminFunctions.forEach(({ name, params }) => {
    test(`${name} - should deny member access`, async ({ page }) => {
      const memberToken = await loginAndGetToken(
        page,
        MEMBER_USER.email,
        MEMBER_USER.password
      );

      const result = await rpcCall(page, name, params, memberToken);

      expect([403, 401, 400]).toContain(result.status);
    });
  });
});

// ============================================================================
// ERROR HANDLING & EDGE CASES
// ============================================================================

test.describe("Admin Functions: Error Handling", () => {
  test("Invalid JSON in RPC params should return 400", async ({ page }) => {
    const response = await page.request.post(
      `${AISHA_POSTGREST_URL}/rest/v1/rpc/get_studies_admin`,
      {
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        data: "invalid json {{{",
      }
    );

    expect(response.status()).toBe(400);
  });

  test("Missing required params should return 400 or 404", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(
      page,
      "update_product_admin",
      {
        // p_id required but missing
        p_name: "Test",
      },
      adminToken
    );

    // 400 for validation error OR 404 if PostgREST can't find matching function signature
    expect([400, 404]).toContain(result.status);
  });

  test("Invalid UUIDs should be handled gracefully", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(
      page,
      "update_product_admin",
      {
        p_id: "not-a-valid-uuid",
        p_name: "Test",
      },
      adminToken
    );

    // Should return 400 (validation), not 500
    expect(result.status).toBe(400);
  });

  test("Unknown product IDs should return false or error", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(
      page,
      "update_product_admin",
      {
        p_id: "00000000-0000-0000-0000-000000000000",
      },
      adminToken
    );

    // Function returns FOUND (false if no rows updated), or may return 400 for constraint violations
    expect([200, 400]).toContain(result.status);
    if (result.status === 200) {
      expect(result.data === false || result.data === null).toBe(true);
    }
  });
});

// ============================================================================
// CONSISTENCY & VALIDATION
// ============================================================================

test.describe("Admin Functions: Data Consistency", () => {
  test("Multiple calls should return consistent data", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result1 = await rpcCall(page, "get_studies_admin", {}, adminToken);
    const result2 = await rpcCall(page, "get_studies_admin", {}, adminToken);

    expect(result1.status).toBe(result2.status);
    if (result1.status === 200 && result2.status === 200) {
      const list1 = Array.isArray(result1.data) ? result1.data : [];
      const list2 = Array.isArray(result2.data) ? result2.data : [];
      expect(list1.length).toBe(list2.length);
    }
  });

  test("Product IDs should be unique within the response", async ({ page }) => {
    const adminToken = await loginAndGetToken(
      page,
      ADMIN_USER.email,
      ADMIN_USER.password
    );

    const result = await rpcCall(page, "get_products_admin", {}, adminToken);
    expect(result.status).toBe(200);

    const ids = extractIds(result.data);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
