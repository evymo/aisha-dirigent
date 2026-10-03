/**
 * E2E Tests: RPC Endpoint Validation
 * 
 * Tyto testy ověřují že všechny RPC funkce jsou správně nakonfigurované:
 * - Veřejné RPC (anon access) - musí mít SECURITY DEFINER + GRANT TO anon
 * - Authenticated RPC - musí mít GRANT TO authenticated
 * - Správné HTTP status kódy (ne 401/403 pro oprávněné uživatele)
 * 
 * @see docs/security/RPC_FUNCTION_SECURITY.md
 */

import { test, expect, TEST_USERS, loginUser, clearLocalStorage, waitForLoadingComplete } from "./fixtures";
import type { Page, APIRequestContext, APIResponse } from "@playwright/test";

// ============================================================================
// CONFIGURATION
// ============================================================================

/** RPC endpoint base path */
const RPC_PATH = "/rest/v1/rpc";

/** Get Supabase URL from environment or use fallback */
const getSupabaseUrl = (): string => {
  return process.env.VITE_AISHA_POSTGREST_URL || 
         process.env.AISHA_POSTGREST_URL || 
         "http://127.0.0.1:3001";
};

/** Get anon key from environment or use fallback */
const getAnonKey = (): string => {
  return process.env.VITE_AISHA_POSTGREST_ANON_KEY || 
         process.env.AISHA_POSTGREST_ANON_KEY || "";
};

// ============================================================================
// PUBLIC RPC ENDPOINTS (ANON ACCESS REQUIRED)
// ============================================================================

/**
 * Seznam RPC funkcí které MUSÍ být přístupné anonymním uživatelům.
 * Tyto funkce musí mít:
 * - SECURITY DEFINER (aby mohly číst data)
 * - SET search_path TO 'public' (security)
 * - GRANT EXECUTE TO anon
 */
const PUBLIC_RPC_ENDPOINTS = [
  {
    name: "get_supported_languages",
    description: "Vrací podporované jazyky aplikace",
    params: {},
    expectedStatus: [200],
    minResultCount: 1, // Měl by vrátit alespoň jeden jazyk
  },
  {
    name: "get_active_studies",
    description: "Vrací aktivní veřejné studie",
    params: {}, // No params or optional p_locale
    expectedStatus: [200],
    minResultCount: 0, // Může být prázdné
  },
  {
    name: "get_public_products",
    description: "Vrací veřejné produkty v e-shopu",
    params: {}, // No params
    expectedStatus: [200],
    minResultCount: 0,
  },
  {
    name: "get_archive_documents",
    description: "Vrací dokumenty z veřejného archivu",
    params: {}, // All params optional: p_decade, p_document_type, p_preparation, p_keywords, p_search_query
    expectedStatus: [200],
    minResultCount: 0,
  },
  {
    name: "is_umbrella_study",
    description: "Kontroluje zda je studie umbrella study",
    params: { p_study_id: "00000000-0000-0000-0000-000000000000" },
    expectedStatus: [200], // Vrací false pro neexistující ID
    validateResponse: (data: unknown) => typeof data === "boolean",
  },
  {
    name: "get_translations",
    description: "Vrací překlady UI",
    params: {}, // Optional: p_namespace (e.g. 'core')
    expectedStatus: [200],
    minResultCount: 0,
  },
  {
    name: "get_public_homepage_stats",
    description: "Vrací veřejné statistiky na homepage",
    params: {},
    expectedStatus: [200],
  },
  {
    name: "get_public_hero_slides",
    description: "Vrací veřejné hero slidy",
    params: {},
    expectedStatus: [200],
    minResultCount: 0,
  },
  {
    name: "validate_invitation",
    description: "Ověří pozvánku pro promo onboarding",
    params: { p_invite_code: "INVALID-CODE-123" },
    expectedStatus: [200],
    validateResponse: (data: unknown) =>
      Array.isArray(data) && data.length > 0 && data[0]?.is_valid === false,
  },
] as const;

// ============================================================================
// AUTHENTICATED RPC ENDPOINTS
// ============================================================================

