/**
 * Dockerfile Workspace node_modules Gate
 *
 * Hermetic, workspace-aware service Dockerfiles install a single workspace
 * member with `npm ci --workspace=@aisha/<svc> --include-workspace-root`,
 * `npm prune --workspace=@aisha/<svc> --omit=dev`, then build a slim runtime
 * image by copying the RESOLVED `node_modules` out of the build stage:
 *
 *     COPY --from=build /app/node_modules ./node_modules
 *
 * That copies ONLY the ROOT-hoisted `node_modules`. npm normally hoists every
 * dependency to the root, but it legitimately NESTS a dependency under the
 * service's own `node_modules` when it can't hoist (e.g. a version conflict
 * with another workspace member already occupying the root slot). Any such
 * nested dependency is then SILENTLY DROPPED from the runtime image, and the
 * container crash-loops at startup with:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<dep>' imported from
 *     /app/services/<svc>/dist/...
 *
 * Discovered: 2026-06-04 cold-start --wipe — `aisha-core` stuck
 * `restarting:unknown` because svc-web-artifact's `jsdom` nested under
 * `services/svc-web-artifact/node_modules` (a conflicting jsdom version held
 * the root slot) and the runtime stage only copied root `node_modules`.
 *
 * Fix contract enforced by this gate: every hermetic workspace Dockerfile that
 * copies root `node_modules` from its build stage MUST ALSO copy its own
 * service's `node_modules`, so nested (non-hoisted) deps travel into runtime:
 *
 *     COPY --from=build /app/services/<svc>/node_modules services/<svc>/node_modules
 *
 * Static, deterministic, no Docker/network — runs in `npm run test:gates`.
 */

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

/**
 * Repo-relative paths matching a git pathspec, with a filesystem-walk fallback
 * ONLY when git metadata is unavailable (some local gate runners don't expose
 * git to Vitest workers). Previously the fs walk ALWAYS ran and merged — an
 * O(repo) recursive readdir/stat on every call that, compounded across lookups,
 * pushed this gate past its 120s timeout under parallel I/O load (a false
 * pre-push rejection). git ls-files is the source of truth for the COMMITTED
 * Dockerfiles this gate asserts on; the fs walk's untracked extras never ship.
 */
function gitLsFiles(pathspec: string): string[] {
  try {
    return execFileSync("git", ["ls-files", pathspec], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findDockerfiles(): string[] {
  let files = gitLsFiles("*Dockerfile*");
  if (files.length === 0) files = findDockerfilesFromFs(ROOT); // fallback: no git metadata
  return files
    .filter((f) => !f.includes("/node_modules/") && !f.startsWith("node_modules/"))
    .filter((f) => !f.includes("/trash/") && !f.startsWith("trash/"))
    .filter((f) => !f.includes("/legacy/") && !f.startsWith("legacy/"))
    .filter((f) => !f.includes("legacy-"))
    .filter((f) => existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile());
}

function findDockerfilesFromFs(dir: string, rel = ""): string[] {
  const skipDirs = new Set([
    ".git",
    ".agents",
    ".claude",
    ".codex",
    ".tmp",
    "archive",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
    "trash",
  ]);
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry) || entry.endsWith(".app")) continue;
    const abs = join(dir, entry);
    const childRel = rel ? `${rel}/${entry}` : entry;
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...findDockerfilesFromFs(abs, childRel));
    } else if (/^Dockerfile(\..+)?$/.test(entry)) {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * A Dockerfile is "hermetic workspace-built" when it prunes a single workspace
 * member AND copies the build stage's root node_modules into the runtime image.
 * Returns the matched workspace package name(s) (e.g. "@aisha/svc-web-artifact").
 */
function hermeticWorkspaceTargets(content: string): string[] {
  const copiesRootNodeModules = /COPY\s+--from=\S+\s+\/app\/node_modules\s/.test(content);
  if (!copiesRootNodeModules) return [];
  const targets = new Set<string>();
  const pruneRe = /npm\s+prune\s+--workspace=(\S+)\s+--omit=dev/g;
  let m: RegExpExecArray | null;
  while ((m = pruneRe.exec(content)) !== null) {
    targets.add(m[1]);
  }
  return [...targets];
}

/**
 * Extract @aisha/* packages compiled in the Dockerfile's dep-build chain
 * (`npm run build --workspace=@aisha/X`). These are the service's WORKSPACE
 * DEPENDENCIES built from source in the build stage. The service itself is also
 * built this way, so the caller filters it out (its dist is copied separately).
 */
function buildChainWorkspaces(content: string): string[] {
  const out = new Set<string>();
  for (const mm of content.matchAll(
    /npm\s+run\s+build\s+--workspace=(@aisha\/[a-z0-9_-]+)/g,
  )) {
    out.add(mm[1]);
  }
  return [...out];
}

/**
 * Transitive @aisha/* dependency closure of a workspace package, read from
 * package.json `dependencies`/`optionalDependencies`. Only real workspace
 * packages (present in pkgNameToDir) are followed — external @aisha-scoped npm
 * deps, if any, are ignored. The package itself is NOT included.
 */
function aishaDepClosure(pkgName: string): Set<string> {
  const map = pkgNameToDir();
  const closure = new Set<string>();
  const visit = (name: string) => {
    const dir = map.get(name);
    if (!dir) return;
    let pkg: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf-8"));
    } catch {
      return;
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith("@aisha/") && map.has(dep) && !closure.has(dep)) {
        closure.add(dep);
        visit(dep);
      }
    }
  };
  visit(pkgName);
  return closure;
}

