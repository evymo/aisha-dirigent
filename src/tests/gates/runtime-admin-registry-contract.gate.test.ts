/**
 * Gate — runtime admin registry contract (acceptance, written BEFORE the page, TDD).
 *
 * Providers + models have admin registry pages (AdminProviderRegistry,
 * AdminModelRegistry) but the co-equal RUNTIME axis has none — an operator can see
 * and toggle providers/models but never the discovered runtimes (direct_llm/
 * openclaw/hermes…). This gate locks the symmetry: a read RPC over ai_runtime_registry,
 * a routed page, and i18n-clean labels.
 *
 * RED until #5 (get_runtimes_admin + AdminRuntimeRegistry + route).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const RPC = read("aisha/db/sql/functions/get_runtimes_admin.sql");
const PAGE = read("src/pages/admin/AdminRuntimeRegistry.tsx");
const HOOK = read("src/hooks/useRuntimeRegistry.ts");
const ROUTER = read("src/router.tsx");

// The ai_runtime_registry fields an operator must see to manage runtimes.
const FIELDS = [
  "runtime_kind", "slug", "display_name", "is_enabled", "adapter_health",
  "can_write", "needs_network", "supports_tools", "side_effect_class",
  "autonomy_class", "consecutive_failure_count", "adapter_health_checked_at",
];

describe("runtime admin registry contract (symmetry with provider/model registries)", () => {
  describe("get_runtimes_admin read RPC", () => {
    it("exists + SECURITY DEFINER + is_admin_or_staff gated", () => {
      expect(RPC).toMatch(/CREATE OR REPLACE FUNCTION public\.get_runtimes_admin/i);
      expect(RPC).toMatch(/SECURITY DEFINER/i);
      expect(RPC, "admin read RPC must gate on is_admin_or_staff()").toMatch(/is_admin_or_staff/);
    });

    for (const f of FIELDS) {
      it(`exposes '${f}' (operator needs it to manage the runtime)`, () => {
        expect(RPC, `get_runtimes_admin drops '${f}'`).toMatch(new RegExp(`\\b${f}\\b`));
      });
    }
  });

  describe("AdminRuntimeRegistry page + wiring", () => {
    it("the page exists", () => {
      expect(PAGE.length, "src/pages/admin/AdminRuntimeRegistry.tsx missing").toBeGreaterThan(0);
    });

    it("is i18n-driven (useTranslation, no hardcoded user-facing strings)", () => {
      expect(PAGE).toMatch(/useTranslation/);
    });

    it("activate/deactivate goes through update_runtime_admin_audited (the existing audited write)", () => {
      expect(PAGE + HOOK, "page/hook must call update_runtime_admin_audited").toMatch(/update_runtime_admin_audited/);
    });

    it("reads the runtimes via get_runtimes_admin", () => {
      expect(PAGE + HOOK).toMatch(/get_runtimes_admin/);
    });

    it("is lazy-imported + routed in router.tsx (next to provider/model registries)", () => {
      expect(ROUTER).toMatch(/AdminRuntimeRegistry/);
      expect(ROUTER).toMatch(/runtime-registry/);
    });
  });
});
