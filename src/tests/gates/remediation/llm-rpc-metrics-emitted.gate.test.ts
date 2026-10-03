/**
 * Gate (remediation OBS-02-metrics-producers): the two most business-critical
 * Prometheus counters defined by @aisha/observability MUST have at least one
 * PRODUCER in the codebase — code that actually calls `.inc()` on them.
 *
 * Contract:
 *   - `aisha_llm_calls_total` (exported as `llmCalls`) must be incremented
 *     somewhere under packages/llm-dispatch/src — the single dispatch seam
 *     through which every LLM provider call flows. Without a producer here the
 *     LLM-cost / usage dashboards are permanently empty.
 *   - `aisha_rpc_calls_total` (exported as `rpcCalls`) must be incremented in
 *     the shared RPC layer — packages/api-core/src or the shared rpc adapter
 *     (src/lib/rpcAdapter.ts and friends). Without a producer here the RPC
 *     volume / error dashboards are permanently empty.
 *
 * As a class check, this gate also SCANS the whole tree for ANY producer of
 * these counters (`.inc(` on `llmCalls` / `rpcCalls`, by symbol or by metric
 * name) outside packages/observability itself (where they are DEFINED, not
 * produced) and outside test files. This surfaces siblings we overlooked.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd): both
 * counters are defined in packages/observability/src/metrics.ts and incremented
 * NOWHERE except packages/observability/src/__tests__/metrics.test.ts. Every
 * service calls `createAishaMetrics()` but only ever emits requestDuration via
 * mountMetrics — the llmCalls and rpcCalls counters stay at zero, so the cost
 * dashboards render empty.
 *
 * After the fix (llm-dispatch increments llmCalls on each provider call; the
 * rpc adapter increments rpcCalls on each RPC) this gate goes green. Do NOT
 * relax the assertions — wire the producers.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** Directories that DEFINE the counters (not producers) — always excluded. */
const DEFINER_DIR = "packages/observability";

/** Roots to walk when scanning for producers across the whole tree. */
const SCAN_ROOTS = ["packages", "services", "src", "aisha"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  "__snapshots__",
]);

function isTestFile(rel: string): boolean {
  return (
    /\.(test|spec)\.[cm]?tsx?$/.test(rel) ||
    rel.includes("/__tests__/") ||
    rel.includes("/tests/") ||
    rel.includes("/__mocks__/")
  );
}

/** Recursively collect .ts/.tsx source files under a dir (excluding junk). */
function walk(absDir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, acc);
    } else if (/\.[cm]?tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      acc.push(abs);
    }
  }
}

function collectSources(): string[] {
  const acc: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (existsSync(abs)) walk(abs, acc);
  }
  return acc;
}

/** Strip comments so a commented-out `.inc()` doesn't count as a producer. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Does `src` increment the given counter? Matches either the symbol form
 * (`llmCalls.inc(` / `rpcCalls.inc(`, allowing an object prefix like
 * `metrics.llmCalls.inc(` or `this.metrics.rpcCalls.inc(`) or a metric-name
 * literal followed by an `.inc(` (defensive: a getSingleMetric()-style lookup).
 */
function incrementsCounter(src: string, symbol: string, metricName: string): boolean {
  const clean = stripComments(src);
  const bySymbol = new RegExp(`\\b${symbol}\\s*\\.\\s*inc\\s*\\(`);
  if (bySymbol.test(clean)) return true;
  // metric-name-literal path: '...aisha_llm_calls_total...' near an .inc(
  const nameEsc = metricName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byName = new RegExp(`['"\`]${nameEsc}['"\`][\\s\\S]{0,200}?\\.\\s*inc\\s*\\(`);
  return byName.test(clean);
}

interface CounterSpec {
  symbol: string;
  metricName: string;
  /** Path prefixes (repo-relative) where a producer is contractually required. */
  requiredIn: string[];
}

const COUNTERS: CounterSpec[] = [
  {
    symbol: "llmCalls",
    metricName: "aisha_llm_calls_total",
    requiredIn: ["packages/llm-dispatch/src"],
  },
  {
    symbol: "rpcCalls",
    metricName: "aisha_rpc_calls_total",
    // Shared RPC layer: the api-core client and/or the platform rpc adapter.
    requiredIn: ["packages/api-core/src", "src/lib/rpcAdapter", "src/lib/rpc"],
  },
];

describe("observability counters must have producers (OBS-02)", () => {
  const sources = collectSources();

  test("scan collected a non-trivial set of source files", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  for (const spec of COUNTERS) {
    test(`${spec.metricName} (${spec.symbol}) is incremented outside observability + tests`, () => {
      const producers = sources
        .filter((abs) => {
          const rel = relative(ROOT, abs).replace(/\\/g, "/");
          if (rel.startsWith(DEFINER_DIR)) return false;
          if (isTestFile(rel)) return false;
          return incrementsCounter(readFileSync(abs, "utf-8"), spec.symbol, spec.metricName);
        })
        .map((abs) => relative(ROOT, abs).replace(/\\/g, "/"))
        .sort();

      expect(
        producers.length,
        `No producer found for ${spec.metricName}. The counter is defined in ` +
          `${DEFINER_DIR} but incremented nowhere in production code, so its ` +
          `dashboards are empty. Wire a \`${spec.symbol}.inc(...)\` call at the ` +
          `emission seam (${spec.requiredIn.join(" | ")}).`,
      ).toBeGreaterThan(0);
    });

    test(`${spec.metricName} has a producer in its contractual layer (${spec.requiredIn.join(
      " | ",
    )})`, () => {
      const inLayer = sources.filter((abs) => {
        const rel = relative(ROOT, abs).replace(/\\/g, "/");
        if (isTestFile(rel)) return false;
        if (!spec.requiredIn.some((p) => rel.startsWith(p))) return false;
        return incrementsCounter(readFileSync(abs, "utf-8"), spec.symbol, spec.metricName);
      });

      expect(
        inLayer.length,
        `${spec.metricName} must be incremented in its emission seam ` +
          `(${spec.requiredIn.join(" | ")}); found none.`,
      ).toBeGreaterThan(0);
    });
  }
});
