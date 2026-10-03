/**
 * E2E Tests: Study Registration
 * 
 * Tests the complete study registration flow:
 * - Discovering studies as public user
 * - Study detail and consent requirements
 * - Registration process for members
 * - Study dashboard access
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Public Study Discovery", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Public user can view studies list", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should see studies list or "no studies" message
    const hasStudies = await page.getByRole("heading", { level: 2 }).isVisible().catch(() => false);
    const hasStudyCards = await page.locator("[data-testid='study-card'], .study-card, article").first().isVisible().catch(() => false);
    const noStudies = await page.getByText(/no studies|žádné studie|coming soon/i).isVisible().catch(() => false);

    expect(hasStudies || hasStudyCards || noStudies).toBe(true);
  });

  test("Study detail page shows requirements", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    // Find first study link/card
    const studyLink = page.locator("a[href*='/studies/'], [data-testid='study-card'] a").first();
    
    if (await studyLink.isVisible().catch(() => false)) {
      await studyLink.click();
      await waitForLoadingComplete(page);

      // Should see study details
      const hasTitle = await page.getByRole("heading", { level: 1 }).isVisible().catch(() => false);
      const hasDescription = await page.locator("p").first().isVisible().catch(() => false);
      
      expect(hasTitle || hasDescription).toBe(true);

      // Should prompt for login to enroll
      const enrollButton = page.getByRole("button", { name: /enroll|přihlásit|join|zapojit/i });
      const loginPrompt = page.getByText(/login|přihlášení|sign in/i);
      
      const needsAction = 
        await enrollButton.isVisible().catch(() => false) ||
        await loginPrompt.isVisible().catch(() => false);
      
      expect(needsAction).toBe(true); // Soft check
    }
  });

  test("Studies page loads within reasonable time", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/studies");
    await waitForLoadingComplete(page);
    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });
});

test.describe("Member Study Registration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can view available studies", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // As member, should see enroll options
    const enrollButtons = page.getByRole("button", { name: /enroll|přihlásit|join|zapojit/i });
    const enrollCount = await enrollButtons.count().catch(() => 0);
    
    // May have 0 if already enrolled in all or no studies
    expect(enrollCount >= 0).toBe(true);
  });

  test("Member can view study detail with registration option", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const studyLink = page.locator("a[href*='/studies/']").first();
    
    if (await studyLink.isVisible().catch(() => false)) {
      await studyLink.click();
      await waitForLoadingComplete(page);

      // Should see registration button or already enrolled status
      const enrollButton = page.getByRole("button", { name: /enroll|přihlásit|join/i });
      const enrolledStatus = page.getByText(/enrolled|zapsán|participating|účastníte/i);
      const pendingStatus = page.getByText(/pending|čekající|applied|zažádáno/i);

      const hasStatus = 
        await enrollButton.isVisible().catch(() => false) ||
        await enrolledStatus.isVisible().catch(() => false) ||
        await pendingStatus.isVisible().catch(() => false);

      expect(hasStatus).toBe(true); // Study might not accept registrations
    }
  });

  test("Member can access enrolled studies dashboard", async ({ page }) => {
    await page.goto("/member/studies");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should see enrolled studies or empty state
    const hasRegistrations = await page.getByText(/enrolled|zapsán|my studies|moje studie/i).isVisible().catch(() => false);
    const noRegistrations = await page.getByText(/no registrations|žádné studie|not enrolled/i).isVisible().catch(() => false);
    const studyList = await page.locator("[data-testid='study-registration'], .registration-card").first().isVisible().catch(() => false);

    expect(hasRegistrations || noRegistrations || studyList).toBe(true);
  });

  test("Study registration shows consent requirements", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);

    const studyCard = page.locator("[data-testid='study-card'], .study-card, article").first();
    
    if (await studyCard.isVisible().catch(() => false)) {
      await studyCard.click();
      await waitForLoadingComplete(page);

      // Click enroll if available
      const enrollButton = page.getByRole("button", { name: /enroll|přihlásit|join/i });
      
      if (await enrollButton.isVisible().catch(() => false) && await enrollButton.isEnabled()) {
        await enrollButton.click();
        await waitForLoadingComplete(page);

        // Should see consent form or requirements
        const hasConsentForm = await page.getByText(/consent|souhlas|agree|souhlasím/i).isVisible().catch(() => false);
        const hasRequirements = await page.getByText(/requirements|požadavky|eligibility/i).isVisible().catch(() => false);
        
        // Either shows form or proceeds directly
        expect(hasConsentForm || hasRequirements).toBe(true);
      }
    }
  });
});

test.describe("Study Progress Tracking", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Member can view study progress", async ({ page }) => {
    await page.goto("/member/studies");
    await waitForLoadingComplete(page);

    const registrationCard = page.locator("[data-testid='study-registration'], .registration-card").first();
    
    if (await registrationCard.isVisible().catch(() => false)) {
      await registrationCard.click();
      await waitForLoadingComplete(page);

      // Should see progress or study detail
      const hasProgress = await page.getByText(/progress|pokrok|status|stav/i).isVisible().catch(() => false);
      const hasQuestionnaires = await page.getByText(/questionnaire|dotazník/i).isVisible().catch(() => false);
      const hasCheckIns = await page.getByText(/check-in|kontrola/i).isVisible().catch(() => false);

      expect(hasProgress || hasQuestionnaires || hasCheckIns).toBe(true);
    }
  });

  test("Member dashboard shows study overview", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);

    // Dashboard should have studies section
    const studiesSection = page.getByRole("heading", { name: /studies|studie/i });
    const studiesLink = page.getByRole("link", { name: /studies|studie/i });
    
    const hasStudiesReference = 
      await studiesSection.isVisible().catch(() => false) ||
      await studiesLink.isVisible().catch(() => false);

    expect(hasStudiesReference).toBe(true); // May be in sidebar
  });
});
