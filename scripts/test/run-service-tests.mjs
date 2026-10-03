#!/usr/bin/env node
// =============================================================================
// run-service-tests.mjs — Auto-discover and run vitest in each service
// =============================================================================
// Walks `services/svc-*`, finds every service that has both:
//   1. A `package.json` with a `test` script, AND
//   2. A vitest config file (vitest.config.{ts,mjs,js,cjs}) OR a test
//      file under src/tests/ (so services that test via other means
//      aren't accidentally swept in).
//
// For each match, runs `npm --prefix <dir> test`. Aggregates results and
// exits non-zero if any service's test suite failed.
//
// Services with no tests are quietly skipped (not flagged) — this script
// is for "run what's there", not coverage enforcement. The hook-coverage
// gate is the right place for "must have tests" assertions.
//
// Why a custom runner instead of `npm-run-all` or workspaces?
//   - Services are NOT npm workspaces (each has its own lockfile / TS
//     config / runtime). A workspace setup would conflate dependencies
//     across very different services (Fastify vs. agent-runner vs.
//     blockchain), which we deliberately keep isolated for security
//     boundary reasons.
//   - We want per-service summary output (one line per service) without
//     hundreds of lines of interleaved vitest progress.
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVICES_DIR = path.join(REPO_ROOT, "services");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

const VITEST_CONFIG_FILES = [
  "vitest.config.ts",
  "vitest.config.mjs",
  "vitest.config.js",
  "vitest.config.cjs",
];

// First-class core services that predate the `svc-` naming convention. Discovery
// filters services/ on `name.startsWith("svc-")`, which would silently exclude
// these even when they ship a real vitest suite. They are unioned into discovery
// so their tests run in this aggregate runner. Entries without a test script yet
// (ws-gateway, event-worker) are quietly skipped by the same predicate that skips
// any testless service — listing them here is harmless and future-proofs the day
// they grow a suite.
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function hasVitestConfig(svcDir) {
  return VITEST_CONFIG_FILES.some((f) => existsSync(path.join(svcDir, f)));
}

function hasTestFiles(svcDir) {
  const testsDir = path.join(svcDir, "src", "tests");
  if (!existsSync(testsDir)) return false;
  return walkForPattern(testsDir, /\.(test|spec|unit\.test)\.ts$/);
}

function walkForPattern(dir, pattern) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (walkForPattern(full, pattern)) return true;
    } else if (pattern.test(entry)) {
      return true;
    }
  }
  return false;
}

function hasTestScript(svcDir) {
  const pkgPath = path.join(svcDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg?.scripts?.test === "string";
  } catch {
    return false;
  }
}

function readPackageJson(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function localAishaPackagesByName() {
  const out = new Map();
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const name of readdirSync(PACKAGES_DIR)) {
    const dir = path.join(PACKAGES_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const pkg = readPackageJson(dir);
    if (typeof pkg?.name === "string" && pkg.name.startsWith("@aisha/")) {
      out.set(pkg.name, { dir, pkg });
    }
  }
  return out;
}

function packageDependencyNames(pkg) {
  return [
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.peerDependencies ?? {}),
  ];
}

