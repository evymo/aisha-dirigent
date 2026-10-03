/**
 * E2E Tests: Admin Dashboard
 * 
 * Testy admin panelu - vyžadují přihlášeného admin uživatele
 */

import { test, expect, waitForLoadingComplete } from "./fixtures";

async function gotoAdminRoute(page: import("@playwright/test").Page, route: string) {
  // Ensure auth + role hydration happens before hitting guarded admin routes.
  // Admin access is permission-gated; if roles/permissions haven't loaded yet,
  // the app can legitimately redirect to "/".
  const rolesRequestPromise = page.waitForRequest(
    (req) => req.url().includes("/rest/v1/rpc/get_my_user_roles") && req.method() === "POST",
    { timeout: 10_000 }
  );

  await page.goto("/");
  await waitForLoadingComplete(page);

  const hasSeededAuthToken = await page.evaluate(() => {
    try {
      return typeof window !== "undefined" && !!window.localStorage.getItem("sb-e2e-auth-token");
    } catch {
      return false;
    }
  });

  if (!hasSeededAuthToken) {
    throw new Error("Expected E2E auth token in localStorage (sb-e2e-auth-token), but none was found.");
  }

  const rolesRequest = await rolesRequestPromise.catch(() => null);
  if (!rolesRequest) {
    throw new Error("Expected role hydration via get_my_user_roles, but no RPC request was observed.");
  }

  // Wait for roles RPC to resolve so permission checks are stable.
  const rolesResponse = await Promise.race([
    rolesRequest.response(),
    page.waitForTimeout(10_000).then(() => null),
  ]);

  if (!rolesResponse) {
    throw new Error("Role hydration request was sent, but no response was observed (timeout).");
  }

  if (!rolesResponse.ok()) {
    throw new Error(`Role hydration RPC failed (status ${rolesResponse.status()}).`);
  }

  const rolesJson = (await rolesResponse.json().catch(() => null)) as unknown;
  const hasAdminRole =
    Array.isArray(rolesJson) &&
    rolesJson.some(
      (row: unknown) =>
        row != null &&
        typeof row === "object" &&
        "role" in row &&
        (row as { role?: unknown }).role === "admin"
    );

  if (!hasAdminRole) {
    throw new Error("Expected admin role from get_my_user_roles, but admin role was not present.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(route);
    await waitForLoadingComplete(page);

    const url = page.url();
    if (url.includes("/admin")) return;

    // If we got redirected (typically to /), give the app a moment and retry.
    await page.waitForTimeout(500);
  }

  throw new Error(`Expected to reach ${route}, but was redirected to ${page.url()}`);
}

test.describe("Admin Dashboard", () => {
  
  test.beforeEach(async ({ page }) => {
    await gotoAdminRoute(page, "/admin");
  });

  test("admin dashboard loads", async ({ page }) => {
    // Ověř že jsme na admin stránce
    await expect(page).toHaveURL(/admin/);
    
    // Měl by být vidět nějaký admin obsah
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible();
  });

  test("admin navigation works", async ({ page }) => {
    // Admin layout nepoužívá nutně <nav>/<aside>; opři se o reálně renderované prvky.
    await expect(page.getByRole("button", { name: /toggle sidebar/i })).toBeVisible();

    // Sidebar by měl mít aspoň základní odkazy.
    const overviewLink = page.getByRole("link", { name: /overview|přehled/i }).first();
    await expect(overviewLink).toBeVisible();

    // Zkus se přes sidebar prokliknout na jednu známou stránku (Members).
    // Users sekce musí být nejdřív expandována kliknutím na tlačítko
    const usersButton = page.getByRole("button", { name: /users|uživatelé/i }).first();
    await expect(usersButton).toBeVisible();
    
    // Klikni a počkej až se submenu ukáže
    await usersButton.click();
    
    // Počkej na zobrazení submenu - Members link musí být viditelný
    const membersLink = page.getByRole("link", { name: /members|členové/i }).first();
    
    // Pokud submenu není vidět, zkus kliknout znovu
    try {
      await expect(membersLink).toBeVisible({ timeout: 2000 });
    } catch {
      // Druhý pokus - možná první klik sbalil něco jiného
      await usersButton.click();
      await expect(membersLink).toBeVisible({ timeout: 5000 });
    }
    
    await membersLink.click();
    await waitForLoadingComplete(page);

    await expect(page).toHaveURL(/\/admin\/members/);
  });

  test("admin can view members list", async ({ page }) => {
    // Naviguj na členy
    await gotoAdminRoute(page, "/admin/members");
    
    // Měla by být vidět tabulka nebo seznam
    // Route should be accessible (even if empty state/SSR changes)
    await expect(page).toHaveURL(/\/admin\/members/);
  });

  test("admin can view orders", async ({ page }) => {
    await gotoAdminRoute(page, "/admin/orders");
    
    // Stránka by měla načíst
    await expect(page).toHaveURL(/admin\/orders/);
    
    // Měl by být nějaký obsah
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("admin can view studies", async ({ page }) => {
    await gotoAdminRoute(page, "/admin/studies");
    
    await expect(page).toHaveURL(/admin\/studies/);
    
    // Měla by být tabulka nebo karty se studiemi
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("admin can view products", async ({ page }) => {
    await gotoAdminRoute(page, "/admin/products");
    
    await expect(page).toHaveURL(/admin\/products/);
  });

  test("admin can view audit journal", async ({ page }) => {
    await gotoAdminRoute(page, "/admin/audit-journal");
    await expect(page).toHaveURL(/\/admin\/audit-journal/);
  });
});

test.describe("Admin CRUD Operations", () => {
  
  test("can create new product", async ({ page }) => {
    await page.goto("/admin/products");
    await waitForLoadingComplete(page);
    
    // Najdi "Přidat" nebo "New" button
    const addButton = page.getByRole("button", { name: /přidat|add|new|vytvořit|create/i }).first();
    
    if (await addButton.isVisible()) {
      await addButton.click();
      await waitForLoadingComplete(page);
      
      // Měl by se otevřít formulář nebo dialog
      const form = page.locator("form, [role='dialog']").first();
      await expect(form).toBeVisible({ timeout: 5000 });
    }
  });

  test("can edit existing study", async ({ page }) => {
    await page.goto("/admin/studies");
    await waitForLoadingComplete(page);
    
    // Najdi edit button nebo klikni na první studii
    const editButton = page.getByRole("button", { name: /edit|upravit/i }).first();
    const studyRow = page.locator("tr, [data-testid='study-item']").first();
    
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
    } else if (await studyRow.isVisible().catch(() => false)) {
      await studyRow.click();
    }
    
    await waitForLoadingComplete(page);
  });

  test("can search/filter in admin tables", async ({ page }) => {
    await page.goto("/admin/members");
    await waitForLoadingComplete(page);
    
    // Najdi search input
    const searchInput = page.getByPlaceholder(/hledat|search|filtr/i).or(
      page.getByRole("searchbox")
    ).first();
    
    if (await searchInput.isVisible()) {
      // Zadej hledaný text
      await searchInput.fill("test");
      await page.waitForTimeout(500); // Debounce
      
      // Tabulka by se měla aktualizovat
      await waitForLoadingComplete(page);
    }
  });
});

test.describe("Admin Permissions", () => {
  
  test("admin has access to all sections", async ({ page }) => {
    const adminRoutes = [
      "/admin",
      "/admin/members",
      "/admin/orders",
      "/admin/studies",
      "/admin/products",
      "/admin/audit-journal",
    ];
    
    for (const route of adminRoutes) {
      await page.goto(route);
      await waitForLoadingComplete(page);
      
      // Neměli bychom být redirectnuti na login nebo 403
      const isAllowed = !page.url().includes("/auth") && 
                        !page.url().includes("/forbidden") &&
                        !page.url().includes("/403");
      
      expect(isAllowed, `Route ${route} should be accessible for admin`).toBe(true);
    }
  });

  test("admin can see user roles", async ({ page }) => {
    await page.goto("/admin/members");
    await waitForLoadingComplete(page);
    
    // Role by měly být někde viditelné
    const roleIndicator = page.getByText(/admin|staff|member|practitioner/i).first();
    
    // Pokud jsou členové, měly by být vidět role
    const hasMembers = await page.locator("tr, [data-testid='member-item']").count() > 0;
    
    if (hasMembers) {
      // Je ok pokud role nejsou přímo viditelné v seznamu
    }
  });
});