/** Does a workspace package declare a build script (i.e. produce a dist)? */
function hasBuildScript(pkgName: string): boolean {
  const dir = pkgNameToDir().get(pkgName);
  if (!dir) return false;
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf-8"));
    return Boolean(pkg?.scripts?.build);
  } catch {
    return false;
  }
}

/**
 * Map a workspace package name (@aisha/<svc>) to its repo path by reading the
 * `name` field of each service's package.json. Avoids hardcoding the @aisha→
 * services/<svc> convention (a few packages live under packages/* instead).
 */
/**
 * Workspace package-name → repo-dir map, built ONCE (lazily memoized). Avoids
 * hardcoding the @aisha→services/<svc> convention (a few packages live under
 * packages/*). Previously `workspaceDirFor` rebuilt the entire package.json
 * list — including a full-repo fs walk — on EVERY call (once per hermetic
 * target), the dominant cost behind the timeout flake.
 */
let _pkgNameToDir: Map<string, string> | undefined;
function pkgNameToDir(): Map<string, string> {
  if (_pkgNameToDir) return _pkgNameToDir;
  let pkgs = gitLsFiles("*/package.json");
  if (pkgs.length === 0) pkgs = findPackageJsonsFromFs(ROOT); // fallback: no git metadata
  const map = new Map<string, string>();
  for (const rel of pkgs) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    try {
      const pkg = JSON.parse(readFileSync(abs, "utf-8"));
      if (pkg?.name) map.set(pkg.name, rel.replace(/\/package\.json$/, ""));
    } catch {
      // ignore malformed package.json
    }
  }
  _pkgNameToDir = map;
  return map;
}

function workspaceDirFor(pkgName: string): string | undefined {
  return pkgNameToDir().get(pkgName);
}

function findPackageJsonsFromFs(dir: string, rel = ""): string[] {
  const skipDirs = new Set([
    ".git",
    ".agents",
    ".claude",
    ".codex",
    ".tmp",
    "archive",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
    "trash",
  ]);
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry) || entry.endsWith(".app")) continue;
    const abs = join(dir, entry);
    const childRel = rel ? `${rel}/${entry}` : entry;
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...findPackageJsonsFromFs(abs, childRel));
    } else if (entry === "package.json") {
      out.push(childRel);
    }
  }
  return out;
}

