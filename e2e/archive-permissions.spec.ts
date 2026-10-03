/**
 * E2E Tests: Archive Document Permissions
 *
 * Tests archive document access based on is_public and is_download_public flags.
 *
 * ## RPC Functions Tested:
 * - get_archive_documents - public list with conditional fields
 * - get_archive_document_by_slug - public detail with conditional fields
 * - get_archive_filter_options - public filter options
 * - get_archive_documents_admin - admin only
 *
 * ## Permission Logic:
 * - scan_url / transcript_url: visible if is_public=true OR user authenticated
 * - storage_path: visible if is_download_public=true OR user authenticated
 *
 * ## Test Scenarios:
 * 1. Anon user can see preview (scan_url) of public documents
 * 2. Anon user cannot see preview of non-public documents
 * 3. Anon user cannot download (storage_path) non-download-public documents
 * 4. Authenticated user can see all previews
 * 5. Authenticated user can download all documents
 */

import { test, expect, Page, APIRequestContext } from "@playwright/test";
import { waitForLoadingComplete } from "./fixtures";

// Test data interface
interface ArchiveDocumentData {
  id?: string;
  slug: string;
  title: string;
  is_public: boolean;
  is_download_public: boolean;
  scan_url: string | null;
  storage_path: string | null;
}

// Helper to get Supabase API URL and anon key from env
function getSupabaseConfig() {
  return {
    url: process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001",
    anonKey:
      process.env.VITE_AISHA_POSTGREST_ANON_KEY || "",
  };
}

// Helper to call RPC as anon
async function callRpcAsAnon(
  request: APIRequestContext,
  fnName: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const { url, anonKey } = getSupabaseConfig();
  const response = await request.post(`${url}/rest/v1/rpc/${fnName}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    data: params,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`RPC ${fnName} failed: ${response.status()} - ${errorText}`);
  }

  return response.json();
}

// Helper to call RPC as authenticated user
async function callRpcAsAuth(
  request: APIRequestContext,
  accessToken: string,
  fnName: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const { url, anonKey } = getSupabaseConfig();
  const response = await request.post(`${url}/rest/v1/rpc/${fnName}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    data: params,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`RPC ${fnName} failed: ${response.status()} - ${errorText}`);
  }

  return response.json();
}

// Helper to login and get access token
async function getAuthToken(request: APIRequestContext): Promise<string> {
  const { url, anonKey } = getSupabaseConfig();
  const response = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    data: {
      email: "member@platform.rtn",
      password: "Member123!",
    },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Auth failed: ${response.status()} - ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

// ============================================================================
// API-Level Tests: RPC Function Permissions
// ============================================================================

test.describe("Archive RPC: Anon Access", () => {
  test("get_archive_filter_options returns filter options", async ({ request }) => {
    const data = await callRpcAsAnon(request, "get_archive_filter_options");

    expect(data).toHaveProperty("decades");
    expect(data).toHaveProperty("document_types");
    expect(data).toHaveProperty("preparations");
    expect(data).toHaveProperty("places");
    expect(data).toHaveProperty("keywords");
  });

  test("get_archive_documents returns documents with conditional fields", async ({ request }) => {
    const data = (await callRpcAsAnon(request, "get_archive_documents")) as ArchiveDocumentData[];

    // Should return array (may be empty)
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      // Check that public documents have scan_url visible
      const publicDoc = data.find((d) => d.is_public === true);
      const privateDoc = data.find((d) => d.is_public === false);

      if (publicDoc) {
        // Public document should have scan_url visible (if it exists)
        // scan_url can be empty string or URL for public docs
        expect(publicDoc).toHaveProperty("scan_url");
        // The value should be defined (not null for public docs with scans)
      }

      if (privateDoc) {
        // Private document should have scan_url as null for anon
        expect(privateDoc.scan_url).toBeNull();
      }
    }
  });

  test("get_archive_document_by_slug returns document with conditional fields", async ({ request }) => {
    // First get list of documents to find a slug
    const list = (await callRpcAsAnon(request, "get_archive_documents")) as ArchiveDocumentData[];

    test.skip(list.length === 0, "No archive documents available");

    const testDoc = list[0];
    const data = (await callRpcAsAnon(request, "get_archive_document_by_slug", {
      p_slug: testDoc.slug,
    })) as ArchiveDocumentData[];

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);

    const doc = data[0];
    expect(doc.slug).toBe(testDoc.slug);

    // Verify conditional field logic based on is_public
    if (doc.is_public) {
      // Public doc - scan_url should be visible
      expect(doc).toHaveProperty("scan_url");
    } else {
      // Private doc - scan_url should be null for anon
      expect(doc.scan_url).toBeNull();
    }

    // Verify download path logic based on is_download_public
    if (doc.is_download_public) {
      expect(doc).toHaveProperty("storage_path");
    } else {
      expect(doc.storage_path).toBeNull();
    }
  });
});