/**
 * RPC funkce vyžadující autentizaci (v rámci funkce kontroluje auth.uid()).
 * 
 * SECURITY MODEL: Tyto funkce používají SECURITY DEFINER + GRANT TO anon pattern.
 * To znamená že HTTP status je vždy 200, ale uvnitř funkce se kontroluje auth.uid().
 * Pro anon uživatele vrací prázdná data / null / false (dle funkce).
 * 
 * Testujeme:
 * - Anon: HTTP 200, ale prázdná/null data
 * - Authenticated: HTTP 200 s reálnými daty
 */
const AUTHENTICATED_RPC_ENDPOINTS = [
  {
    name: "get_user_permissions",
    description: "Vrací oprávnění aktuálního uživatele",
    params: {},
    expectedStatusAnon: [200], // SECURITY DEFINER - returns empty array for anon
    expectedStatusAuth: [200],
    role: "any",
    validateAnonResponse: (data: unknown) => Array.isArray(data) && data.length === 0, // Anon gets empty permissions
  },
  {
    name: "get_my_profile_completeness",
    description: "Vrací kompletnost profilu aktuálního uživatele",
    params: {},
    expectedStatusAnon: [200], // SECURITY DEFINER - returns null/default for anon
    expectedStatusAuth: [200],
    role: "any",
  },
  {
    name: "get_my_membership",
    description: "Vrací členství aktuálního uživatele",
    params: {},
    expectedStatusAnon: [200], // SECURITY DEFINER - returns null for anon
    expectedStatusAuth: [200],
    role: "any",
  },
  {
    name: "get_my_chat_conversations",
    description: "Vrací chat konverzace aktuálního uživatele",
    params: { p_limit: 10 }, // Optional: p_status default 'active'
    expectedStatusAnon: [401], // No anon grant - Pattern D (sensitive)
    expectedStatusAuth: [200],
    role: "any",
  },
  {
    name: "get_my_questionnaire_completed",
    description: "Kontroluje zda uživatel dokončil dotazník",
    params: { p_questionnaire_id: "00000000-0000-0000-0000-000000000000" },
    expectedStatusAnon: [200], // SECURITY DEFINER - returns false for anon
    expectedStatusAuth: [200],
    role: "any",
    validateAnonResponse: (data: unknown) => data === false,
  },
] as const;

// ============================================================================
// ADMIN RPC ENDPOINTS (ADMIN/STAFF ROLE REQUIRED)
// ============================================================================

/**
 * Admin endpointy - vyžadují admin nebo staff roli.
 * Tyto funkce mají suffix _admin a kontrolují oprávnění přes is_admin_or_staff().
 */
