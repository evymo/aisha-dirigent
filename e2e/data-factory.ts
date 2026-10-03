/**
 * E2E Test Data Factory
 * 
 * Vytváří testovací data přímo v databázi pro E2E testy.
 * Každý test suite si vytvoří vlastní data a po sobě uklidí.
 * 
 * Princip:
 * 1. Seed.sql obsahuje pouze systémová data (admin, práva, konfigurace)
 * 2. E2E testy si vytvoří vlastní uživatele, produkty, studie atd.
 * 3. Po testu se data smažou (optional - pro debug může zůstat)
 */

import { Page } from "@playwright/test";

// Supabase local connection
const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const AISHA_POSTGREST_ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";
const AISHA_POSTGREST_SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY || "";

// Test user templates
export const TEST_USER_TEMPLATES = {
  admin: {
    email: "e2e-admin@platform.test",
    password: "E2EAdmin123!",
    role: "admin",
    displayName: "E2E Admin User",
  },
  member: {
    email: "e2e-member@platform.test",
    password: "E2EMember123!",
    role: "member",
    displayName: "E2E Member User",
  },
  partner: {
    email: "e2e-partner@platform.test",
    password: "E2EPartner123!",
    role: "practitioner",
    displayName: "E2E Partner User",
  },
  staff: {
    email: "e2e-staff@platform.test",
    password: "E2EStaff123!",
    role: "staff",
    displayName: "E2E Staff User",
  },
};

/**
 * Helper pro Supabase API volání s service role
 */
