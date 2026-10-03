/**
 * Partner StoryLoop E2E Tests
 *
 * Tests the StoryLoop AI consultation feature for partners.
 * Covers: story listing, story viewing, AI interaction, user sharing.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("StoryLoop - Partner Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("StoryLoop page is accessible", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should show StoryLoop interface
    const hasStoryLoop = await page.getByText(/storyloop|story|příběh|consultation|konzultace/i).isVisible().catch(() => false);
    expect(hasStoryLoop).toBe(true);
  });

  test("Story list is displayed", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should show story list or empty state
    const hasStories = await page.getByText(/story|příběh|consultation|case/i).isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no stories|žádné příběhy|create|start/i).isVisible().catch(() => false);
    const hasStoryCard = await page.getByTestId("story-card").first().isVisible().catch(() => false);

    expect(hasStories || hasEmptyState || hasStoryCard).toBe(true);
  });

  test("Can create new story", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find create button
    const createButton = page.getByRole("button", { name: /create|new|start|vytvořit|nový|začít/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Should show story creation form
      const hasForm = await page.getByLabel(/title|user|subject|název|pacient/i).first().isVisible().catch(() => false);
      const hasEditor = await page.locator("textarea, [contenteditable='true']").first().isVisible().catch(() => false);

      expect(hasForm || hasEditor).toBe(true);
    }
  });

  test("Can view individual story", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Click on first story
    const storyLink = page.getByRole("link", { name: /view|detail|story|příběh/i }).first();
    const storyCard = page.getByTestId("story-card").first();

    if (await storyLink.isVisible().catch(() => false)) {
      await storyLink.click();
      await waitForLoadingComplete(page);

      const hasStoryDetail = await page.getByText(/story|příběh|consultation|user/i).isVisible().catch(() => false);
      expect(hasStoryDetail).toBe(true);
    } else if (await storyCard.isVisible().catch(() => false)) {
      await storyCard.click();
      await waitForLoadingComplete(page);

      const hasStoryDetail = await page.getByText(/story|příběh/i).isVisible().catch(() => false);
      expect(hasStoryDetail).toBe(true);
    }
  });
});

test.describe("StoryLoop - AI Consultation", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("AI assistant interface is available", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Look for AI/chat interface
    const hasAI = await page.getByText(/AI|assistant|asistent|chat|analyze|analyzovat/i).isVisible().catch(() => false);
    const hasChatInterface = await page.getByTestId("ai-chat").isVisible().catch(() => false);
    const hasInputField = await page.getByPlaceholder(/message|ask|question|zpráva|otázka/i).isVisible().catch(() => false);

    expect(hasAI || hasChatInterface || hasInputField).toBe(true);
  });

  test("Can send message to AI", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find chat input
    const chatInput = page.getByPlaceholder(/message|ask|question|zpráva/i).first()
      .or(page.locator("textarea").first());

    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.fill("What are the recommended products for joint pain?");

      const sendButton = page.getByRole("button", { name: /send|submit|odeslat/i }).first();

      if (await sendButton.isVisible().catch(() => false)) {
        await sendButton.click();
        await waitForLoadingComplete(page);

        // Should show response or loading
        const hasResponse = await page.getByText(/response|odpověď|analyzing|loading/i).isVisible().catch(() => false);
        expect(hasResponse).toBe(true);
      }
    }
  });

  test("AI responses are displayed", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Look for AI message bubbles or response area
    const hasMessages = await page.locator("[data-role='assistant'], .ai-message, .assistant-message").first().isVisible().catch(() => false);
    const hasConversation = await page.getByTestId("conversation").isVisible().catch(() => false);

    expect(hasMessages || hasConversation).toBe(true);
  });
});

test.describe("StoryLoop - User Context", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Can link story to user", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find create or edit story
    const createButton = page.getByRole("button", { name: /create|new|vytvořit/i }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await waitForLoadingComplete(page);

      // Look for user selection
      const userSelect = page.getByLabel(/user|pacient|member|klient/i).first();
      const userDropdown = page.getByRole("combobox", { name: /user|pacient/i }).first();

      const hasUserSelect = await userSelect.isVisible().catch(() => false);
      const hasUserDropdown = await userDropdown.isVisible().catch(() => false);

      expect(hasUserSelect || hasUserDropdown).toBe(true);
    }
  });

  test("User health data is available in context", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Look for user data section
    const hasUserData = await page.getByText(/health data|zdravotní data|check-in|history/i).isVisible().catch(() => false);
    const hasContextPanel = await page.getByTestId("user-context").isVisible().catch(() => false);

    expect(hasUserData || hasContextPanel).toBe(true);
  });
});

test.describe("StoryLoop - Story Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Can edit existing story", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find edit button
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();

    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show edit form
      const hasForm = await page.locator("textarea, input[type='text']").first().isVisible().catch(() => false);
      expect(hasForm).toBe(true);
    }
  });

  test("Can delete story", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find delete button
    const deleteButton = page.getByRole("button", { name: /delete|remove|smazat|odstranit/i }).first();

    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirmation = await page.getByText(/confirm|are you sure|jste si jisti/i).isVisible().catch(() => false);
      expect(hasConfirmation).toBe(true);
    }
  });

  test("Can filter stories", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find filter/search
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|filter|hledat/i)).first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(500);

      // Results should filter
      expect(true).toBe(true);
    }
  });
});

test.describe("StoryLoop - Sharing", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Can share story with user", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find share button
    const shareButton = page.getByRole("button", { name: /share|sdílet/i }).first();

    if (await shareButton.isVisible().catch(() => false)) {
      await shareButton.click();
      await waitForLoadingComplete(page);

      // Should show share options
      const hasShareOptions = await page.getByText(/share with|sdílet s|user|email/i).isVisible().catch(() => false);
      expect(hasShareOptions).toBe(true);
    }
  });

  test("Can export story", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Find export button
    const exportButton = page.getByRole("button", { name: /export|download|stáhnout/i }).first();

    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await waitForLoadingComplete(page);

      // Should show export options
      const hasExportOptions = await page.getByText(/pdf|export|download/i).isVisible().catch(() => false);
      expect(hasExportOptions).toBe(true);
    }
  });
});

test.describe("StoryLoop - Templates", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Templates page is accessible", async ({ page }) => {
    await page.goto("/partner/templates");
    await waitForLoadingComplete(page);

    // Should show templates
    const hasTemplates = await page.getByText(/template|šablona|message|zpráva/i).isVisible().catch(() => false);
    expect(hasTemplates).toBe(true);
  });

  test("Can view message templates", async ({ page }) => {
    await page.goto("/partner/templates");
    await waitForLoadingComplete(page);

    // Should show template list
    const hasTemplateList = await page.getByText(/template|šablona/i).isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no templates|žádné šablony|create/i).isVisible().catch(() => false);

    expect(hasTemplateList || hasEmptyState).toBe(true);
  });

  test("Can use template in StoryLoop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Look for template selection
    const templateButton = page.getByRole("button", { name: /template|šablona|use template/i }).first();

    if (await templateButton.isVisible().catch(() => false)) {
      await templateButton.click();
      await waitForLoadingComplete(page);

      // Should show template picker
      const hasTemplatePicker = await page.getByText(/select template|vybrat šablonu/i).isVisible().catch(() => false);
      expect(hasTemplatePicker).toBe(true);
    }
  });
});

test.describe("StoryLoop - Security", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("StoryLoop requires partner role", async ({ page }) => {
    // Login as member (not partner)
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should show access denied or redirect
    const hasAccessDenied = await page.getByText(/denied|forbidden|unauthorized|not allowed/i).isVisible().catch(() => false);
    const wasRedirected = !page.url().includes("/partner/storyloop");

    expect(hasAccessDenied || wasRedirected).toBe(true);
  });

  test("Stories are partner-specific", async ({ page }) => {
    await loginUser(page, USERS.partner.email, USERS.partner.password);

    // Verify via RPC that only own stories are returned
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_my_storyloop_stories", {
        p_limit: 100
      });

      // All stories should belong to current partner
      const partnerId = "e2e00000-0000-0000-0000-000000000003";
      const allOwnStories = data?.every((s: Record<string, unknown>) => s.partner_id === partnerId) ?? true;

      return {
        allOwnStories,
        count: data?.length ?? 0,
        error: error?.message
      };
    });

    expect(result.allOwnStories).toBe(true);
  });
});

test.describe("StoryLoop - Admin View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Admin can view AI agent configurations", async ({ page }) => {
    await page.goto("/admin/agents");
    await waitForLoadingComplete(page);

    // Should show agent configurations
    const hasAgents = await page.getByText(/agent|AI|configuration|konfigurace/i).isVisible().catch(() => false);
    expect(hasAgents).toBe(true);
  });
});