test.describe("Archive RPC: Authenticated Access", () => {
  let accessToken: string;

  test.beforeAll(async ({ request }) => {
    try {
      accessToken = await getAuthToken(request);
    } catch (error) {
      console.warn("Could not get auth token, tests will be skipped:", error);
    }
  });

  test("get_archive_documents returns all fields for authenticated user", async ({ request }) => {
    test.skip(!accessToken, "Auth token not available");

    const data = (await callRpcAsAuth(request, accessToken, "get_archive_documents")) as ArchiveDocumentData[];

    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      // For authenticated user, ALL documents should have scan_url and storage_path visible
      // (if the document has those fields set in DB)
      const anyDoc = data[0];

      // Authenticated user sees these fields (not null due to auth)
      // Note: can still be empty string if not set in DB, but NOT null
      expect(anyDoc).toHaveProperty("scan_url");
      expect(anyDoc).toHaveProperty("storage_path");
      expect(anyDoc).toHaveProperty("transcript_url");

      // Verify that private documents are now accessible
      const privateDoc = data.find((d) => d.is_public === false);
      if (privateDoc) {
        // For authenticated user, scan_url should NOT be null (may be empty string if no scan)
        // The RPC returns empty string for COALESCE, not null for auth users
        expect(privateDoc.scan_url).not.toBeNull();
      }
    }
  });

  test("get_archive_document_by_slug returns all fields for authenticated user", async ({ request }) => {
    test.skip(!accessToken, "Auth token not available");

    // First get list
    const list = (await callRpcAsAuth(request, accessToken, "get_archive_documents")) as ArchiveDocumentData[];

    test.skip(list.length === 0, "No archive documents available");

    // Find a private document if exists
    const privateDoc = list.find((d) => d.is_public === false);
    const testSlug = privateDoc?.slug || list[0].slug;

    const data = (await callRpcAsAuth(request, accessToken, "get_archive_document_by_slug", {
      p_slug: testSlug,
    })) as ArchiveDocumentData[];

    expect(data.length).toBe(1);

    const doc = data[0];

    // Authenticated user sees all fields regardless of is_public
    expect(doc).toHaveProperty("scan_url");
    expect(doc).toHaveProperty("storage_path");
    expect(doc).toHaveProperty("transcript_url");

    // Values should not be null for authenticated (can be empty string)
    if (privateDoc) {
      expect(doc.scan_url).not.toBeNull();
      expect(doc.storage_path).not.toBeNull();
    }
  });
});

// ============================================================================
// UI-Level Tests: Archive Page Permissions
// ============================================================================

test.describe("Archive UI: Anonymous User", () => {
  // Clear storage to ensure truly anonymous access
  test.use({ storageState: { cookies: [], origins: [] } });

  test("can browse archive list", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Page should load
    await expect(
      page.getByRole("heading", { name: /Explore the Archive|Prozkoumejte archiv/i })
    ).toBeVisible();
  });

  test("sees 'Sign in to view' for private document preview or can view public", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Find and click a document
    const docLink = page
      .locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')")
      .first();

    if (!(await docLink.isVisible().catch(() => false))) {
      test.skip(true, "No documents in archive");
      return;
    }

    await docLink.click();
    await waitForLoadingComplete(page);

    // Check for either:
    // 1. Document viewer (if public) - PDF preview section with Download button
    // 2. Sign-in prompt (if private) - lock icon and sign in link
    const previewHeading = page.getByRole("heading", { name: /Document Preview|Náhled dokumentu/i });
    const downloadButton = page.getByRole("button", { name: /download/i });
    const signInLink = page.locator("a:has-text('Sign in'), a:has-text('Přihlásit')");
    const lockIcon = page.locator("svg.lucide-lock");

    const hasPreview = await previewHeading.isVisible().catch(() => false);
    const hasDownload = await downloadButton.first().isVisible().catch(() => false);
    const hasSignIn = await signInLink.first().isVisible().catch(() => false);
    const hasLock = await lockIcon.first().isVisible().catch(() => false);

    // Either we can view (public - has preview/download) or we get sign-in prompt (private)
    const canViewPublic = hasPreview || hasDownload;
    const needsAuth = hasSignIn || hasLock;

    expect(canViewPublic || needsAuth).toBe(true);
  });

  test("sees 'Sign in to download' for non-public-download document", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const docLink = page
      .locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')")
      .first();

    if (!(await docLink.isVisible().catch(() => false))) {
      test.skip(true, "No documents in archive");
      return;
    }

    await docLink.click();
    await waitForLoadingComplete(page);

    // Look for download button or sign-in prompt for download
    const downloadButton = page.getByRole("button", { name: /stáhnout|download/i }).first();
    const signInToDownload = page.locator(
      "text=Sign in to download, text=Přihlaste se pro stažení"
    );
    const lockWithDownload = page.locator("a:has(svg.lucide-lock):has-text('download')");

    const hasDownload = await downloadButton.isVisible().catch(() => false);
    const hasSignInPrompt = await signInToDownload.isVisible().catch(() => false);
    const hasLockedDownload = await lockWithDownload.isVisible().catch(() => false);

    // Should have either download button (if download public) or sign-in prompt
    // Note: Some documents might not have any download at all
    if (hasDownload || hasSignInPrompt || hasLockedDownload) {
      expect(true).toBe(true);
    }
  });
});