async function supabaseAdmin<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(`${AISHA_POSTGREST_URL}${endpoint}`, {
    method,
    headers: {
      "apikey": AISHA_POSTGREST_SERVICE_KEY,
      "Authorization": `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Vytvoří testovacího uživatele
 */
export async function createTestUser(template: keyof typeof TEST_USER_TEMPLATES): Promise<{
  id: string;
  email: string;
  password: string;
}> {
  const user = TEST_USER_TEMPLATES[template];
  const uniqueEmail = user.email.replace("@", `-${Date.now()}@`);

  // Vytvoř uživatele přes Admin API
  const authResponse = await fetch(`${AISHA_POSTGREST_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "apikey": AISHA_POSTGREST_SERVICE_KEY,
      "Authorization": `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: uniqueEmail,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        display_name: user.displayName,
      },
    }),
  });

  if (!authResponse.ok) {
    const error = await authResponse.text();
    throw new Error(`Failed to create user: ${error}`);
  }

  const authData = await authResponse.json();
  const userId = authData.id;

  // Vytvoř profil
  await supabaseAdmin("/rest/v1/profiles", "POST", {
    id: userId,
    user_id: userId,
    display_name: user.displayName,
  });

  // Přiřaď roli (pokud není member - member je default)
  if (user.role !== "member") {
    await supabaseAdmin("/rest/v1/user_roles", "POST", {
      user_id: userId,
      role: user.role,
      granted_by: userId,
    });
  }

  return {
    id: userId,
    email: uniqueEmail,
    password: user.password,
  };
}

/**
 * Smaže testovacího uživatele
 */
export async function deleteTestUser(userId: string): Promise<void> {
  // Smaž přes Admin API
  await fetch(`${AISHA_POSTGREST_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      "apikey": AISHA_POSTGREST_SERVICE_KEY,
      "Authorization": `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
    },
  });
}

/**
 * Vytvoří testovací produkt
 */
export async function createTestProduct(name: string = "E2E Test Product"): Promise<{
  id: string;
  name: string;
  slug: string;
}> {
  const slug = `e2e-test-${Date.now()}`;
  
  const [product] = await supabaseAdmin<Array<{ id: string; name: string; slug: string }>>(
    "/rest/v1/products",
    "POST",
    {
      name,
      slug,
      description: "Test product created by E2E tests",
      price: 1000, // 10.00 in cents
      currency: "CZK",
      is_active: true,
      is_prescription_required: false,
      stock_quantity: 100,
    }
  );

  return product;
}

/**
 * Smaže testovací produkt
 */
export async function deleteTestProduct(productId: string): Promise<void> {
  await supabaseAdmin(`/rest/v1/products?id=eq.${productId}`, "DELETE");
}

/**
 * Vytvoří testovací studii
 */
export async function createTestStudy(title: string = "E2E Test Study"): Promise<{
  id: string;
  title: string;
  slug: string;
}> {
  const slug = `e2e-test-study-${Date.now()}`;
  
  const [study] = await supabaseAdmin<Array<{ id: string; title: string; slug: string }>>(
    "/rest/v1/studies",
    "POST",
    {
      title,
      slug,
      description: "Test study created by E2E tests",
      status: "active",
      is_public: true,
      registration_open: true,
      start_date: new Date().toISOString(),
    }
  );

  return study;
}

/**
 * Smaže testovací studii
 */
export async function deleteTestStudy(studyId: string): Promise<void> {
  await supabaseAdmin(`/rest/v1/studies?id=eq.${studyId}`, "DELETE");
}

/**
 * Vytvoří data sharing consent mezi member a partner
 */
export async function createDataSharingConsent(
  memberId: string,
  partnerId: string
): Promise<{ id: string }> {
  // Najdi partner profile ID
  const [partnerProfile] = await supabaseAdmin<Array<{ id: string }>>(
    `/rest/v1/partner_profiles?user_id=eq.${partnerId}&select=id`
  );

  if (!partnerProfile) {
    throw new Error("Partner profile not found");
  }

  const [consent] = await supabaseAdmin<Array<{ id: string }>>(
    "/rest/v1/data_sharing_consents",
    "POST",
    {
      user_id: memberId,
      partner_id: partnerProfile.id,
      consent_types: ["health_check_ins", "lab_results", "dosing_logs"],
      granted_at: new Date().toISOString(),
    }
  );

  return consent;
}

/**
 * Vytvoří partner profil pro uživatele
 */
export async function createPartnerProfile(userId: string, displayName: string): Promise<{
  id: string;
}> {
  const [profile] = await supabaseAdmin<Array<{ id: string }>>(
    "/rest/v1/partner_profiles",
    "POST",
    {
      user_id: userId,
      display_name: displayName,
      bio: "E2E Test Partner",
      city: "Prague",
      country: "CZ",
      is_visible: true,
      is_production_provider: true,
      accepts_online_appointments: true,
    }
  );

  return profile;
}

/**
 * Vytvoří health check-in pro uživatele
 */
export async function createHealthCheckIn(
  userId: string,
  data: {
    painLevel?: number;
    energyLevel?: number;
    moodLevel?: number;
  } = {}
): Promise<{ id: string }> {
  const [checkIn] = await supabaseAdmin<Array<{ id: string }>>(
    "/rest/v1/health_check_ins",
    "POST",
    {
      user_id: userId,
      check_in_date: new Date().toISOString().split("T")[0],
      pain_level: data.painLevel ?? 3,
      energy_level: data.energyLevel ?? 7,
      mood_level: data.moodLevel ?? 6,
    }
  );

  return checkIn;
}

/**
 * Cleanup - smaže všechna E2E testovací data
 */
export async function cleanupE2EData(): Promise<void> {
  // Smaž uživatele s e2e- prefix v emailu
  const users = await supabaseAdmin<Array<{ id: string }>>(
    "/rest/v1/profiles?display_name=like.E2E%"
  );

  for (const user of users) {
    try {
      await deleteTestUser(user.id);
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Smaž produkty s e2e- prefix
  await supabaseAdmin("/rest/v1/products?slug=like.e2e-test-%", "DELETE");

  // Smaž studie s e2e- prefix
  await supabaseAdmin("/rest/v1/studies?slug=like.e2e-test-%", "DELETE");
}

/**
 * Přihlásí uživatele a vrátí token pro API volání
 */
export async function loginAndGetToken(email: string, password: string): Promise<string> {
  const response = await fetch(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "apikey": AISHA_POSTGREST_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Volá RPC endpoint s tokenem uživatele
 */
export async function callRpcAsUser<T>(
  token: string,
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const response = await fetch(`${AISHA_POSTGREST_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "apikey": AISHA_POSTGREST_ANON_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  return response.json();
}