function serviceWorkspaceDeps(serviceDirs) {
  const local = localAishaPackagesByName();
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (pkgName) => {
    if (visited.has(pkgName)) return;
    if (visiting.has(pkgName)) return;
    const info = local.get(pkgName);
    if (!info) return;
    visiting.add(pkgName);
    for (const dep of packageDependencyNames(info.pkg)) {
      visit(dep);
    }
    visiting.delete(pkgName);
    visited.add(pkgName);
    ordered.push(info);
  };

  for (const svcDir of serviceDirs) {
    const pkg = readPackageJson(svcDir);
    for (const dep of packageDependencyNames(pkg)) {
      visit(dep);
    }
  }

  return ordered.filter(({ pkg }) => typeof pkg?.scripts?.build === "string");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
      ...options,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function buildWorkspaceDeps(serviceDirs) {
  const deps = serviceWorkspaceDeps(serviceDirs);
  if (deps.length === 0) return true;

  console.log(`${DIM}Prebuilding service workspace deps: ${deps.map(({ pkg }) => pkg.name).join(", ")}${NC}`);
  for (const { dir, pkg } of deps) {
    const rel = path.relative(REPO_ROOT, dir);
    process.stdout.write(`  ${pkg.name} build ... `);
    const result = await runCommand("npm", ["--prefix", dir, "run", "build", "--silent"]);
    if (result.code === 0) {
      console.log(`${GREEN}OK${NC}`);
      continue;
    }
    console.log(`${RED}FAIL${NC}`);
    console.log(`${RED}── ${pkg.name} (${rel}) build ──${NC}`);
    if (result.stderr) console.log(result.stderr.trim().slice(-2000));
    if (result.stdout) console.log(result.stdout.trim().slice(-2000));
    return false;
  }
  return true;
}

// Non-`svc-`-prefixed services that ship their own test suite. Without this the
// discovery below ran ONLY on `svc-*`, so security-relevant suites executed in NO
// CI/pre-push lane and regressions merged green: `gateway` (PAT mint, gateway auth,
// postgrest-JWT, app-config bootstrap, /dirigent proxy — incl. the I1 journaling
// gate that lives here), `storage-auth` (AV-scan + upload promotion), plus the
// realtime pair. Any dir here still only RUNS if it has a test script + tests.
const CORE_SERVICES = new Set(["gateway", "storage-auth", "ws-gateway", "event-worker"]);

function discoverServices() {
  if (!existsSync(SERVICES_DIR)) return [];
  const all = readdirSync(SERVICES_DIR)
    .filter((name) => name.startsWith("svc-") || CORE_SERVICES.has(name))
    .map((name) => path.join(SERVICES_DIR, name))
    .filter((p) => statSync(p).isDirectory());

  const withTests = [];
  const withoutTests = [];
  for (const svc of all) {
    if (hasTestScript(svc) && (hasVitestConfig(svc) || hasTestFiles(svc))) {
      withTests.push(svc);
    } else {
      withoutTests.push(svc);
    }
  }
  return { withTests, withoutTests };
}

// ── Packages ──────────────────────────────────────────────────────────────
// ⛔ NAMĚŘENO 2026-09-04: komentář o pár řádků níž tvrdí, že „one runner covers
// services, PACKAGES and plugins: one verb, not three" — jenže `discoverPackages`
// v tomhle souboru NEBYL. `PACKAGES_DIR` sloužil jen k předbuildění závislostí.
//
// Následek byl přesně ten, který je u pluginů popsaný jako poučení: 12 balíčků
// a 33 testovacích souborů, které NIKDY neběžely. Mezi nimi `security` (12),
// `audience-types` (8) a `aitg` (7). Slib v komentáři nahrazoval implementaci.
//
// ⭐ Předpoklad je týž jako u služeb: `test` skript A (vitest config NEBO
// testovací soubory). Balíček bez testů se mlčky přeskočí — „nemá testy" není
// vada, kterou by měl hlásit tenhle runner.
function discoverPackages() {
  const withTests = [];
  const withoutTests = [];
  if (!existsSync(PACKAGES_DIR)) return { withTests, withoutTests };
  for (const name of readdirSync(PACKAGES_DIR)) {
    const dir = path.join(PACKAGES_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(path.join(dir, "package.json"))) continue;
    if (hasTestScript(dir) && (hasVitestConfig(dir) || hasTestFiles(dir) || walkForPattern(dir, /\.(test|spec)\.[cm]?[jt]sx?$/))) {
      withTests.push(dir);
    } else {
      withoutTests.push(dir);
    }
  }
  return { withTests, withoutTests };
}

// ── Plugins ────────────────────────────────────────────────────────────────
// Plugins deliberately have NO package.json: `plugins/` sits outside the
// workspace globs, which is the whole reason a vendor connector lives there —
// an install that does not use it must not have to resolve it. The cost of
// that is they are invisible to every workspace-shaped runner, so their tests
// ran NOWHERE until this was added (measured 2026-07-26: eurowag-telematics
// shipped with a suite that had never once executed in CI).
//
// They are therefore discovered by their vitest config and run with the root
// vitest binary, cwd'd into the plugin — no npm, no install, no dependency
// resolution. Same aggregate output as a service, so one runner covers
// services, packages and plugins: one verb, not three.
function discoverPlugins() {
  const withTests = [];
  const withoutTests = [];
  if (!existsSync(PLUGINS_DIR)) return { withTests, withoutTests };
  for (const name of readdirSync(PLUGINS_DIR)) {
    const dir = path.join(PLUGINS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    if (hasVitestConfig(dir) && walkForPattern(dir === PLUGINS_DIR ? dir : path.join(dir, "src"), /\.(test|spec)\.ts$/)) {
      withTests.push(dir);
    } else {
      withoutTests.push(dir);
    }
  }
  return { withTests, withoutTests };
}

function runPluginTest(pluginDir) {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["vitest", "run", "--reporter=default"], {
      cwd: pluginDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("exit", (code) => {
      const summary = (stdout + "\n" + stderr)
        .split("\n")
        .map((l) => l.trim())
        .reverse()
        .find((l) => /Tests\s+\d+\s+(passed|failed|skipped)/.test(l)) ?? "";
      resolve({ dir: pluginDir, code: code ?? 1, summary, stdout, stderr });
    });
  });
}

function runSvcTest(svcDir) {
  return new Promise((resolve) => {
    const proc = spawn("npm", ["--prefix", svcDir, "test", "--silent"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("exit", (code) => {
      // Vitest one-liner summary
      const summary = (stdout + "\n" + stderr)
        .split("\n")
        .map((l) => l.trim())
        .reverse()
        .find((l) => /Tests\s+\d+\s+(passed|failed|skipped)/.test(l)) ?? "";
      resolve({
        dir: svcDir,
        code: code ?? 1,
        summary,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  const start = Date.now();
  // --plugins-only exists for the pre-push lane: plugin suites are tiny and
  // fully offline, while the 24 service suites are heavy and CI-gated. Without
  // a cheap lane the plugins would stay CI-only, which is how their tests came
  // to never run in the first place.
  const pluginsOnly = process.argv.includes("--plugins-only");
  const { withTests, withoutTests } = pluginsOnly
    ? { withTests: [], withoutTests: [] }
    : discoverServices();
  const balicky = pluginsOnly ? { withTests: [], withoutTests: [] } : discoverPackages();
  const plugins = discoverPlugins();

  console.log(
    `${YELLOW}━━━ Service + plugin test runner ━━━${NC} ` +
      `(${withTests.length} services + ${balicky.withTests.length} packages + ${plugins.withTests.length} plugins with tests, ` +
      `${withoutTests.length + plugins.withoutTests.length} skipped)`,
  );

  const skipped = [...withoutTests, ...plugins.withoutTests];
  if (skipped.length > 0) {
    console.log(
      `${DIM}Skipped (no tests yet): ${skipped.map((p) => path.basename(p)).join(", ")}${NC}`,
    );
  }

  if (withTests.length > 0) {
    const depsBuilt = await buildWorkspaceDeps(withTests);
    if (!depsBuilt) {
      process.exit(1);
    }
  }

  const results = [];
  for (const svc of withTests) {
    const name = path.basename(svc);
    process.stdout.write(`  ${name} ... `);
    const r = await runSvcTest(svc);
    results.push({ name, ...r });
    if (r.code === 0) {
      console.log(`${GREEN}OK${NC}  ${DIM}${r.summary}${NC}`);
    } else {
      console.log(`${RED}FAIL${NC}  ${DIM}${r.summary}${NC}`);
    }
  }

  for (const balicek of balicky.withTests) {
    const name = `packages/${path.basename(balicek)}`;
    process.stdout.write(`  ${name} ... `);
    const r = await runSvcTest(balicek);
    results.push({ name, ...r });
    console.log(
      r.code === 0 ? `${GREEN}OK${NC}  ${DIM}${r.summary}${NC}` : `${RED}FAIL${NC}  ${DIM}${r.summary}${NC}`,
    );
  }

  for (const plugin of plugins.withTests) {
    const name = `plugins/${path.basename(plugin)}`;
    process.stdout.write(`  ${name} ... `);
    const r = await runPluginTest(plugin);
    results.push({ name, ...r });
    console.log(
      r.code === 0 ? `${GREEN}OK${NC}  ${DIM}${r.summary}${NC}` : `${RED}FAIL${NC}  ${DIM}${r.summary}${NC}`,
    );
  }

  const failed = results.filter((r) => r.code !== 0);
  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log("");
  if (failed.length === 0) {
    console.log(
      `${GREEN}✅ All ${results.length} service + plugin test suites passed${NC} (${dur}s)`,
    );
  } else {
    console.log(
      `${RED}❌ ${failed.length}/${results.length} service + plugin test suite(s) failed${NC} (${dur}s)`,
    );
    for (const f of failed) {
      console.log(`\n${RED}── ${f.name} ──${NC}`);
      if (f.stderr) console.log(f.stderr.trim().slice(-2000));
      if (f.stdout) console.log(f.stdout.trim().slice(-2000));
    }
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("run-service-tests failed:", err);
  process.exit(1);
});