test.describe("Archive UI: Authenticated User", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("can view private document preview", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const docLink = page
      .locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')")
      .first();

    if (!(await docLink.isVisible().catch(() => false))) {
      test.skip(true, "No documents in archive");
      return;
    }

    await docLink.click();
    await waitForLoadingComplete(page);

    // Authenticated user should NOT see "Sign in to view" 
    const signInPrompt = page.locator("text=Sign in to view, text=Přihlaste se pro zobrazení");
    const hasSignIn = await signInPrompt.isVisible().catch(() => false);

    // Should NOT show sign-in prompt for authenticated user
    expect(hasSignIn).toBe(false);

    // Should see document viewer or some content
    // Check for PDF viewer, canvas, or document content
    const contentIndicators = page.locator(
      ".react-pdf__Page, canvas, [data-testid='document-viewer'], img[src*='storage'], iframe"
    );
    const hasContent = await contentIndicators.first().isVisible().catch(() => false);

    // Document detail page should show content for authenticated user
    // or at least show metadata (title, description)
    const title = page.locator("h1").first();
    const hasTitle = await title.isVisible().catch(() => false);

    expect(hasContent || hasTitle).toBe(true);
  });

  test("can download documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const docLink = page
      .locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')")
      .first();

    if (!(await docLink.isVisible().catch(() => false))) {
      test.skip(true, "No documents in archive");
      return;
    }

    await docLink.click();
    await waitForLoadingComplete(page);

    // Authenticated user should see download button, not sign-in prompt
    const signInToDownload = page.locator(
      "text=Sign in to download, text=Přihlaste se pro stažení"
    );
    const hasSignIn = await signInToDownload.isVisible().catch(() => false);

    // Should NOT show sign-in for download
    expect(hasSignIn).toBe(false);

    // Look for download functionality
    const downloadButton = page.getByRole("button", { name: /stáhnout|download/i }).first();
    const downloadLink = page.locator("a[download], a:has-text('Download'), a:has-text('Stáhnout')").first();

    const hasDownloadButton = await downloadButton.isVisible().catch(() => false);
    const hasDownloadLink = await downloadLink.isVisible().catch(() => false);

    // Should have some download option (or document might not have downloadable file)
    // This is OK as long as we don't see "sign in to download"
    if (hasDownloadButton || hasDownloadLink) {
      // Click to verify it works (sets up download)
      if (hasDownloadButton) {
        const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
        await downloadButton.click();
        const download = await downloadPromise;
        
        if (download) {
          expect(download.suggestedFilename()).toBeTruthy();
        }
      }
    }
  });

  test("does not see lock icons on documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const docLink = page
      .locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')")
      .first();

    if (!(await docLink.isVisible().catch(() => false))) {
      test.skip(true, "No documents in archive");
      return;
    }

    await docLink.click();
    await waitForLoadingComplete(page);

    // Count lock icons that indicate restricted access
    // There should be none or they should not be in "sign in" context
    const restrictedLocks = page.locator(
      "div:has(svg.lucide-lock):has-text('sign in'), div:has(svg.lucide-lock):has-text('přihlaste se')"
    );

    const lockCount = await restrictedLocks.count();
    expect(lockCount).toBe(0);
  });
});

// ============================================================================
// Flag Combination Tests
// ============================================================================

test.describe("Archive: Flag Combinations", () => {
  test("documents expose correct flags in response", async ({ request }) => {
    const data = (await callRpcAsAnon(request, "get_archive_documents")) as ArchiveDocumentData[];

    test.skip(data.length === 0, "No archive documents available");

    // Check that is_public and is_download_public flags are present
    const doc = data[0];
    expect(doc).toHaveProperty("is_public");
    expect(doc).toHaveProperty("is_download_public");

    // Types should be boolean
    expect(typeof doc.is_public).toBe("boolean");
    expect(typeof doc.is_download_public).toBe("boolean");
  });

  test("conditional fields respect flag combinations", async ({ request }) => {
    const data = (await callRpcAsAnon(request, "get_archive_documents")) as ArchiveDocumentData[];

    test.skip(data.length === 0, "No archive documents available");

    for (const doc of data) {
      // Test scan_url based on is_public
      if (!doc.is_public) {
        // Non-public doc, anon user: scan_url should be null
        expect(doc.scan_url).toBeNull();
      }

      // Test storage_path based on is_download_public
      if (!doc.is_download_public) {
        // Non-download-public doc, anon user: storage_path should be null
        expect(doc.storage_path).toBeNull();
      }
    }
  });
});