const ADMIN_RPC_ENDPOINTS = [
  {
    name: "get_admin_health_check_ins_audited",
    description: "Vrací všechny health check-iny (admin sensitive data přístup)",
    params: { p_limit: 10 },
    expectedStatusAnon: [401, 405],
    expectedStatusMember: [400, 401, 403, 405],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_audit_journal",
    description: "Vrací audit log záznamy",
    params: { p_limit: 10 },
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_partner_profiles_admin",
    description: "Vrací všechny partner profily",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_studies_admin",
    description: "Vrací všechny studie (admin přístup)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_study_consultants_admin",
    description: "Vrací study consultants (admin)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_products_admin",
    description: "Vrací produkty (admin přístup s kompletními daty)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_token_locks_admin",
    description: "Vrací token locks (admin)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_token_allocations_admin",
    description: "Vrací token allocations (admin)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_token_burns_admin",
    description: "Vrací token burns (admin)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_distribution_calendar_admin",
    description: "Vrací distribution calendar (admin)",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_study_contributions_admin",
    description: "Vrací study contributions",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_completed_study_contributions_admin",
    description: "Vrací completed study contributions",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
  {
    name: "get_production_batches_admin",
    description: "Vrací production batches",
    params: {},
    expectedStatusAnon: [400, 401],
    expectedStatusMember: [400, 403],
    expectedStatusAdmin: [200],
  },
] as const;

// ============================================================================
// PARTNER RPC ENDPOINTS (PARTNER ACCESS REQUIRED)
// ============================================================================

/**
 * Partner endpointy - vyžadují roli practitioner.
 * 
 * get_invitations: Má vnitřní autorizační kontrolu - vyžaduje autentizaci
 * get_partner_users_last_activity_audited: SECURITY DEFINER + authenticated only
 */
const PARTNER_RPC_ENDPOINTS = [
  {
    name: "get_invitations",
    description: "Vrací pozvánky partnera",
    params: {},
    expectedStatusAnon: [401], // No anon grant - Pattern D
    expectedStatusPartner: [200],
  },
  {
    name: "get_partner_users_last_activity_audited",
    description: "Vrací poslední aktivitu pacientů partnera",
    params: { p_user_ids: [] },
    expectedStatusAnon: [401], // Only authenticated role
    expectedStatusPartner: [200],
  },
] as const;

// ============================================================================
// AUDITED sensitive data RPC ENDPOINTS (REQUIRE AUTH + sensitive data MODE)
// ============================================================================

/**
 * RPC funkce pro sensitive data data - vyžadují autentizaci a jsou auditované.
 * Suffix _audited indikuje že se loguje do audit_journal.
 */
const SENSITIVE_RPC_ENDPOINTS = [
  {
    name: "get_my_health_check_ins_audited",
    description: "Vrací zdravotní check-iny uživatele (sensitive)",
    params: { p_limit: 10 },
    expectedStatusAnon: [401],
    expectedStatusAuth: [200],
    isSensitive: true,
  },
  {
    name: "get_my_lab_results_audited",
    description: "Vrací laboratorní výsledky uživatele (sensitive)",
    params: { p_limit: 10 },
    expectedStatusAnon: [401],
    expectedStatusAuth: [200],
    isSensitive: true,
  },
  {
    name: "get_my_dosing_logs_audited",
    description: "Vrací záznamy o dávkování (sensitive)",
    params: { p_limit: 10 },
    expectedStatusAnon: [401],
    expectedStatusAuth: [200],
    isSensitive: true,
  },
] as const;

// ============================================================================
// KNOWN ISSUES - ENDPOINTS EXPECTED TO FAIL (DB BUGS)
// ============================================================================

/**
 * RPC funkce se známými problémy v DB definici.
 * Tyto testy dokumentují aktuální stav a měly by selhat do opravy.
 * 
 * FIXED: get_my_chat_conversations - was using 'communication' enum value
 * Migration 20260113033200 extends journal_area enum with missing values
 */
const KNOWN_ISSUES: Array<{
  name: string;
  description: string;
  params: Record<string, unknown>;
  issue: string;
  expectedToFail: boolean;
  errorMessage?: string;
}> = [
  // Currently no known issues - all functions fixed
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface RpcCallOptions {
  functionName: string;
  params?: Record<string, unknown>;
  accessToken?: string;
  expectError?: boolean;
}

interface RpcResult {
  status: number;
  data: unknown;
  error: unknown;
  headers: Record<string, string>;
}

/**
 * Volá RPC endpoint přímo přes HTTP API.
 */
async function callRpc(
  request: APIRequestContext,
  options: RpcCallOptions
): Promise<RpcResult> {
  const baseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  const url = `${baseUrl}${RPC_PATH}/${options.functionName}`;
  
  const headers: Record<string, string> = {
    "apikey": anonKey,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
  
  if (options.accessToken) {
    headers["Authorization"] = `Bearer ${options.accessToken}`;
  }
  
  let response: APIResponse;
  try {
    response = await request.post(url, {
      headers,
      data: options.params || {},
    });
  } catch (e) {
    return {
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : "Network error",
      headers: {},
    };
  }
  
  const status = response.status();
  let data: unknown = null;
  let error: unknown = null;
  
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text);
      if (status >= 400) {
        error = parsed;
      } else {
        data = parsed;
      }
    }
  } catch {
    // Response není JSON
  }
  
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers())) {
    responseHeaders[key] = value;
  }
  
  return { status, data, error, headers: responseHeaders };
}

/**
 * Získá access token pro uživatele přes Supabase Auth API.
 */
