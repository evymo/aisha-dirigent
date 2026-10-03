/**
 * Chunk-Cycle Prevention Gate
 *
 * Statically prevents top-level cycles between the Vite output chunks
 * `shared` and the area chunks (`admin-area`, `admin-production`,
 * `member-area`, `partner-area`).
 *
 * Why this gate exists
 * ────────────────────
 * Production crash signature when a cycle is present:
 *
 *   Uncaught ReferenceError: Cannot access 'Ce' before initialization
 *       at admin-area-XXXXXXXX.js
 *
 * Root cause: ESM evaluates both chunks "interleaved" when a static cycle
 * is detected. If `admin-area` reaches into `shared` for a `const` binding
 * that hasn't been initialized yet (because `shared`'s evaluation was
 * paused mid-way to start `admin-area`), the binding throws a TDZ error.
 *
 * The vite.config.ts `manualChunks` strategy is designed to be cycle-free
 * ON THE ASSUMPTION that nothing in the `shared` chunk top-level imports
 * a value from an area chunk. If that invariant breaks — even with ONE
 * file — every admin/member/partner page can crash at module init.
 *
 * What this gate enforces
 * ───────────────────────
 *   1. No `.ts` / `.tsx` file outside the area directories may VALUE-import
 *      (i.e. not `import type`) from `@/components/admin/`,
 *      `@/components/production/`, `@/components/partner/`,
 *      `@/components/member/`, `@/pages/admin/`, `@/pages/partner/`,
 *      `@/pages/member/`, or `@/pages/Member*`.
 *   2. Type-only imports (`import type ...`) are allowed — SWC erases
 *      them at build time so they create no runtime edge.
 *   3. Lazy imports (`lazy(() => import('@/components/admin/...'))`,
 *      `import('@/components/admin/...').then(...)`) are allowed because
 *      they are NOT top-level static edges in the bundler graph.
 *
 * If a future change re-introduces a static value-import from `shared`
 * into an area, this gate fails BEFORE the artifact is built, surfacing
 * the exact file + line that re-creates the TDZ class of bug.
 *
 * The gate IS chunk-config-aware: it reads the area-path rules from
 * `vite.config.ts` so changes to chunking stay in sync.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

/** Paths that vite.config.ts assigns to non-shared chunks. */
const AREA_PATH_PREFIXES = [
  "components/admin/",
  "components/production/",
  "components/partner/",
  "components/member/",
  "pages/admin/",
  "pages/partner/",
  "pages/member/",
];

/**
 * Top-level `pages/Member*` files (e.g. `MemberPortal.tsx`) are also routed
 * into `member-area` by vite.config.ts via the `/src/pages/Member` rule.
 */
const AREA_FILE_PREFIXES = ["pages/Member"];

/**
 * @/components/partners/ (plural) is intentionally NOT in `AREA_PATH_PREFIXES`.
 * The chunk rule matches `components/partner/` (singular) only. Plural
 * stays in `shared`, so importing from `@/components/partners/...` does
 * not cross a chunk boundary.
 */

const CODE_EXTENSIONS = [".ts", ".tsx"];

interface SourceFile {
  relPath: string;
  content: string;
}

function walk(dir: string, acc: SourceFile[] = []): SourceFile[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (!CODE_EXTENSIONS.includes(path.extname(entry.name))) continue;
    // Skip tests / stories — they're not in any runtime chunk.
    const rel = path.relative(SRC, full);
    if (rel.startsWith("tests/")) continue;
    if (rel.endsWith(".stories.tsx") || rel.endsWith(".stories.ts")) continue;
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
    acc.push({ relPath: rel, content: fs.readFileSync(full, "utf8") });
  }
  return acc;
}

function fileIsInArea(relPath: string): boolean {
  return (
    AREA_PATH_PREFIXES.some((p) => relPath.startsWith(p)) ||
    AREA_FILE_PREFIXES.some((p) => relPath.startsWith(p))
  );
}

/**
 * Match a single import line, distinguishing `import type` (safe) from
 * value imports. We deliberately match against the alias `@/`. Relative
 * imports across the chunk boundary are theoretically possible but rare;
 * if needed they can be added as a second pattern.
 *
 * Examples (✗ = caught, ✓ = allowed):
 *   ✗ import { Foo } from '@/components/admin/x'
 *   ✗ import Foo, { Bar } from '@/components/admin/x'
 *   ✓ import type { Foo } from '@/components/admin/x'
 *   ✓ import type * as Admin from '@/components/admin/x'
 *   ✓ import { Foo } from '@/components/partners/x'   (plural — `shared`)
 *
 * Note: trailing `/` after each area alternative is required to avoid a
 * false positive on the plural `components/partners/` (which the chunk
 * splitter leaves in the `shared` chunk).
 */
const VALUE_IMPORT_RE =
  /^\s*import\s+(?!type\b)[^;]*from\s+['"]@\/(components\/(?:admin|production|partner|member)\/|pages\/(?:admin|partner|member|Member))[^'"]*['"]/gm;

interface Offense {
  file: string;
  line: number;
  raw: string;
}

describe("Chunk-Cycle Prevention Gate", () => {
  it("no value-import from shared chunk into area chunks (would create TDZ at runtime)", () => {
    const files = walk(SRC);
    const offenses: Offense[] = [];

    for (const f of files) {
      // Files already inside an area chunk are allowed to import from
      // their own area (no cross-chunk edge created).
      if (fileIsInArea(f.relPath)) continue;

      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Reset regex global state per-line to avoid stale lastIndex
        VALUE_IMPORT_RE.lastIndex = 0;
        if (VALUE_IMPORT_RE.test(line)) {
          offenses.push({ file: f.relPath, line: i + 1, raw: line.trim() });
        }
      }
    }

    if (offenses.length > 0) {
      const formatted = offenses
        .map(
          (o) =>
            `  ✗ src/${o.file}:${o.line}\n    ${o.raw}\n    FIX: use \`import type\` (if type-only) or \`const X = lazy(() => import('...'))\` to defer the chunk edge.`,
        )
        .join("\n\n");
      throw new Error(
        `Top-level value imports from \`shared\` chunk into area chunks (would create ` +
          `\`Cannot access X before initialization\` TDZ in production):\n\n${formatted}\n\n` +
          `See src/tests/gates/chunk-cycle-prevention.gate.test.ts for details.`,
      );
    }

    expect(offenses).toEqual([]);
  });
});
