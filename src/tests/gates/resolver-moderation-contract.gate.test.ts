/**
 * Gate — resolver moderation contract (PR-D, written BEFORE the fix, TDD).
 *
 * Discovery (PR-C) populates ai_model_registry with eval_status='pending'. The
 * resolvers (aisha_resolve_clow_backend, get_adaptive_model_tiers) filter only
 * is_available + is_deprecated — they IGNORE moderation, so an admin-REJECTED model
 * is still resolvable. This locks the moderation filter:
 *
 *   - exclude eval_status='rejected' (the admin reject verdict) …
 *   - …UNLESS is_admin_active (an explicit admin force-activate override).
 *
 * is_admin_active must NOT be a sole AND-gate: it DEFAULTS false and the seed never
 * sets it, so requiring it would exclude EVERY model and brick resolution. The
 * filter is auto-setup-safe: a pending/discovered model stays resolvable.
 *
 * RED until both resolvers carry the filter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const RESOLVE = read("aisha/db/sql/functions/aisha_resolve_clow_backend.sql");
const TIERS = read("aisha/db/sql/functions/get_adaptive_model_tiers.sql");
const MODEL_TABLE = read("aisha/db/sql/tables/ai_model_registry.sql");

// The filter pattern: exclude rejected unless admin-force-activated.
const REJECT_FILTER = /eval_status\s*<>\s*'rejected'\s*OR\s+\S*is_admin_active/i;

describe("resolver moderation contract", () => {
  it("sanity: is_admin_active DEFAULTs false (so it can never be a sole AND-gate)", () => {
    expect(MODEL_TABLE).toMatch(/is_admin_active\s+boolean\s+DEFAULT\s+false/i);
  });

  describe("aisha_resolve_clow_backend honors moderation", () => {
    it("excludes eval_status='rejected' (unless is_admin_active override)", () => {
      expect(RESOLVE, "resolver must exclude admin-rejected models").toMatch(REJECT_FILTER);
    });
    it("does NOT hard-require is_admin_active alone (would exclude all default-false models)", () => {
      expect(
        RESOLVE,
        "is_admin_active must be an OR-override, never a sole AND r.is_admin_active gate",
      ).not.toMatch(/AND\s+\w*\.?is_admin_active\s*(?:=\s*true)?\s*(?:AND|\n|\))/i);
    });
  });

  describe("get_adaptive_model_tiers honors moderation", () => {
    it("excludes eval_status='rejected' (unless is_admin_active override)", () => {
      expect(TIERS, "tier resolver must exclude admin-rejected models").toMatch(REJECT_FILTER);
    });
  });
});