describe("Dockerfile Workspace node_modules Gate", () => {
  const dockerfiles = findDockerfiles();

  test("at least one hermetic workspace Dockerfile is present (sanity)", () => {
    const hermetic = dockerfiles.filter(
      (f) => hermeticWorkspaceTargets(readFileSync(join(ROOT, f), "utf-8")).length > 0,
    );
    expect(
      hermetic.length,
      "Expected to detect hermetic workspace Dockerfiles (npm prune --workspace + " +
        "COPY root node_modules). If this dropped to 0, the detection heuristic or " +
        "the build pattern changed — review before trusting this gate.",
    ).toBeGreaterThan(0);
  });

  test("every hermetic workspace Dockerfile also copies its service's own node_modules", () => {
    const violations: string[] = [];

    for (const file of dockerfiles) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      const targets = hermeticWorkspaceTargets(content);
      if (targets.length === 0) continue;

      for (const pkgName of targets) {
        const dir = workspaceDirFor(pkgName);
        if (!dir) {
          violations.push(
            `${file}: could not resolve workspace dir for '${pkgName}' ` +
              `(no package.json with that name)`,
          );
          continue;
        }
        // Runtime stage must copy services/<svc>/node_modules so nested,
        // non-hoisted deps reach the runtime image.
        const expectedCopy = new RegExp(
          `COPY\\s+--from=\\S+\\s+/app/${dir}/node_modules\\s+${dir}/node_modules`,
        );
        if (!expectedCopy.test(content)) {
          violations.push(
            `${file}: copies root /app/node_modules but NOT '${dir}/node_modules'.\n` +
              `      Add: COPY --from=build /app/${dir}/node_modules ${dir}/node_modules\n` +
              `      (and 'RUN mkdir -p ${dir}/node_modules' in the build stage so the ` +
              `COPY never fails when everything hoisted).`,
          );
        }
      }
    }

    expect(
      violations.length,
      `Found ${violations.length} hermetic Dockerfile(s) that drop nested service ` +
        `node_modules (ERR_MODULE_NOT_FOUND risk at runtime):\n` +
        violations.join("\n") +
        `\n\nnpm hoists most deps to root, but NESTS any it can't (version conflicts). ` +
        `The runtime stage must copy BOTH /app/node_modules AND the service's own ` +
        `node_modules, or the nested dep is silently missing from the image.`,
    ).toBe(0);
    // Belt-and-suspenders margin: the scan is now sub-second (git-first + memoized
    // package map), but this test is legitimately filesystem-bound, so keep a
    // generous timeout so a heavily-loaded CI/local run can never false-reject.
  }, 300_000);

  test("every @aisha/* workspace dep built in the chain is copied into the runtime image", () => {
    // Sibling failure mode to the test above: a service's @aisha/* WORKSPACE
    // DEP is compiled in the build stage (`npm run build --workspace=@aisha/X`)
    // but its package dir is never COPYd into the slim runtime stage. npm
    // represents that dep as a symlink `node_modules/@aisha/X → ../../packages/X`;
    // copying root node_modules brings the symlink but not its target, so the
    // container crash-loops with `ERR_MODULE_NOT_FOUND: Cannot find package
    // '@aisha/X'`. Discovered 2026-06-30 cold-start --wipe: svc-mcp-knowledge
    // (in aisha-core) stuck restarting:unknown — @aisha/flowboard-core was added
    // to both Dockerfiles' build chains but never to their runtime COPY blocks.
    const violations: string[] = [];

    for (const file of dockerfiles) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      // Only hermetic workspace Dockerfiles copy root node_modules + build deps.
      const self = new Set(hermeticWorkspaceTargets(content));
      if (self.size === 0) continue;

      for (const pkgName of buildChainWorkspaces(content)) {
        if (self.has(pkgName)) continue; // the service's own dist is copied separately
        const dir = workspaceDirFor(pkgName);
        if (!dir) {
          violations.push(
            `${file}: build chain compiles '${pkgName}' but no package.json declares that name`,
          );
          continue;
        }
        // Runtime stage must put the dep's built code in the image, else the
        // workspace symlink node_modules/@aisha/X → <dir> dangles at runtime.
        // TWO valid idioms (both reach `<dir>/dist` + package.json):
        //   a) whole-dir:  COPY --from=build /app/<dir> <dir>
        //   b) dist-only:  COPY --from=build /app/<dir>/dist <dir>/dist
        //                  (+ a separate COPY of <dir>/package.json)
        const expectedCopy = new RegExp(
          `COPY\\s+--from=\\S+\\s+/app/${dir}(?:\\s+${dir}\\b|/dist\\b)`,
        );
        if (!expectedCopy.test(content)) {
          violations.push(
            `${file}: build chain compiles '${pkgName}' but runtime stage never copies '${dir}'.\n` +
              `      Add: COPY --from=build /app/${dir} ${dir}`,
          );
        }
      }
    }

    expect(
      violations.length,
      `Found ${violations.length} hermetic Dockerfile(s) that build an @aisha/* ` +
        `workspace dep but drop its package dir from the runtime image ` +
        `(ERR_MODULE_NOT_FOUND risk at startup):\n` +
        violations.join("\n") +
        `\n\nA workspace dep is a symlink node_modules/@aisha/X → <dir>; copying ` +
        `root node_modules brings the symlink, so the runtime stage must ALSO copy ` +
        `the dep's package dir (COPY --from=build /app/<dir> <dir>).`,
    ).toBe(0);
  }, 300_000);

  test("every @aisha/* workspace dep a service NEEDS is built in its Dockerfile chain", () => {
    // The BUILD direction — sibling of the runtime-copy test above. A service's
    // transitive @aisha/* dependency that has a build step must be compiled in
    // the Dockerfile's `npm run build --workspace=@aisha/X` chain, else a clean
    // Docker build's `tsc` fails (`Cannot find module '@aisha/X'`) — it builds
    // LOCALLY only because a stale packages/X/dist masks it. 2026-06-30:
    // @aisha/flowboard-core was a declared dep of svc-mcp-knowledge + svc-ai-chat
    // but absent from both build chains (#555). DYNAMIC: derives the required
    // set from each service's package.json (transitive closure) — no hardcoding.
    const violations: string[] = [];

    for (const file of dockerfiles) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      const targets = hermeticWorkspaceTargets(content);
      if (targets.length === 0) continue;
      const built = new Set(buildChainWorkspaces(content));

      for (const svc of targets) {
        for (const dep of aishaDepClosure(svc)) {
          if (built.has(dep)) continue;
          // Only deps that actually produce a dist need a chain entry; a pure-JS
          // @aisha package (no build script) is usable straight from npm ci.
          if (!hasBuildScript(dep)) continue;
          violations.push(
            `${file}: service '${svc}' depends on '${dep}' (package.json) but the ` +
              `build chain never compiles it.\n      Add: npm run build --workspace=${dep}`,
          );
        }
      }
    }

    expect(
      violations.length,
      `Found ${violations.length} hermetic Dockerfile(s) whose build chain omits a ` +
        `required @aisha/* workspace dep (clean Docker tsc → Cannot find module):\n` +
        violations.join("\n") +
        `\n\nEvery @aisha/* dep with a build step in a service's transitive package.json ` +
        `closure must be compiled before the service (npm run build --workspace=@aisha/X).`,
    ).toBe(0);
  }, 300_000);
});