async function getAccessToken(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<string | null> {
  const baseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  
  const response = await request.post(`${baseUrl}/auth/v1/token?grant_type=password`, {
    headers: {
      "apikey": anonKey,
      "Content-Type": "application/json",
    },
    data: {
      email,
      password,
    },
  });
  
  if (response.status() !== 200) {
    console.error("Auth failed:", await response.text());
    return null;
  }
  
  const data = await response.json();
  return data.access_token || null;
}

// ============================================================================
// TESTS: PUBLIC RPC ENDPOINTS
// ============================================================================

test.describe("RPC: Public Endpoints (Anon Access)", () => {
  
  for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
    test(`${endpoint.name} - should be accessible without authentication`, async ({ request }) => {
      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
      });
      
      // Loguj výsledek pro debugging
      if (!endpoint.expectedStatus.includes(result.status)) {
        console.error(`[${endpoint.name}] Unexpected status:`, {
          status: result.status,
          error: result.error,
          data: result.data,
        });
      }
      
      // Ověř status kód
      expect(
        endpoint.expectedStatus.includes(result.status),
        `${endpoint.name}: Expected status ${endpoint.expectedStatus.join(" or ")}, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}`
      ).toBe(true);
      
      // Ověř že není 401/403 (indikuje chybějící SECURITY DEFINER nebo GRANT TO anon)
      expect(
        result.status,
        `${endpoint.name}: Got ${result.status} - possible missing SECURITY DEFINER or GRANT TO anon`
      ).not.toBe(401);
      
      expect(
        result.status,
        `${endpoint.name}: Got 403 - possible RLS policy blocking anon access`
      ).not.toBe(403);
      
      // Validace odpovědi (pokud je definovaná)
      if ("validateResponse" in endpoint && endpoint.validateResponse && result.status === 200) {
        expect(
          endpoint.validateResponse(result.data),
          `${endpoint.name}: Response validation failed`
        ).toBe(true);
      }
      
      // Validace minimálního počtu výsledků
      if ("minResultCount" in endpoint && result.status === 200 && Array.isArray(result.data)) {
        expect(
          result.data.length,
          `${endpoint.name}: Expected at least ${endpoint.minResultCount} results`
        ).toBeGreaterThanOrEqual(endpoint.minResultCount);
      }
    });
  }
});

// ============================================================================
// TESTS: AUTHENTICATED RPC ENDPOINTS
// ============================================================================

test.describe("RPC: Authenticated Endpoints", () => {
  let accessToken: string | null = null;
  
  test.beforeAll(async ({ request }) => {
    // Získej access token pro testování
    accessToken = await getAccessToken(
      request,
      TEST_USERS.member.email,
      TEST_USERS.member.password
    );
    
    if (!accessToken) {
      console.warn("Could not get access token - auth tests will be skipped");
    }
  });
  
  for (const endpoint of AUTHENTICATED_RPC_ENDPOINTS) {
    // Test pro anon uživatele - SECURITY DEFINER funkce vracejí 200 ale s omezenými/prázdnými daty
    test(`${endpoint.name} - anon returns expected status (SECURITY DEFINER pattern)`, async ({ request }) => {
      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
      });
      
      expect(
        endpoint.expectedStatusAnon.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusAnon.join(" or ")} for anon, got ${result.status}`
      ).toBe(true);
      
      // Pokud je definována validace pro anon response, zkontroluj ji
      if ('validateAnonResponse' in endpoint && endpoint.validateAnonResponse) {
        expect(
          endpoint.validateAnonResponse(result.data),
          `${endpoint.name}: Anon response validation failed`
        ).toBe(true);
      }
    });
    
    test(`${endpoint.name} - should return 200 for authenticated user`, async ({ request }) => {
      test.skip(!accessToken, "No access token available");
      
      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
        accessToken: accessToken!,
      });
      
      if (!endpoint.expectedStatusAuth.includes(result.status)) {
        console.error(`[${endpoint.name}] Auth call failed:`, {
          status: result.status,
          error: result.error,
        });
      }
      
      expect(
        endpoint.expectedStatusAuth.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusAuth.join(" or ")} for auth, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}`
      ).toBe(true);
    });
  }
});

// ============================================================================
// TESTS: sensitive data RPC ENDPOINTS
// ============================================================================

