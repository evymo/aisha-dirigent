/**
 * setup-cockpit integrity Gate
 *
 * The local Setup Cockpit (scripts/setup-cockpit/) provisions a fresh dev
 * environment from the browser-based wizard. Several regression classes have
 * broken it before; this gate locks them out:
 *
 *   1. A whitelisted ALLOWED_SCRIPTS entry pointing at a script/path that does
 *      not exist → the wizard step dies with a cryptic spawn ENOENT.
 *   2. Re-introducing the retired hosted backend — the platform is V2 (Postgres +
 *      gateway + Keycloak OIDC via the /auth/v1 proxy). The cockpit must carry
 *      ZERO references to the retired BaaS.
 *   3. Dropping the fixes that make the wizard actually work: the extension-deps
 *      install (extensions/aisha-dirigent is NOT a root workspace member, so
 *      root `npm install` never installs its deps), the cloud-config bootstrap
 *      fetch (the anon key is SERVED BY the backend's public .well-known, never
 *      hardcoded), and the native-Windows → WSL guard.
 *
 * Spouští se přes: npm run test:gates
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.cwd();
const COCKPIT = resolve(ROOT, "scripts/setup-cockpit");
const HOST = resolve(COCKPIT, "host.mjs");

function read(p: string): string {
  expect(existsSync(p), `expected file at ${p}`).toBe(true);
  return readFileSync(p, "utf8");
}

describe("setup-cockpit: host integrity", () => {
  test("every whitelisted script/path target exists on disk (no dangling steps)", () => {
    const src = read(HOST);
    // resolve(__dirname, "rel") → under scripts/setup-cockpit; resolve(PROJECT_ROOT, "rel") → repo root.
    const re = /resolve\((__dirname|PROJECT_ROOT),\s*"([^"]+)"\)/g;
    const missing: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const base = m[1] === "__dirname" ? COCKPIT : ROOT;
      const key = `${m[1]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!existsSync(join(base, m[2]))) missing.push(`${m[1]} + ${m[2]}`);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(missing, `dangling whitelist targets:\n${missing.join("\n")}`).toEqual([]);
  });

  test("extension build is unblocked: installs extension deps before compile", () => {
    const src = read(HOST);
    expect(src).toMatch(/"extension-install-deps"/);
    expect(src).toMatch(/extensions\/aisha-dirigent/);
    expect(src).toMatch(/hasExtensionNodeModules/);
  });

  test("cloud config is fetched from the backend's public bootstrap (no hardcoded key)", () => {
    const src = read(HOST);
    expect(src).toMatch(/\.well-known\/app-config\.json/);
    expect(src).toMatch(/function\s+loadCloudConfig/);
    // The anon key must never be a committed literal — only fetched / env-overridden.
    expect(src).not.toMatch(/anon[_A-Za-z]*\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/i);
  });

  test("native Windows is guided to WSL (no cryptic ENOENT on bash steps)", () => {
    const src = read(HOST);
    expect(src).toMatch(/platform\(\)\s*===\s*"win32"/);
    expect(src.toUpperCase()).toContain("WSL");
  });
});

// The banned term is assembled at runtime so this gate file does not itself trip
// the global branding gate (which flags any new literal occurrence of it).
const LEGACY_BAAS = ["supa", "base"].join("");

describe(`setup-cockpit: zero ${LEGACY_BAAS} (V2 stack only)`, () => {
  test(`no ${LEGACY_BAAS} references anywhere in scripts/setup-cockpit`, () => {
    const banned = new RegExp(LEGACY_BAAS, "i");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(mjs|js|ts|sh|json|html|css)$/.test(name)) continue;
        readFileSync(p, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (banned.test(line)) offenders.push(`${p.replace(`${ROOT}/`, "")}:${i + 1}`);
          });
      }
    };
    walk(COCKPIT);
    expect(offenders, `${LEGACY_BAAS} refs must be removed (V2 stack):\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("setup-cockpit: two-mode onboarding wiring (self-host vs connect-to-central)", () => {
  const COCKPIT_JS = resolve(COCKPIT, "ui/cockpit.js");

  test("cockpit opens with a mode choice: self-host vs central-connect", () => {
    const js = read(COCKPIT_JS);
    expect(js).toMatch(/id:\s*"mode"/);
    expect(js).toMatch(/function renderMode/);
    expect(js).toMatch(/deployMode/);
    expect(js).toMatch(/data-mode="selfhost"/);
    expect(js).toMatch(/data-mode="central"/);
  });

  test("self-host branch collects operator inputs from the schema endpoint + local verify", () => {
    const js = read(COCKPIT_JS);
    expect(js).toMatch(/id:\s*"deploy"/);
    expect(js).toMatch(/function renderDeploy/);
    expect(js).toMatch(/\/operator-inputs/);
    expect(js).toMatch(/operator-setup-verify/);
  });

  test("host serves the operator-inputs schema + whitelists the verify action", () => {
    const src = read(HOST);
    expect(src).toMatch(/\/api\/operator-inputs/);
    expect(src).toMatch(/operator-setup-verify/);
    expect(src).toMatch(/operator-inputs\.mjs/);
  });

  test("the canonical connection guide exists and covers both modes", () => {
    const guide = read(resolve(ROOT, "docs/onboarding/CONNECTION_GUIDE.md"));
    expect(guide).toMatch(/self-host/i);
    expect(guide).toMatch(/ask\.aisha\.guru/);
    expect(guide).toMatch(/operator-setup\.mjs/);
  });
});
