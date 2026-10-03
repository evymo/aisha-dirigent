/**
 * E2E Tests: Seed Data Validation (platform seed + E2E fixture layer)
 *
 * Purpose (unchanged): the data the database is seeded with works in the app —
 * seeded users log in, localized content resolves, the studies / partner /
 * shop surfaces render the seeded rows.
 *
 * What is seeded changed: the platform seed (aisha/db/seed/) carries NO project
 * or demo data any more (no demo users, studies, questionnaires, products). A
 * fresh install gets empty domain tables. For this suite the rows come from the
 * synthetic fixture layer aisha/db/seed.e2e.sql (ids in e2e/fixture-ids.ts), so
 * this spec validates THAT layer on top of the platform seed:
 *   1. The fixture users (auth.setup storage states) reach their dashboards.
 *   2. Localized fixture content resolves through the localized RPCs — no nulls,
 *      no raw translation keys (the former "questionnaire translations" check).
 *   3. The synthetic umbrella study is the one the app resolves and lists.
 *   4. Admin / partner / public routes that list seeded data load.
 *
 * @requires the local e2e stack (scripts/e2e/run-local.mjs) — seed.e2e.sql applied
 */

import type { APIRequestContext } from "@playwright/test";
import { test, expect, waitForLoadingComplete } from "./fixtures";
import {
  E2E_FIXTURES,
  E2E_QUALIFICATION_ANSWERS,
  E2E_CERTIFICATION_ANSWERS,
} from "./fixture-ids";

const GATEWAY_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

/** Calls a public (anon-granted) RPC and fails the test on a non-2xx answer. */
async function callPublicRpc<T>(
  request: APIRequestContext,
  fn: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await request.post(`${GATEWAY_URL}/rest/v1/rpc/${fn}`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    data: params,
  });
  expect(response.ok(), `${fn} → HTTP ${response.status()}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

test.describe("Seed Validation - Fixture Data (API)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("synthetic umbrella study is the one the app resolves", async ({ request }) => {
    const umbrella = await callPublicRpc<Array<{ id: string; name: string; is_umbrella: boolean }>>(
      request,
      "get_umbrella_study",
    );
    expect(umbrella.map((s) => s.id)).toEqual([E2E_FIXTURES.umbrellaStudyId]);

    const active = await callPublicRpc<Array<{ id: string; name: string }>>(request, "get_active_studies", {
      p_locale: "en",
    });
    expect(active).toContainEqual(
      expect.objectContaining({ id: E2E_FIXTURES.umbrellaStudyId, name: E2E_FIXTURES.umbrellaStudyName }),
    );
  });

  test("umbrella consent requirement is localized", async ({ request }) => {
    // cs has no fixture translation → must fall back to en, never to the raw template key.
    const requirements = await callPublicRpc<Array<{ consent_template_id: string; title: string; is_required: boolean }>>(
      request,
      "get_study_consent_requirements_localized",
      { p_study_id: E2E_FIXTURES.umbrellaStudyId, p_locale: "cs" },
    );
    expect(requirements).toContainEqual(
      expect.objectContaining({
        consent_template_id: E2E_FIXTURES.umbrellaConsentTemplateId,
        title: E2E_FIXTURES.umbrellaConsentTitle,
        is_required: true,
      }),
    );
  });

  for (const [testType, answers] of [
    ["qualification", E2E_QUALIFICATION_ANSWERS],
    ["certification", E2E_CERTIFICATION_ANSWERS],
  ] as const) {
    test(`${testType} questions are exactly the fixture set and localized`, async ({ request }) => {
      const questions = await callPublicRpc<
        Array<{ id: string; question: string | null; option_a: string | null; option_b: string | null; option_c: string | null }>
      >(request, "get_test_questions_public_localized", { p_locale: "cs", p_test_type: testType });

      // Grading counts every active question: the answer key must cover the whole set.
      expect(questions.map((q) => q.id).sort()).toEqual(Object.keys(answers).sort());
      for (const q of questions) {
        for (const text of [q.question, q.option_a, q.option_b, q.option_c]) {
          expect(text, `question ${q.id} has an unresolved text`).toBeTruthy();
          expect(text).not.toMatch(/^e2e\.tests\./);
        }
      }
    });
  }

  test("fixture subscription package is listed", async ({ request }) => {
    const packages = await callPublicRpc<Array<{ id: string; name: string }>>(request, "get_subscription_packages", {
      p_locale: "en",
    });
    expect(packages).toContainEqual(
      expect.objectContaining({ id: E2E_FIXTURES.subscriptionPackageId, name: E2E_FIXTURES.subscriptionPackageName }),
    );
  });
});

test.describe("Seed Validation - Member", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("member dashboard loads", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/member-dashboard.png",
      fullPage: true,
    });
  });

  test("studies page lists the fixture umbrella study (EN)", async ({ page }) => {
    await page.goto("/studies?lng=en");
    await waitForLoadingComplete(page);

    await expect(page.getByText(E2E_FIXTURES.umbrellaStudyName).first()).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/studies-en.png",
      fullPage: true,
    });

    const pageText = await page.textContent("body");
    expect(pageText).toBeDefined();
    expect(pageText).not.toContain("undefined");
  });

  test("studies page renders without unresolved text (CS)", async ({ page }) => {
    await page.goto("/member?lng=cs");
    await waitForLoadingComplete(page);

    await page.goto("/studies?lng=cs");
    await waitForLoadingComplete(page);

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/studies-cs.png",
      fullPage: true,
    });

    const pageText = await page.textContent("body");
    expect(pageText).toBeDefined();
    expect(pageText).not.toContain("undefined");
  });

  test("partners page loads", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/partners-list.png",
      fullPage: true,
    });
  });

  test("shop page loads", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/shop.png",
      fullPage: true,
    });
  });
});

test.describe("Seed Validation - Partner", () => {
  test.use({ storageState: "e2e/.auth/partner.json" });

  test("partner dashboard loads", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/partner-dashboard.png",
      fullPage: true,
    });
  });

  test("partner can view their profile", async ({ page }) => {
    await page.goto("/partner/profile");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/partner-profile.png",
      fullPage: true,
    });
  });

  test("partner availability settings load", async ({ page }) => {
    await page.goto("/partner/availability");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/partner-availability.png",
      fullPage: true,
    });
  });
});

test.describe("Seed Validation - Admin", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/admin-dashboard.png",
      fullPage: true,
    });
  });

  test("admin can view users list", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/admin-users.png",
      fullPage: true,
    });
  });

  test("admin can view questionnaires list", async ({ page }) => {
    await page.goto("/admin/questionnaires");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/admin-questionnaires.png",
      fullPage: true,
    });
  });

  test("admin can view studies list", async ({ page }) => {
    await page.goto("/admin/studies");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/admin-studies.png",
      fullPage: true,
    });
  });
});

test.describe("Seed Validation - Public Routes", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("public studies page lists the fixture umbrella study", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
    await expect(page.getByText(E2E_FIXTURES.umbrellaStudyName).first()).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/public-studies.png",
      fullPage: true,
    });
  });

  test("public partners page loads", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/public-partners.png",
      fullPage: true,
    });
  });

  test("public shop page loads", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const mainContent = page.locator("main, [role='main']").first();
    await expect(mainContent).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/public-shop.png",
      fullPage: true,
    });
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/auth/login");
    await waitForLoadingComplete(page);

    const loginForm = page.locator("form").first();
    await expect(loginForm).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/seed-validation/login-page.png",
      fullPage: true,
    });
  });
});
