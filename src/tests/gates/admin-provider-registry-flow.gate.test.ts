/**
 * AdminProviderRegistry Flow — Gate Tests
 *
 * Locks in structural contract for the operator-visibility UI loop:
 *   1. SoT RPCs exist (get_provider_registry_admin + update_provider_admin)
 *      with is_admin_or_staff() gate
 *   2. Migration registers both RPCs with proper auth/grants
 *   3. useProviderRegistry hook exists with Zod schemas + admin gate
 *   4. AdminProviderRegistry page exists with required UI elements
 *   5. Route registered in router.tsx at /admin/provider-registry
 *   6. i18n keys present in EN + CS admin segments
 *
 * Without all pieces wired, operator can see provider health data flowing
 * into DB (via PR #79 WF_PROVIDER_HEALTH_PROBE) but has no UI to inspect
 * or act on it.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("AdminProviderRegistry Flow — structural integrity", () => {
  // ── SoT layer ──────────────────────────────────────────────────────────────
  it("SoT: get_provider_registry_admin.sql exists with admin gate + grants", () => {
    const sot = readFile(
      "aisha/db/sql/functions/get_provider_registry_admin.sql",
    );
    expect(sot.length, "SoT must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(
      stripSqlComments(sot),
      "must gate on is_admin_or_staff() — only operators can see catalog",
    ).toMatch(/is_admin_or_staff\(\)/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+authenticated/);
  });

  it("SoT: get_provider_registry_admin sorts by is_enabled DESC, then health rank, then slug", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_provider_registry_admin.sql",
    ));
    // Most-relevant rows (enabled + healthy) at top
    expect(sot).toMatch(/ORDER\s+BY[\s\S]+is_enabled\s+DESC/);
    expect(sot, "health rank case expression required").toMatch(/CASE\s+p\.last_health_status[\s\S]+'healthy'[\s\S]+'degraded'[\s\S]+'down'/);
  });

  it("SoT: update_provider_admin.sql exists with admin gate + audit", () => {
    const sot = readFile(
      "aisha/db/sql/functions/update_provider_admin.sql",
    );
    expect(sot.length).toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/is_admin_or_staff\(\)/);
    expect(
      stripSqlComments(sot),
      "writes audit_journal action='PROVIDER_UPDATED' so operator history is visible",
    ).toMatch(/INSERT\s+INTO\s+audit_journal[\s\S]+'PROVIDER_UPDATED'/);
  });

  it("SoT: update_provider_admin uses FOR UPDATE row lock", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_provider_admin.sql",
    ));
    expect(
      sot,
      "row lock prevents race between concurrent toggle requests",
    ).toMatch(/FROM\s+ai_provider_registry[\s\S]+FOR\s+UPDATE/);
  });

  it("SoT: update_provider_admin ONLY mutates is_enabled + notes (not endpoint/auth)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_provider_admin.sql",
    ));
    // The UPDATE clause must NOT touch endpoint_url, auth_env_var, backend_kind —
    // those require coordinated env + compose changes; operator shouldn't
    // edit them at runtime.
    const updateClause = sot.match(/UPDATE\s+ai_provider_registry[\s\S]+?WHERE/);
    expect(updateClause).not.toBeNull();
    const updateText = updateClause![0];
    expect(updateText, "must NOT modify endpoint_url at runtime").not.toMatch(/endpoint_url\s*=/);
    expect(updateText, "must NOT modify auth_env_var at runtime").not.toMatch(/auth_env_var\s*=/);
    expect(updateText, "must NOT modify backend_kind at runtime").not.toMatch(/backend_kind\s*=/);
    // Allowed: is_enabled + notes + updated_at
    expect(updateText).toMatch(/is_enabled\s*=/);
    expect(updateText).toMatch(/notes\s*=/);
  });

  // ── Migration layer ──────────────────────────────────────────────────────
  it("SoT: admin provider registry RPCs defined in canonical function files", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_provider_registry_admin.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/update_provider_admin.sql");
    expect(mig.length).toBeGreaterThan(100);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_provider_registry_admin/);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.update_provider_admin/);
  });

  it("SoT: grants do NOT include 'anon' (admin-only catalog)", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_provider_registry_admin.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/update_provider_admin.sql");
    const grants = mig.match(/GRANT\s+EXECUTE[\s\S]+?;/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(2);
    for (const grant of grants) {
      expect(grant, `must NOT include 'anon': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+anon\b/);
    }
  });

  // ── Hook layer ──────────────────────────────────────────────────────────
  it("Hook: useProviderRegistry exports query + mutation hooks", () => {
    const src = readFile("src/hooks/useProviderRegistry.ts");
    expect(src.length, "hook file must exist").toBeGreaterThan(100);
    expect(src).toMatch(/export\s+function\s+useProviderRegistry\b/);
    expect(src).toMatch(/export\s+function\s+useUpdateProvider\b/);
    expect(src, "must export ProviderRegistryRow type").toMatch(/export\s+type\s+ProviderRegistryRow\b/);
  });

  it("Hook: useProviderRegistry uses Zod schema for runtime validation", () => {
    const src = readFile("src/hooks/useProviderRegistry.ts");
    expect(src, "Zod schema must wrap response data").toMatch(/z\.array\(ProviderRegistryRowSchema\)\.parse/);
  });

  it("Hook: useProviderRegistry gates on view_admin_dashboard permission", () => {
    const src = readFile("src/hooks/useProviderRegistry.ts");
    expect(
      src,
      "must check view_admin_dashboard permission — UI is admin-only mirror of SQL gate",
    ).toMatch(/hasPermission\(["']view_admin_dashboard["']\)/);
  });

  it("Hook: useUpdateProvider invalidates provider-registry queries on success", () => {
    const src = readFile("src/hooks/useProviderRegistry.ts");
    expect(
      src,
      "mutation must invalidate ['provider-registry'] so UI refreshes immediately",
    ).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\[["']provider-registry["']\]\s*\}\s*\)/);
  });

  // ── Page layer ─────────────────────────────────────────────────────────
  it("Page: AdminProviderRegistry.tsx exists with default export", () => {
    const src = readFile("src/pages/admin/AdminProviderRegistry.tsx");
    expect(src.length).toBeGreaterThan(100);
    expect(src).toMatch(/export\s+default\s+function\s+AdminProviderRegistry/);
  });

  it("Page: AdminProviderRegistry uses both hook exports", () => {
    const src = readFile("src/pages/admin/AdminProviderRegistry.tsx");
    expect(src).toMatch(/useProviderRegistry/);
    expect(src).toMatch(/useUpdateProvider/);
  });

  // ── Router layer ───────────────────────────────────────────────────────
  it("Router: /admin/provider-registry route registered", () => {
    const router = readFile("src/router.tsx");
    expect(router).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/admin\/AdminProviderRegistry["']\)\)/);
    expect(router).toMatch(/path=["']provider-registry["']/);
  });

  // ── i18n layer ─────────────────────────────────────────────────────────
  it("i18n: EN admin.json has providerRegistry block with required keys", () => {
    const en = JSON.parse(readFile("src/i18n/segments/en/admin.json"));
    const block = en.admin?.providerRegistry;
    expect(block, "admin.providerRegistry block missing in EN").toBeDefined();
    const requiredKeys = [
      "title", "description",
      "total", "enabled", "healthy", "degraded", "down",
      "filters", "backendKind", "enabledOnly",
      "providers", "slug", "health", "lastChecked", "capabilities", "cost", "enabledColumn",
      "tools", "vision", "batch", "streaming",
      "toggleEnabled", "noProviders",
      "enabledMessage", "disabledMessage",
    ];
    for (const k of requiredKeys) {
      expect(block[k], `EN admin.providerRegistry.${k} missing`).toBeDefined();
    }
  });

  it("i18n: CS admin.json has providerRegistry block with same keys as EN", () => {
    const en = JSON.parse(readFile("src/i18n/segments/en/admin.json"));
    const cs = JSON.parse(readFile("src/i18n/segments/cs/admin.json"));
    const enKeys = Object.keys(en.admin?.providerRegistry ?? {});
    const csKeys = Object.keys(cs.admin?.providerRegistry ?? {});
    const missing = enKeys.filter((k) => !csKeys.includes(k));
    expect(
      missing,
      `CS admin.providerRegistry missing keys: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
