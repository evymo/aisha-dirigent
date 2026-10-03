/**
 * E3 — RuntimeAdapter ↔ runtime-registry drift guard (code ↔ seed).
 *
 * THE GATE IS THE SPEC. The RUNTIME_ADAPTERS map in adapters.ts is the CODE half
 * of the executor axis: every key is a runtime this process can actually run work
 * through. `aisha/db/seed/core/18_ai_runtime_catalog.sql` is the REGISTRY half:
 * one row per executor AISHA may hand a clow to. selfRegisterRuntimes() reconciles
 * the two on boot via `update_runtime_admin_audited(p_slug => runtime)` — so an
 * adapter whose runtime slug has NO seeded registry row can never be enabled or
 * health-reconciled: it would self-register against a row that does not exist, and
 * fn_runtime_available could never DERIVE it. That is silent non-functionality —
 * a runtime that looks shippable in code but is invisible to the resolver.
 *
 * The invariant: every key of RUNTIME_ADAPTERS has a corresponding seeded slug in
 * the runtime catalog. The 'cli' key is a generic runtime KIND — it matches any
 * seeded 'cli:<tool>' slug (e.g. 'cli:claude-cli'), since the one cli adapter
 * enqueues for every registered CLI. (The reverse is intentionally NOT required —
 * the seed legitimately carries registry-only runtimes whose adapter lives
 * elsewhere: 'workflow' is dispatched by n8n, 'human' by the Mission-Control
 * inbox. Those have rows without an in-process RuntimeAdapter, which is fine; an
 * adapter without a row is the drift this gate forbids.)
 *
 * Static / file-only (no DB, no network — safe for pre-push).
 *
 * Pairs with `runtime-availability-no-allowlist.gate.test.ts` (availability is
 * derived per-entity, not allow-listed) and `hermes-learning-loop.gate.test.ts`
 * (the hermes rail's advisory-only invariant).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ADAPTERS_TS =
  "services/svc-ai-chat/src/reflection/runtime/adapters.ts";
const RUNTIME_SEED = "aisha/db/seed/core/18_ai_runtime_catalog.sql";

/**
 * Parse the runtime keys from the RUNTIME_ADAPTERS object literal in adapters.ts.
 * Shape:
 *   export const RUNTIME_ADAPTERS: Record<string, RuntimeAdapter> = {
 *     direct_llm: directLlmAdapter,
 *     openclaw: openclawAdapter,
 *     ...
 *   };
 * We slice the object body (first `{` after the declaration to its matching `}`)
 * and pull each `<key>:` so the gate reads the REAL code map, never a hand-kept
 * mirror that could drift behind it.
 */
function parseAdapterRuntimeKeys(): string[] {
  const src = read(ADAPTERS_TS);
  const declStart = src.indexOf("RUNTIME_ADAPTERS");
  expect(
    declStart,
    `RUNTIME_ADAPTERS declaration must exist in ${ADAPTERS_TS}`,
  ).toBeGreaterThanOrEqual(0);

  const open = src.indexOf("{", declStart);
  expect(
    open,
    "RUNTIME_ADAPTERS object literal '{' not found",
  ).toBeGreaterThan(declStart);

  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  expect(close, "unbalanced RUNTIME_ADAPTERS object literal").toBeGreaterThan(open);

  const body = src.slice(open + 1, close);
  // Each entry is `key: adapterIdentifier`. Keys are bare identifiers (slugs are
  // snake_case / contain ':' only in seed form, never as object keys here).
  const keys = [...body.matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1]);
  return keys;
}

/**
 * Collect every seeded runtime slug from the ai_runtime_registry INSERT. The seed
 * lays each runtime out as `('<slug>', '<display_name>', ...)`, so the slug is the
 * first single-quoted literal of each VALUES tuple. We match `('<slug>'` to avoid
 * picking up the display-name / notes strings.
 */
function parseSeededSlugs(): string[] {
  const sql = read(RUNTIME_SEED);
  // Anchor on the INSERT INTO ... ai_runtime_registry block so we never read a
  // slug literal from the audit-journal tail.
  const insertAt = sql.search(/INSERT\s+INTO\s+public\.ai_runtime_registry/i);
  expect(
    insertAt,
    `seed must INSERT INTO public.ai_runtime_registry: ${RUNTIME_SEED}`,
  ).toBeGreaterThanOrEqual(0);

  // Stop at the ON CONFLICT clause — slugs only appear in the VALUES list.
  const onConflict = sql.indexOf("ON CONFLICT", insertAt);
  const valuesBlock =
    onConflict > insertAt ? sql.slice(insertAt, onConflict) : sql.slice(insertAt);

  // First quoted literal opening each tuple: `('<slug>'`.
  const slugs = [
    ...valuesBlock.matchAll(/\(\s*'([a-z0-9:_-]+)'\s*,/gi),
  ].map((m) => m[1]);
  return [...new Set(slugs)];
}

describe("E3 — RuntimeAdapter ↔ runtime-registry drift (code ↔ seed)", () => {
  it("parses a non-empty RUNTIME_ADAPTERS map (sanity: the parse is wired)", () => {
    const keys = parseAdapterRuntimeKeys();
    expect(
      keys.length,
      "expected to parse the RUNTIME_ADAPTERS object keys from adapters.ts",
    ).toBeGreaterThan(0);
    // The map's keys must match the adapters' own declared `runtime` field — but
    // at minimum the known core executors must be present so a renamed key can't
    // silently empty the comparison.
    expect(keys).toContain("direct_llm");
  });

  it("parses a non-empty seeded slug set (sanity: the seed parse is wired)", () => {
    const slugs = parseSeededSlugs();
    expect(
      slugs.length,
      "expected to parse seeded runtime slugs from 18_ai_runtime_catalog.sql",
    ).toBeGreaterThan(0);
    expect(slugs).toContain("direct_llm");
  });

  it("every RUNTIME_ADAPTERS key has a seeded runtime slug (no orphan adapter)", () => {
    const adapterKeys = parseAdapterRuntimeKeys();
    const seededSlugs = new Set(parseSeededSlugs());

    const orphans = adapterKeys.filter((k) => {
      if (seededSlugs.has(k)) return false;
      // 'cli' is a generic runtime KIND, not a literal slug: the registry carries
      // cli:<tool> rows (e.g. slug='cli:claude-cli'). The single 'cli' adapter
      // dispatches ANY such row, so the key is satisfied by any seeded 'cli:*'
      // slug — mirrors fn_runtime_available (kind='cli' → slug='cli:'||cli_slug)
      // and fn_resolve_runtime's explicit-slug cli clause.
      if (k === "cli") return ![...seededSlugs].some((s) => s.startsWith("cli:"));
      return true;
    });
    expect(
      orphans,
      "Every in-process RuntimeAdapter must have a corresponding seeded row in " +
        `${RUNTIME_SEED} — selfRegisterRuntimes() reconciles by slug, and ` +
        "fn_runtime_available can only DERIVE a runtime the registry knows. " +
        "Orphan adapter key(s) with no seeded slug: " +
        orphans.join(", ") +
        `.\n  adapter keys: [${adapterKeys.join(", ")}]` +
        `\n  seeded slugs: [${[...seededSlugs].join(", ")}]`,
    ).toEqual([]);
  });
});
