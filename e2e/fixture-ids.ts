/**
 * Deterministic ids of the synthetic E2E fixtures seeded by aisha/db/seed.e2e.sql.
 *
 * The platform seed (aisha/db/seed/) carries NO project/demo data — no studies,
 * test questions, packages or products. Every row a spec needs by id is a
 * synthetic fixture in the reserved range `e2e00000-0000-0000-0000-XXXXXXXXXXXX`
 * (documented in the header of seed.e2e.sql). Keep this file and that header in
 * sync; the seed's closing DO block fails loudly when a fixture is missing.
 *
 * @module e2e/fixture-ids
 */

export type TestAnswer = "a" | "b" | "c" | "d";

export const E2E_FIXTURES = {
  /** Only umbrella study (is_umbrella = true) — what get_umbrella_study() returns. */
  umbrellaStudyId: "e2e00000-0000-0000-0000-000000000200",
  umbrellaStudyCode: "e2e-umbrella",
  umbrellaStudyName: "E2E Umbrella Study",
  /** Required consent of the umbrella study (study_consent_requirements). */
  umbrellaConsentTemplateId: "e2e00000-0000-0000-0000-000000000201",
  umbrellaConsentTitle: "E2E participation consent",
  /** Active subscription package, slug 'e2e-premium-monthly'. */
  subscriptionPackageId: "e2e00000-0000-0000-0000-000000000100",
  subscriptionPackageName: "E2E Premium Monthly",
  /** Active product, slug 'e2e-test-product'. */
  productId: "e2e00000-0000-0000-0000-000000000070",
  productName: "E2E Test Product",
  /** Visible, certified partner profile of partner@platform.rtn. */
  partnerDisplayName: "E2E Partner User",
} as const;

/**
 * Answer key of the synthetic qualification test (test_type 'qualification').
 * It covers ALL fixture questions; grading counts every active question (pass >= 75 %).
 */
export const E2E_QUALIFICATION_ANSWERS: Readonly<Record<string, TestAnswer>> = {
  "e2e00000-0000-0000-0000-000000000210": "b",
  "e2e00000-0000-0000-0000-000000000211": "a",
  "e2e00000-0000-0000-0000-000000000212": "c",
  "e2e00000-0000-0000-0000-000000000213": "b",
};

/** Answer key of the synthetic partner certification test (test_type 'certification'). */
export const E2E_CERTIFICATION_ANSWERS: Readonly<Record<string, TestAnswer>> = {
  "e2e00000-0000-0000-0000-000000000220": "a",
  "e2e00000-0000-0000-0000-000000000221": "c",
  "e2e00000-0000-0000-0000-000000000222": "b",
  "e2e00000-0000-0000-0000-000000000223": "a",
};
