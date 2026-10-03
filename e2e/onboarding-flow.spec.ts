import { test, expect, clearLocalStorage, loginUser, logoutUser, waitForLoadingComplete } from "./fixtures";
import { E2E_FIXTURES, E2E_QUALIFICATION_ANSWERS, E2E_CERTIFICATION_ANSWERS } from "./fixture-ids";

// Synthetic fixtures from aisha/db/seed.e2e.sql (the platform seed ships no
// studies or test questions). The answer keys cover every active question of
// each test type — the server grades against all of them.
const UMBRELLA_STUDY_ID = E2E_FIXTURES.umbrellaStudyId;
const QUALIFICATION_ANSWERS = E2E_QUALIFICATION_ANSWERS;
const CERTIFICATION_ANSWERS = E2E_CERTIFICATION_ANSWERS;

type MembershipType = "individual" | "professional";

// Full onboarding is intentionally end-to-end and can exceed the default 30s.
test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("Onboarding chain (individual + provider)", () => {
  test("Individual/private onboarding chain", async ({ page }) => {
    await runOnboardingChain({ page, membershipType: "individual", partnerType: "individual" });
  });

  test("Professional/provider onboarding chain", async ({ page }) => {
    await runOnboardingChain({ page, membershipType: "professional", partnerType: "provider" });
  });
});