test.describe("RPC: sensitive data Endpoints (Audited)", () => {
  let accessToken: string | null = null;
  
  test.beforeAll(async ({ request }) => {
    accessToken = await getAccessToken(
      request,
      TEST_USERS.member.email,
      TEST_USERS.member.password
    );
  });
  
  for (const endpoint of SENSITIVE_RPC_ENDPOINTS) {
    test(`${endpoint.name} - requires authentication`, async ({ request }) => {
      // Test anon access - should fail
      const anonResult = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
      });
      
      expect(
        endpoint.expectedStatusAnon.includes(anonResult.status),
        `${endpoint.name}: Anon should get ${endpoint.expectedStatusAnon.join(" or ")}, got ${anonResult.status}`
      ).toBe(true);
    });
    
    test(`${endpoint.name} - accessible with authentication`, async ({ request }) => {
      test.skip(!accessToken, "No access token available");
      
      const authResult = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
        accessToken: accessToken!,
      });
      
      if (!endpoint.expectedStatusAuth.includes(authResult.status)) {
        console.error(`[${endpoint.name}] sensitive data call failed:`, {
          status: authResult.status,
          error: authResult.error,
        });
      }
      
      expect(
        endpoint.expectedStatusAuth.includes(authResult.status),
        `${endpoint.name}: Auth should get ${endpoint.expectedStatusAuth.join(" or ")}, got ${authResult.status}. ` +
        `Error: ${JSON.stringify(authResult.error)}`
      ).toBe(true);
    });
  }
});

// ============================================================================
// TESTS: KNOWN ISSUES (EXPECTED TO FAIL)
// ============================================================================

test.describe("RPC: Known Issues (Expected Failures)", () => {
  let accessToken: string | null = null;
  
  test.beforeAll(async ({ request }) => {
    accessToken = await getAccessToken(
      request,
      TEST_USERS.member.email,
      TEST_USERS.member.password
    );
  });
  
  for (const issue of KNOWN_ISSUES) {
    test(`${issue.name} - documents known issue: ${issue.issue}`, async ({ request }) => {
      test.skip(!accessToken, "No access token available");
      
      const result = await callRpc(request, {
        functionName: issue.name,
        params: issue.params as Record<string, unknown>,
        accessToken: accessToken!,
      });
      
      // Tento test dokumentuje známý problém
      if (issue.expectedToFail) {
        // Očekáváme chybu
        if (result.status >= 400) {
          console.log(`[KNOWN ISSUE] ${issue.name}: ${issue.issue}`);
          console.log(`  Error: ${JSON.stringify(result.error)}`);
          
          // Ověř že chyba obsahuje očekávanou zprávu
          if (issue.errorMessage) {
            const errorStr = JSON.stringify(result.error);
            expect(
              errorStr.includes(issue.errorMessage),
              `Expected error message to contain "${issue.errorMessage}"`
            ).toBe(true);
          }
        } else {
          // Pokud prošlo, issue je opravena!
          console.log(`[FIXED?] ${issue.name}: Previously failing, now returns ${result.status}`);
        }
      }
    });
  }
});

// ============================================================================
// TESTS: ADMIN RPC ENDPOINTS
// ============================================================================

test.describe("RPC: Admin Endpoints", () => {
  let adminToken: string | null = null;
  let memberToken: string | null = null;

  test.beforeAll(async ({ request }) => {
    adminToken = await getAccessToken(
      request,
      TEST_USERS.admin.email,
      TEST_USERS.admin.password
    );
    memberToken = await getAccessToken(
      request,
      TEST_USERS.member.email,
      TEST_USERS.member.password
    );
  });

  for (const endpoint of ADMIN_RPC_ENDPOINTS) {
    test(`${endpoint.name} - should deny anonymous access`, async ({ request }) => {
      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
      });

      expect(
        endpoint.expectedStatusAnon.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusAnon.join(" or ")} for anon, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}`
      ).toBe(true);
    });

    test(`${endpoint.name} - should deny member access`, async ({ request }) => {
      test.skip(!memberToken, "No member access token available");

      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
        accessToken: memberToken!,
      });

      expect(
        endpoint.expectedStatusMember.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusMember.join(" or ")} for member, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}`
      ).toBe(true);
    });

    test(`${endpoint.name} - should allow admin access`, async ({ request }) => {
      test.skip(!adminToken, "No admin access token available");

      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
        accessToken: adminToken!,
      });

      expect(
        endpoint.expectedStatusAdmin.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusAdmin.join(" or ")} for admin, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}. Data: ${JSON.stringify(result.data)}`
      ).toBe(true);

      // Pro úspěšné admin volání by měla existovat data nebo prázdné pole
      if (result.status === 200) {
        expect(result.data !== null, `${endpoint.name}: Expected data, got null`).toBe(true);
      }
    });
  }
});

// ============================================================================
// TESTS: PARTNER RPC ENDPOINTS
// ============================================================================

test.describe("RPC: Partner Endpoints", () => {
  let partnerToken: string | null = null;

  test.beforeAll(async ({ request }) => {
    partnerToken = await getAccessToken(
      request,
      TEST_USERS.partner.email,
      TEST_USERS.partner.password
    );
  });

  for (const endpoint of PARTNER_RPC_ENDPOINTS) {
    test(`${endpoint.name} - should return 401 for anonymous user`, async ({ request }) => {
      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
      });

      expect(
        endpoint.expectedStatusAnon.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusAnon.join(" or ")} for anon, got ${result.status}`
      ).toBe(true);
    });

    test(`${endpoint.name} - should return 200 for partner`, async ({ request }) => {
      test.skip(!partnerToken, "No partner access token available");

      const result = await callRpc(request, {
        functionName: endpoint.name,
        params: endpoint.params as Record<string, unknown>,
        accessToken: partnerToken!,
      });

      expect(
        endpoint.expectedStatusPartner.includes(result.status),
        `${endpoint.name}: Expected ${endpoint.expectedStatusPartner.join(" or ")} for partner, got ${result.status}. ` +
        `Error: ${JSON.stringify(result.error)}`
      ).toBe(true);
    });
  }
});

