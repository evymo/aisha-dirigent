/**
 * Gate (remediation M1-mobile-route-existence): every LITERAL expo-router
 * navigation target used in the mobile app must resolve to a real route file
 * under mobile-app/src/app.
 *
 * Why this exists: expo-router is file-based. A `router.push("/(tabs)/chat")`
 * (or a deep-link route map value) that has no matching `app/(tabs)/chat.tsx`
 * is a dead navigation target — at runtime it throws "Unmatched Route" / does
 * nothing, silently breaking the flow. The compiler does not catch it because
 * the pathname is a plain string (and expo-router casts it via `as never` in
 * the deep-link hook), so only a tree-walking contract can enforce it.
 *
 * What it scans (mobile-app/src, all .ts/.tsx):
 *   1. router.push/replace/navigate("<literal>")           — imperative nav
 *   2. `path:` / `pathname:` string-literal properties       — deep-link RouteMapping
 *   3. object record entries  "<key>": "/<route>"           — useDeepLinking route map
 * ...keeping only absolute targets (start with "/"). Each target is resolved
 * against the app/ tree using expo-router's file conventions:
 *   - group segments "(tabs)" / "(auth)" map to directories
 *   - "<seg>"          -> app/.../<seg>.tsx  OR  app/.../<seg>/index.tsx
 *   - a group as last  -> app/.../(group)/index.tsx
 *   - a dynamic seg    (`${...}` interpolation or `[param]`) -> the parent dir
 *     must contain a dynamic route file `[param].tsx` (or `[param]/index.tsx`)
 *
 * KNOWN-RED at authoring time (branch feat/remediation): two call sites push to
 * "/(tabs)/chat" but mobile-app/src/app/(tabs)/chat.tsx does NOT exist:
 *   - mobile-app/src/app/conversations.tsx      (router.push("/(tabs)/chat"))
 *   - mobile-app/src/hooks/useDeepLinking.ts     (routes map: "chat" -> "/(tabs)/chat")
 *
 * The fix is to create the missing route file (app/(tabs)/chat.tsx) — or point
 * both call sites at an existing route. Do NOT allowlist the dead target; make
 * the route exist. The ALLOWLIST below is reserved ONLY for targets that are
 * provably resolved outside the app/ tree (none today).
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MOBILE_SRC = join(ROOT, "mobile-app", "src");
const APP_DIR = join(MOBILE_SRC, "app");

/**
 * Targets intentionally NOT backed by an app/ route file (must be justified
 * in-comment). Empty today.
 */
const ALLOWLIST = new Set<string>([]);

/** Recursively collect .ts/.tsx files under a dir. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".expo") continue;
      out.push(...walk(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Target {
  file: string; // repo-relative
  target: string; // the absolute route string, e.g. "/(tabs)/chat"
}

const COLLECTORS: RegExp[] = [
  // 1. imperative navigation
  /router\.(?:push|replace|navigate)\(\s*[`'"]([^`'"]+)[`'"]/g,
  // 2. RouteMapping objects: path:/pathname: string literal
  /\b(?:path|pathname)\s*:\s*[`'"]([^`'"]+)[`'"]/g,
  // 3. record entries "<key>": "/<route>"
  /[`'"][^`'"]*[`'"]\s*:\s*[`'"](\/[^`'"]+)[`'"]/g,
];

/** Collect every absolute (starts-with-"/") literal nav target across mobile-app/src. */
function collectTargets(): Target[] {
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const abs of walk(MOBILE_SRC)) {
    const src = readFileSync(abs, "utf-8");
    const rel = abs.slice(ROOT.length + 1);
    for (const re of COLLECTORS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const t = m[1];
        if (!t.startsWith("/")) continue; // only absolute expo-router targets
        const key = `${rel}::${t}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ file: rel, target: t });
      }
    }
  }
  return targets;
}

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();
const isDynamicSeg = (seg: string): boolean => /\$\{|^\[.*\]$/.test(seg);

/** True if `dir` contains a dynamic route file `[param].tsx` or `[param]/index.tsx`. */
function dirHasDynamicRoute(dir: string): boolean {
  if (!isDir(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && /^\[.+\]\.tsx?$/.test(entry.name)) return true;
    if (
      entry.isDirectory() &&
      /^\[.+\]$/.test(entry.name) &&
      (existsSync(join(dir, entry.name, "index.tsx")) ||
        existsSync(join(dir, entry.name, "index.ts")))
    ) {
      return true;
    }
  }
  return false;
}

/** Resolve an absolute expo-router target against the app/ tree. */
function resolves(target: string): boolean {
  const clean = target.replace(/^\//, "").replace(/\/$/, "");
  const segments = clean === "" ? [] : clean.split("/");

  // Root "/" -> app/index.tsx
  if (segments.length === 0) {
    return existsSync(join(APP_DIR, "index.tsx"));
  }

  let dir = APP_DIR;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast) {
      if (isDynamicSeg(seg)) return dirHasDynamicRoute(dir);
      // <seg>.tsx  |  <seg>/index.tsx  |  (group)/index.tsx
      if (existsSync(join(dir, `${seg}.tsx`)) || existsSync(join(dir, `${seg}.ts`))) {
        return true;
      }
      if (
        existsSync(join(dir, seg, "index.tsx")) ||
        existsSync(join(dir, seg, "index.ts"))
      ) {
        return true;
      }
      return false;
    }

    // intermediate segment -> must be a directory (group or nested route dir)
    if (isDynamicSeg(seg)) {
      // dynamic dir, e.g. /study/${id}/something — rare; accept if a dynamic
      // subdir exists, else fail loudly.
      if (!dirHasDynamicRoute(dir)) return false;
      // descend into the first matching dynamic dir
      const dyn = readdirSync(dir, { withFileTypes: true }).find(
        (e) => e.isDirectory() && /^\[.+\]$/.test(e.name),
      );
      if (!dyn) return false;
      dir = join(dir, dyn.name);
    } else {
      dir = join(dir, seg);
      if (!isDir(dir)) return false;
    }
  }
  return false;
}

describe("mobile router targets exist (expo-router route existence)", () => {
  test("app/ dir and at least one nav target are present (self-check)", () => {
    expect(isDir(APP_DIR), `expected app dir at ${APP_DIR}`).toBe(true);
    expect(collectTargets().length).toBeGreaterThan(0);
  });

  test("every literal navigation target resolves to a real app/ route file", () => {
    const dead = collectTargets()
      .filter((t) => !ALLOWLIST.has(t.target))
      .filter((t) => !resolves(t.target));

    const report = dead
      .map((d) => `  ${d.target}  <- ${d.file}`)
      .sort()
      .join("\n");

    expect(
      dead,
      `Dead expo-router navigation targets (no matching file under mobile-app/src/app):\n${report}`,
    ).toEqual([]);
  });
});