async function runOnboardingChain(opts: {
  page: import("@playwright/test").Page;
  membershipType: MembershipType;
  partnerType: "individual" | "provider";
}) {
  const { page, membershipType, partnerType } = opts;

  // Debug: log console messages from the page
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`BROWSER ERROR: ${msg.text()}`);
    } else if (msg.text().includes("publicSiteUrl") || msg.text().includes("[DEBUG]")) {
      console.log(`BROWSER LOG: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`PAGE ERROR: ${err.message}`);
  });
  
  // Log network errors for RPC calls
  page.on("response", async (response) => {
    if (response.url().includes("/rest/v1/rpc/") && !response.ok()) {
      const fnMatch = response.url().match(/\/rpc\/([^?]+)/);
      const fnName = fnMatch ? fnMatch[1] : response.url();
      console.log(`RPC ERROR: ${fnName} -> ${response.status()}`);
      try {
        const body = await response.json();
        console.log(`  RPC ERROR BODY: ${JSON.stringify(body)}`);
      } catch { /* ignore parse errors */ }
    }
    if (response.url().includes("/auth/v1/signup")) {
      const status = response.status();
      console.log(`SIGNUP RESPONSE: ${response.url()} -> ${status}`);
      if (status >= 200 && status < 300) {
        try {
          const body = await response.json();
          console.log(`SIGNUP BODY: session=${!!body.session}, user=${!!body.user}`);
        } catch { /* ignore parse errors */ }
      }
    }
    if (response.url().includes("/auth/v1/token")) {
      const status = response.status();
      console.log(`SIGNIN RESPONSE: ${response.url()} -> ${status}`);
      if (!response.ok()) {
        try {
          const body = await response.json();
          console.log(`SIGNIN ERROR BODY: ${JSON.stringify(body)}`);
        } catch { /* ignore parse errors */ }
      }
    }
  });

  const { email, password } = makeCredentials(membershipType);

  // Start clean (the legacy chromium project loads admin storageState by default).
  await clearLocalStorage(page);

  // 1) Create new user via the real Study Registration UI (signup happens on submit step 5).
  await completeStudyRegistration({ page, email, password, membershipType, isSignup: true });

  // 2) Join RII umbrella study (creates registration in screening).
  await joinUmbrellaStudy({ page });

  // 3) Complete questionnaire again while logged-in, so it is tied to the umbrella registration.
  await completeStudyRegistration({ page, email, password, membershipType, isSignup: false });

  // 4) Admin approves + activates the umbrella registration via admin UI.
  await logoutIfPossible(page);
  await loginUser(page, process.env.E2E_ADMIN_EMAIL ?? "admin@platform.rtn", process.env.E2E_ADMIN_PASSWORD ?? "Admin123!");
  await activateRegistrationAsAdmin({ page, email });

  // 5) Member passes qualification test (server validates + assigns role).
  await logoutIfPossible(page);
  await loginUser(page, email, password);
  await passQualificationTest({ page });

  // 6) Partner certification (two variants).
  await passPartnerCertification({ page, partnerType });
}

function makeCredentials(prefix: string) {
  const ts = Date.now();
  // Keep domain consistent with local seed patterns; avoid logging this.
  const email = `e2e+${prefix}.${ts}@platform.rtn`;
  const password = "Test1234!";
  return { email, password };
}

async function completeStudyRegistration(opts: {
  page: import("@playwright/test").Page;
  email: string;
  password: string;
  membershipType: MembershipType;
  isSignup: boolean;
}) {
  const { page, email, password, membershipType, isSignup } = opts;

  await page.goto("/study-registration?lang=en");
  await page.waitForLoadState("domcontentloaded");

  // Check if questionnaire is already completed (happens when signup RPC also saved questionnaire)
  const alreadyCompleted = page.getByRole("heading", { name: /questionnaire already completed/i });
  const basicInfoHeading = page.getByRole("heading", { name: /basic information/i });
  
  // Wait for either heading to appear
  await expect(alreadyCompleted.or(basicInfoHeading)).toBeVisible({ timeout: 15000 });
  
  // If already completed, just click to proceed (skip form fill)
  if (await alreadyCompleted.isVisible()) {
    console.log("Questionnaire already completed - skipping form, proceeding to qualification test");
    await page.getByRole("link", { name: /take qualification test/i }).click();
    return;
  }

  // Ensure the step 1 UI is actually rendered before interacting.
  await expect(basicInfoHeading).toBeVisible({ timeout: 15000 });

  // Step 1: Fill fields in a specific order to avoid controlled input issues.
  // Date picker and radio buttons can cause re-renders; fill password LAST.
  await page.locator('input[name="email"]').fill(email);

  await setDateOfBirthToJan15_1990(page);

  // Membership type: select via value to avoid i18n text coupling.
  await page.locator(`[role="radio"][value="${membershipType}"]`).click();

  // Fill password fields LAST to prevent date picker / radio interactions from clearing them.
  // Note: Password validation happens on final submit (step 5), not on step 1.
  if (isSignup) {
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirmPassword"]').fill(password);
    
    // Debug: verify password was filled before leaving Step 1
    const pwdValue = await page.locator('input[name="password"]').inputValue();
    const confirmPwdValue = await page.locator('input[name="confirmPassword"]').inputValue();
    console.log(`DEBUG Step 1: password length=${pwdValue.length}, confirmPassword length=${confirmPwdValue.length}`);
  }

  // Step 1 -> Step 2
  const nextBtn = page.getByRole("button", { name: /next/i });
  await nextBtn.click();
  
  // Wait for step 2 heading (validations are sync, step advances on success).
  // Use longer timeout as RHF validation + re-render can take a moment.
  await expect(page.getByRole("heading", { name: /current state/i })).toBeVisible({ timeout: 20000 });

  // Step 2 -> Step 3
  await page.getByRole("button", { name: /next/i }).click();
  await waitForLoadingComplete(page);
  await expect(page.getByRole("heading", { name: /health history/i })).toBeVisible({ timeout: 15000 });

  // Step 3 -> Step 4
  await page.getByRole("button", { name: /next/i }).click();
  await waitForLoadingComplete(page);
  await expect(page.getByRole("heading", { name: /lifestyle/i })).toBeVisible({ timeout: 15000 });

  // Step 4 -> Step 5
  await page.getByRole("button", { name: /next/i }).click();
  await waitForLoadingComplete(page);
  await expect(page.getByRole("heading", { name: /complete registration/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 15000 });

  // Step 5: accept all required consents.
  // These checkboxes live inside a ScrollArea; clicking the labels is the most robust.
  const dynamicConsentLabels = page.locator('label[for^="consent-"]');
  await expect(dynamicConsentLabels.first()).toBeVisible({ timeout: 15000 });
  const consentCount = await dynamicConsentLabels.count();
  for (let i = 0; i < consentCount; i++) {
    const label = dynamicConsentLabels.nth(i);
    await label.scrollIntoViewIfNeeded();
    await label.click();
  }

  // Submit
  await page.locator('button[type="submit"]').click();

  // Wait for signup/login to complete and verify success
  if (isSignup) {
    // For signup: wait for redirect away from registration page + user menu visible
    // This confirms the account was created and user is logged in
    await expect(page.getByTestId("user-menu")).toBeVisible({ timeout: 30000 });
    console.log(`✅ Signup successful for ${email}`);
  } else {
    // For re-registration: just wait for loading to complete
    await waitForLoadingComplete(page);
  }
}

async function setDateOfBirthToJan15_1990(page: import("@playwright/test").Page) {
  // The button label can be localized (and can also be a formatted date if already set).
  // Prefer anchoring to the field label instead of relying on placeholder text.
  const dobLabel = page.getByText(/date of birth|datum narození/i).first();
  await expect(dobLabel).toBeVisible({ timeout: 15000 });

  const dobField = dobLabel.locator("..");
  const trigger = dobField.locator('button[type="button"]').first();
  await trigger.click();

  // Use the calendar widget to select a day.
  await page.locator(".rdp").waitFor({ state: "visible", timeout: 5000 });

  // Ensure month/year are stable by using the dropdowns if present.
  // Note: react-day-picker uses native <select> elements overlaying labels.
  const yearSelect = page.locator(".rdp select").nth(1);
  if (await yearSelect.count()) {
    await yearSelect.selectOption("1990");
  }
  const monthSelect = page.locator(".rdp select").nth(0);
  if (await monthSelect.count()) {
    // Month values vary by implementation; try common representations.
    await monthSelect.selectOption({ value: "0" }).catch(async () => {
      await monthSelect.selectOption({ label: /january/i });
    });
  }

  const day15ByName = page.locator('.rdp button[name="day"]').filter({ hasText: /^15$/ }).first();
  if (await day15ByName.count()) {
    await day15ByName.click();
    return;
  }

  await page.locator(".rdp button").filter({ hasText: /^15$/ }).first().click();
}

async function joinUmbrellaStudy(opts: { page: import("@playwright/test").Page }) {
  const { page } = opts;

  await page.goto(`/studies/${UMBRELLA_STUDY_ID}?lang=en`);
  await page.waitForLoadState("domcontentloaded");

  const joinButton = page.getByRole("button", {
    name: /join aisha community|join (the )?program|připojit se|vstoupit/i,
  });

  // The registration may already exist (e.g. created during the Study Registration flow).
  // If the join button is present, click it; otherwise continue.
  const clicked = await joinButton
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(async () => {
      await joinButton.click();
      await waitForLoadingComplete(page);
      return true;
    })
    .catch(() => false);

  if (!clicked) {
    // Best-effort: ensure we are in an enrolled-or-pending state UI.
    await page
      .getByText(/you are enrolled|application pending|pending approval|awaiting approval|přihláška|čeká na/i)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});
  }
}

async function activateRegistrationAsAdmin(opts: { page: import("@playwright/test").Page; email: string }) {
  const { page, email } = opts;

  await page.goto("/admin/registrations?lang=en");
  await page.waitForLoadState("domcontentloaded");

  // Wait for table to load
  await expect(page.getByRole("heading", { name: /study registrations/i })).toBeVisible({ timeout: 10000 });
  
  // Wait for table rows to appear
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

  // Search by email part (the + sign in email might need encoding)
  const searchInput = page.locator("input[placeholder]").first();
  await searchInput.fill(email);
  
  // Wait a moment for search to filter
  await page.waitForTimeout(500);

  // Try to find row with email, if not found try with "Unnamed" + Pending status
  let row = page.getByRole("row", { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
  const emailRowVisible = await row.isVisible().catch(() => false);
  
  if (!emailRowVisible) {
    // Fallback: find a Pending Approval row (most recent registration should be first)
    console.log("Email row not found, searching for Pending Approval row...");
    row = page.getByRole("row", { name: /pending approval/i }).first();
  }
  
  await expect(row).toBeVisible({ timeout: 20000 });

  // Actions column has 3 buttons: approve (check-circle), view (eye), delete (trash)
  // For screening status, click approve button first
  const approveButton = row.locator('button').first();
  
  // Check if there's a check-circle icon (approve button) 
  const hasApproveIcon = await row.locator('svg.lucide-check-circle, svg[class*="check"]').count();
  if (hasApproveIcon > 0) {
    console.log("Clicking approve button...");
    await approveButton.click();
    await waitForLoadingComplete(page);
    // Wait for status to change
    await page.waitForTimeout(1000);
  }

  // Reload page to see updated status and verify registration is now active/approved
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  
  // Verify we have an active registration now
  await expect(page.getByText(/active/i).first()).toBeVisible({ timeout: 10000 });
}

async function passQualificationTest(opts: { page: import("@playwright/test").Page }) {
  const { page } = opts;

  await page.goto("/qualification-test?lang=en");
  await page.waitForLoadState("domcontentloaded");

  // Start
  await page.getByRole("button", { name: /start/i }).click();

  await answerTestByVisibleQuestionIds({
    page,
    answers: QUALIFICATION_ANSWERS,
    nextRegex: /next/i,
    submitRegex: /submit/i,
    maxQuestions: 8,
  });

  // Results should show success state.
  await expect(page.getByText(/passed|congratulations/i)).toBeVisible({ timeout: 20000 });
}

async function passPartnerCertification(opts: {
  page: import("@playwright/test").Page;
  partnerType: "individual" | "provider";
}) {
  const { page, partnerType } = opts;

  await page.goto("/partner-certification?lang=en");
  await page.waitForLoadState("domcontentloaded");

  // Select partner type (clicking the heading bubbles up to the Card onClick).
  if (partnerType === "provider") {
    await page.getByRole("heading", { name: /provider/i }).click();
  } else {
    await page.getByRole("heading", { name: /individual/i }).click();
  }

  await page.getByRole("button", { name: /start/i }).click();

  // Profile
  // Inputs don't have stable ids; select by placeholders/position (lang=en).
  const inputs = page.getByRole("textbox");

  // display_name
  await inputs.nth(0).fill(partnerType === "provider" ? "E2E Provider" : "E2E Individual");

  if (partnerType === "provider") {
    // business_name appears as the second input for providers
    await inputs.nth(1).fill("E2E Clinic");
  }

  // city is either 2nd (individual) or 3rd (provider)
  const cityIndex = partnerType === "provider" ? 2 : 1;
  await inputs.nth(cityIndex).fill("Prague");

  await page.getByRole("button", { name: /continue to test|continue/i }).click();

  await answerTestByVisibleQuestionIds({
    page,
    answers: CERTIFICATION_ANSWERS,
    nextRegex: /next/i,
    submitRegex: /submit/i,
    maxQuestions: 20,
  });

  await expect(page.getByText(/passed|congratulations/i)).toBeVisible({ timeout: 20000 });
}

async function answerTestByVisibleQuestionIds(opts: {
  page: import("@playwright/test").Page;
  answers: Record<string, "a" | "b" | "c" | "d">;
  nextRegex: RegExp;
  submitRegex: RegExp;
  maxQuestions: number;
}) {
  const { page, answers, nextRegex, submitRegex, maxQuestions } = opts;
  const remaining = new Set(Object.keys(answers));

  for (let i = 0; i < maxQuestions; i += 1) {
    // Wait for question content to be visible
    await page.waitForTimeout(300);
    
    const currentId = await findVisibleQuestionId(page, remaining);
    if (!currentId) {
      console.log(`No question found at iteration ${i}, remaining: ${[...remaining].join(', ')}`);
      // If no known question is visible, exit early.
      break;
    }

    const answer = answers[currentId];
    console.log(`Answering question ${currentId} with ${answer}`);
    await page.locator(`#${currentId}-${answer}`).click();
    remaining.delete(currentId);

    const submitBtn = page.getByRole("button", { name: submitRegex });
    const nextBtn = page.getByRole("button", { name: nextRegex });

    // Prefer submit if it is enabled/visible; otherwise next.
    if (await submitBtn.isVisible().catch(() => false)) {
      const disabled = await submitBtn.isDisabled().catch(() => true);
      if (!disabled && remaining.size === 0) {
        await submitBtn.click();
        return;
      }
    }

    await nextBtn.click();
    // Wait for page transition
    await page.waitForTimeout(200);
  }

  // Final attempt to submit.
  const submitBtn = page.getByRole("button", { name: submitRegex });
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  }
}

async function findVisibleQuestionId(
  page: import("@playwright/test").Page,
  candidateIds: Set<string>
): Promise<string | null> {
  // Try each candidate with a short wait for visibility
  for (const id of candidateIds) {
    try {
      // Wait up to 2 seconds for the radio button to be visible
      await page.locator(`#${id}-a`).waitFor({ state: "visible", timeout: 2000 });
      return id;
    } catch {
      // This question is not visible, try next
    }
  }
  
  // Fallback: just check visibility without waiting
  for (const id of candidateIds) {
    const anyOptionVisible = await page.locator(`#${id}-a`).isVisible().catch(() => false);
    if (anyOptionVisible) return id;
  }
  return null;
}

async function logoutIfPossible(page: import("@playwright/test").Page) {
  // If we're already logged out or header is missing, just clear.
  const hasMenu = await page.getByTestId("user-menu").isVisible().catch(() => false);
  if (hasMenu) {
    await logoutUser(page);
  } else {
    await clearLocalStorage(page);
  }
}