// ============================================================================
// TESTS: EDGE FUNCTIONS
// ============================================================================

test.describe("Edge Functions: Availability", () => {
  
  test("public-partners-directory - should be accessible", async ({ request }) => {
    const baseUrl = getSupabaseUrl();
    const anonKey = getAnonKey();
    
    // Edge functions mají jiný endpoint
    const edgeFunctionUrl = baseUrl.includes("supabase.co")
      ? baseUrl.replace(".supabase.co", ".supabase.co/functions/v1")
      : `${baseUrl}/functions/v1`;
    
    const response = await request.get(`${edgeFunctionUrl}/public-partners-directory`, {
      headers: {
        "apikey": anonKey,
        "Authorization": `Bearer ${anonKey}`,
      },
    });
    
    const status = response.status();
    
    // Edge function by měla vrátit 200 nebo 404 (pokud neexistuje)
    // 500 indikuje chybu v edge function
    // 405 je Method Not Allowed - akceptováno pro lokální prostředí (edge functions nejsou deployed)
    if (status === 500) {
      console.error("Edge function error:", await response.text());
    }
    
    // Pro lokální dev může být 404 nebo 405 (edge function není deployed)
    expect(
      [200, 404, 405].includes(status),
      `Expected 200, 404 or 405, got ${status}`
    ).toBe(true);
  });
});

// ============================================================================
// DIAGNOSTIC TESTS
// ============================================================================

test.describe("RPC: Diagnostics", () => {
  
  test("list available RPC functions", async ({ request }) => {
    // Tento test pomáhá zjistit jaké RPC funkce jsou dostupné
    const testFunctions = [
      "get_supported_languages",
      "get_active_studies",
      "get_public_products",
      "get_archive_documents",
      "is_umbrella_study",
      "get_translations",
      "get_token_config",
      "get_user_permissions",
      "get_my_profile",
    ];
    
    const results: Array<{ name: string; status: number; accessible: boolean }> = [];
    
    for (const fn of testFunctions) {
      const result = await callRpc(request, { functionName: fn, params: {} });
      results.push({
        name: fn,
        status: result.status,
        accessible: result.status !== 404,
      });
    }
    
    console.log("\n=== RPC Function Availability ===");
    console.table(results);
    
    // Alespoň některé funkce by měly existovat
    const existingFunctions = results.filter(r => r.accessible);
    expect(existingFunctions.length).toBeGreaterThan(0);
  });
  
  test("verify Supabase connection", async ({ request }) => {
    const baseUrl = getSupabaseUrl();
    const anonKey = getAnonKey();
    
    console.log("\n=== Supabase Configuration ===");
    console.log(`URL: ${baseUrl}`);
    console.log(`Anon Key: ${anonKey.substring(0, 20)}...`);
    
    // Test basic connectivity
    const response = await request.get(`${baseUrl}/rest/v1/`, {
      headers: {
        "apikey": anonKey,
      },
    });
    
    console.log(`REST API Status: ${response.status()}`);
    
    // 200 nebo 400 (no table specified) jsou ok
    expect([200, 400].includes(response.status())).toBe(true);
  });
});
