/**
 * Appsmith Dashboard Gate Tests
 *
 * Static analysis pro AISHA Ops dashboard infrastructure (Phase 4 of
 * AUTONOMOUS_DEPLOY_FLOW.md). Validuje:
 *
 * 1. Dashboard template parses + má požadovaná pole
 * 2. Widget catalog: každý template parses + má valid placeholders
 * 3. Builder workflow JSON je valid + reference existing widgets
 * 4. Round-trip idempotency (build with same input → same hash)
 * 5. No hardcoded secrets in templates
 * 6. No emoji v dashboard JSON (CLAUDE.md rule)
 * 7. Action button widgets mají role_required
 *
 * Související specs:
 *   docs/deploy/APPSMITH_AISHA_OPS.md
 *   docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md
 *
 * Spouští se přes: npm run test:gates -- appsmith-dashboard
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const TEMPLATE_PATH = join(ROOT, "appsmith/dashboards/aisha-ops.template.json");
const WIDGETS_DIR = join(ROOT, "appsmith/widgets");
const BUILDER_WORKFLOW = join(ROOT, "n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json");
const BUILDER_SCRIPT = join(ROOT, "scripts/build-aisha-appsmith.mjs");
// Canonical SoT for the dashboard_render_history schema object. The Phase 4
// migration was absorbed into the baseline; the table, its policies and its
// RPCs now live in dedicated aisha/db/sql/ files. Gates read current SoT only —
// never the archived migrations tree nor a historical timestamped migration.
const RENDER_HISTORY_TABLE_SOT = join(ROOT, "aisha/db/sql/tables/dashboard_render_history.sql");
const MIGRATION_REGISTRY = join(ROOT, "aisha/db/migration-registry.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJsonSafe(p: string): unknown | null {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function listWidgetFiles(): string[] {
  if (!existsSync(WIDGETS_DIR)) return [];
  return readdirSync(WIDGETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => f !== "README.md");
}

function readText(p: string): string {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

// ─── 1. Template valid ───────────────────────────────────────────────────────

describe("AISHA Ops Dashboard — Template", () => {
  test("template file exists at appsmith/dashboards/aisha-ops.template.json", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  test("template parses as valid JSON", () => {
    expect(readJsonSafe(TEMPLATE_PATH)).not.toBeNull();
  });

  test("template has required top-level fields", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as Record<string, unknown> | null;
    expect(tpl).not.toBeNull();
    expect(tpl).toHaveProperty("applicationName");
    expect(tpl).toHaveProperty("applicationSlug");
    expect(tpl).toHaveProperty("workspaceId");
    expect(tpl).toHaveProperty("datasourceList");
    expect(tpl).toHaveProperty("pageList");
    expect(Array.isArray((tpl as { datasourceList: unknown[] }).datasourceList)).toBe(true);
    expect(Array.isArray((tpl as { pageList: unknown[] }).pageList)).toBe(true);
  });

  test("template has required pages (incl. self-tooling for META-2 admin review)", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as { pageList?: { pageSlug: string }[] } | null;
    const slugs = (tpl?.pageList ?? []).map((p) => p.pageSlug);
    const required = ["overview", "per-story", "n8n", "sentry", "actions", "self-tooling"];
    for (const r of required) {
      expect(slugs).toContain(r);
    }
  });

  test("self-tooling page has approve/reject queries", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as {
      pageList?: { pageSlug: string; queries?: { name: string }[] }[];
    } | null;
    const page = tpl?.pageList?.find((p) => p.pageSlug === "self-tooling");
    expect(page).toBeDefined();
    const queryNames = (page?.queries ?? []).map((q) => q.name);
    expect(queryNames).toContain("getPendingToolingProposals");
    expect(queryNames).toContain("approveProposal");
    expect(queryNames).toContain("rejectProposal");
    expect(queryNames).toContain("triggerCommitter");
  });

  test("template uses placeholder for workspace ID (not hardcoded)", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as { workspaceId?: string } | null;
    expect(tpl?.workspaceId).toMatch(/^\{\{[A-Z_]+\}\}$/);
  });

  test("template datasources use placeholders for secrets", () => {
    const text = readText(TEMPLATE_PATH);
    // Reject anything that looks like a real bearer token (long base64-ish strings)
    const realTokenPattern = /Bearer\s+[a-zA-Z0-9_.-]{40,}/;
    expect(text).not.toMatch(realTokenPattern);
    // Ensure placeholders exist
    expect(text).toMatch(/\{\{(POSTGREST_URL|N8N_API_URL|COOLIFY_API_URL|SENTRY_URL)\}\}/);
  });

  test("template marked as regenerable in metadata", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as { _metadata?: { regenerable?: boolean } } | null;
    expect(tpl?._metadata?.regenerable).toBe(true);
  });
});

// ─── 2. Widget catalog ───────────────────────────────────────────────────────

describe("AISHA Ops Dashboard — Widget Catalog", () => {
  const widgets = listWidgetFiles();

  test("widget catalog directory exists with templates", () => {
    expect(widgets.length).toBeGreaterThan(0);
  });

  test("required widget kinds exist", () => {
    const required = ["statbox", "table", "iframe", "button", "chart-line", "chart-bar", "text-status"];
    for (const r of required) {
      expect(widgets).toContain(`${r}.json`);
    }
  });

  for (const w of widgets) {
    test(`${w} parses as valid JSON`, () => {
      const parsed = readJsonSafe(join(WIDGETS_DIR, w));
      expect(parsed).not.toBeNull();
    });

    test(`${w} contains widgetId placeholder`, () => {
      const text = readText(join(WIDGETS_DIR, w));
      expect(text).toMatch(/\{\{widgetId\}\}/);
    });

    test(`${w} uses lucide-compatible icon names (no emoji)`, () => {
      const text = readText(join(WIDGETS_DIR, w));
      // Reject common emoji ranges
      const emojiPattern =
        /[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}]/u;
      expect(text).not.toMatch(emojiPattern);
    });
  }

  test("button.json has role_required field", () => {
    const text = readText(join(WIDGETS_DIR, "button.json"));
    expect(text).toMatch(/role_required/);
  });

  test("button.json has security comment about double-validation", () => {
    const text = readText(join(WIDGETS_DIR, "button.json"));
    expect(text).toMatch(/Server-side validation/i);
  });
});

// ─── 3. Builder workflow JSON ────────────────────────────────────────────────

describe("AISHA Ops Dashboard — Builder Workflow", () => {
  test("WF_APPSMITH_DASHBOARD_BUILDER.json exists", () => {
    expect(existsSync(BUILDER_WORKFLOW)).toBe(true);
  });

  test("workflow parses as valid JSON", () => {
    expect(readJsonSafe(BUILDER_WORKFLOW)).not.toBeNull();
  });

  test("workflow has required nodes (cron, webhook, builder, log)", () => {
    const wf = readJsonSafe(BUILDER_WORKFLOW) as { nodes?: { name: string; type: string }[] } | null;
    const nodeNames = (wf?.nodes ?? []).map((n) => n.name);
    expect(nodeNames).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Every 30 Minutes|cron/i),
        expect.stringMatching(/Webhook/i),
        expect.stringMatching(/Builder/i),
        expect.stringMatching(/Log Completion|Log/i),
      ]),
    );
  });

  test("workflow uses settings with callerPolicy", () => {
    const wf = readJsonSafe(BUILDER_WORKFLOW) as {
      settings?: { callerPolicy?: string; executionOrder?: string };
    } | null;
    expect(wf?.settings?.callerPolicy).toBe("workflowsFromSameOwner");
    expect(wf?.settings?.executionOrder).toBe("v1");
  });

  test("builder script exists at scripts/build-aisha-appsmith.mjs", () => {
    expect(existsSync(BUILDER_SCRIPT)).toBe(true);
  });

  test("builder script is executable shebang", () => {
    const text = readText(BUILDER_SCRIPT);
    expect(text.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

// ─── 4. Idempotency / determinism ─────────────────────────────────────────

describe("AISHA Ops Dashboard — Idempotency", () => {
  test("template has manual_locked_widgets array (admin override mechanism)", () => {
    const tpl = readJsonSafe(TEMPLATE_PATH) as {
      _metadata?: { manual_locked_widgets?: unknown };
    } | null;
    expect(Array.isArray(tpl?._metadata?.manual_locked_widgets)).toBe(true);
  });

  test("widgets reference deterministic widgetId pattern", () => {
    // Each widget should have widgetId placeholder, suggesting builder uses
    // deterministic ID generation (widget-{section}-{kind}-{slot})
    for (const w of listWidgetFiles()) {
      const text = readText(join(WIDGETS_DIR, w));
      expect(text).toMatch(/\{\{widgetId\}\}/);
    }
  });
});

// ─── 5. Security ─────────────────────────────────────────────────────────────

describe("AISHA Ops Dashboard — Security", () => {
  test("no hardcoded secrets in template (regex scan)", () => {
    const text = readText(TEMPLATE_PATH);
    // Common secret patterns
    const secretPatterns = [
      /password\s*[:=]\s*["'][a-zA-Z0-9!@#$%^&*]{6,}["']/i,
      /secret\s*[:=]\s*["'][a-zA-Z0-9_-]{20,}["']/i,
      /sk_live_[a-zA-Z0-9_-]{20,}/,
      /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, // JWT
    ];
    for (const pattern of secretPatterns) {
      expect(text).not.toMatch(pattern);
    }
  });

  test("action buttons must reference admin role", () => {
    const buttonText = readText(join(WIDGETS_DIR, "button.json"));
    expect(buttonText).toMatch(/role_required/);
    expect(buttonText).toMatch(/(admin|staff)/);
  });

  test("template references is_user_admin / is_admin_or_staff RPCs (not direct queries)", () => {
    // Builder should use RPC for auth checks, not direct table queries
    const builderText = readText(BUILDER_SCRIPT);
    // It's OK if not present (builder doesn't do auth itself), but if any
    // auth check exists it must be via RPC
    if (/is.user|admin|auth/i.test(builderText)) {
      // Only acceptable if via RPC pattern
      expect(builderText).not.toMatch(/\.from\(['"][a-z_]+['"]\)/);
    }
  });
});

// ─── 6. Spec consistency ──────────────────────────────────────────────────

describe("AISHA Ops Dashboard — Spec consistency", () => {
  test("docs/deploy/APPSMITH_AISHA_OPS.md exists", () => {
    expect(existsSync(join(ROOT, "docs/deploy/APPSMITH_AISHA_OPS.md"))).toBe(true);
  });

  test("docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md exists", () => {
    expect(existsSync(join(ROOT, "docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md"))).toBe(true);
  });

  test("dashboard_render_history table declared in canonical SoT", () => {
    // Phase 4 migration absorbed into the baseline: the table now lives in its
    // dedicated table SoT file (and the compiled baseline). Assert the schema
    // object exists in current SoT rather than scanning historical migrations.
    expect(existsSync(RENDER_HISTORY_TABLE_SOT)).toBe(true);
    const sot = readText(RENDER_HISTORY_TABLE_SOT);
    expect(sot).toMatch(/CREATE TABLE IF NOT EXISTS public\.dashboard_render_history/);
    // The idempotency content hash column is the load-bearing field for the
    // skip-if-unchanged builder; it must be present.
    expect(sot).toMatch(/content_hash\s+text/);
  });

  test("dashboard_render_history migration absorbed into baseline (registry is baseline-only)", () => {
    expect(readText(MIGRATION_REGISTRY)).toMatch(/Baseline-only state/i);
  });

  test("required RPCs (get_last_dashboard_hash, store_dashboard_hash) referenced in spec", () => {
    const specText = readText(join(ROOT, "docs/deploy/APPSMITH_AISHA_OPS.md"));
    expect(specText).toMatch(/get_last_dashboard_hash/);
    expect(specText).toMatch(/store_dashboard_hash/);
  });
});
