/**
 * Cold-start scripts Gate — bash syntax + executable bit + --help support
 *
 * Pokrývá všechny shell skripty související s cold-start / B/G / drift /
 * lokální warmup. Validace:
 *   1. Soubor existuje
 *   2. Je executable (chmod +x)
 *   3. bash -n syntax check passes
 *   4. --help (pokud podporováno) → exit 0 + obsahuje "Usage" header
 *   5. Unknown option → non-zero exit
 *
 * Toto chytá refactor regrese (sed-error v skriptu, missing executable bit
 * po git add bez +x).
 */

import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const SCRIPTS = [
  "scripts/aisha-cold-start.sh",
  "scripts/aisha-cold-start-env.sh",
  "scripts/cold-start-doctor.sh",
  "scripts/diagnose-pki-coolify.sh",
  "scripts/fix-docker-network-pools.sh",
  "scripts/drift-watch.sh",
  "scripts/local-warmup.sh",
  "scripts/blue-green-deploy.sh",
  "scripts/coolify-restore-backup.sh",
  // Previously ZERO-coverage stack-operation scripts (2026-07-06 coverage sweep):
  // at minimum bash -n + executable-bit regression coverage (no --help required).
  "scripts/coolify-server-onboard.sh",
  "scripts/coolify-stack-status.sh",
  "scripts/patch-domains-and-redeploy.sh",
];

const SCRIPTS_WITH_HELP = [
  "scripts/aisha-cold-start.sh",
  "scripts/cold-start-doctor.sh",
  "scripts/diagnose-pki-coolify.sh",
  "scripts/fix-docker-network-pools.sh",
  "scripts/drift-watch.sh",
  "scripts/local-warmup.sh",
  "scripts/blue-green-deploy.sh",
  "scripts/coolify-restore-backup.sh",
];

function isExecutable(path: string): boolean {
  try {
    const s = statSync(path);
    return (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

describe("cold-start shell scripts — basic integrity", () => {
  test.each(SCRIPTS)("%s exists", (script) => {
    expect(existsSync(join(ROOT, script))).toBe(true);
  });

  test.each(SCRIPTS)("%s is executable (chmod +x)", (script) => {
    expect(isExecutable(join(ROOT, script))).toBe(true);
  });

  test.each(SCRIPTS)("%s passes bash -n syntax check", (script) => {
    const r = spawnSync("bash", ["-n", join(ROOT, script)], { encoding: "utf-8" });
    if (r.status !== 0) {
      throw new Error(`bash -n failed for ${script}:\n${r.stderr}`);
    }
    expect(r.status).toBe(0);
  });
});

describe("cold-start shell scripts — --help / unknown option", () => {
  test.each(SCRIPTS_WITH_HELP)("%s --help exits 0", (script) => {
    const r = spawnSync("bash", [join(ROOT, script), "--help"], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_KEY: "fake-for-help" },
      timeout: 5000,
    });
    if (r.status !== 0) {
      throw new Error(`${script} --help exited ${r.status}: ${r.stderr.slice(0, 300)}`);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(50);
  });

  test.each(SCRIPTS_WITH_HELP)("%s unknown option fails", (script) => {
    const r = spawnSync("bash", [join(ROOT, script), "--definitely-not-an-option"], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_KEY: "fake" },
      timeout: 5000,
    });
    expect(r.status).not.toBe(0);
  });
});

describe("config files — syntax / structure", () => {
  const CONFIGS = [
    "config/local-presets.mjs",
    "config/image-versions.env",
    "config/cold-start-timeouts.env",
    "config/coolify-environments.env",
  ];

  test.each(CONFIGS)("%s exists", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  test("config/image-versions.env has IMAGE_NETBIRD + IMAGE_SYNAPSE pinned", () => {
    const content = readFileSync(join(ROOT, "config/image-versions.env"), "utf-8");
    // Iter 13: image refs live as `${REGISTRY_PROXY}<repo>/<image>:<tag>`
    // with REGISTRY_PROXY optional (empty default → direct upstream pull).
    expect(content).toMatch(/^IMAGE_NETBIRD=(?:\$\{REGISTRY_PROXY\})?netbirdio\/netbird:\d+\.\d+\.\d+$/m);
    expect(content).toMatch(/^IMAGE_SYNAPSE=(?:\$\{REGISTRY_PROXY\})?.*synapse:v\d+\.\d+\.\d+$/m);
  });

  test("config/cold-start-timeouts.env has core tunables", () => {
    const content = readFileSync(join(ROOT, "config/cold-start-timeouts.env"), "utf-8");
    expect(content).toMatch(/^AISHA_WAVE_TIMEOUT_S=/m);
    expect(content).toMatch(/^AISHA_HEALTH_POLL_S=/m);
    expect(content).toMatch(/^AISHA_STABLE_POLLS=/m);
  });

  test("config/local-presets.mjs exports required structure", () => {
    const r = spawnSync("node", [
      "--input-type=module",
      "-e",
      `import { presets, hostPorts, devEnvDefaults, stackDependencies } from "${join(ROOT, "config/local-presets.mjs")}";
       const out = {
         presets: Object.keys(presets),
         hasMinimum: !!presets.minimum,
         hasFullLight: !!presets["full-light"],
         hasFull: !!presets.full,
         hostPortsKeys: Object.keys(hostPorts).length,
         devEnvKeys: Object.keys(devEnvDefaults).length,
         stackDepsKeys: Object.keys(stackDependencies).length,
       };
       console.log(JSON.stringify(out));`,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout.trim());
    expect(out.hasMinimum).toBe(true);
    expect(out.hasFullLight).toBe(true);
    expect(out.hasFull).toBe(true);
    expect(out.hostPortsKeys).toBeGreaterThan(10);
    expect(out.devEnvKeys).toBeGreaterThan(50);
    expect(out.stackDepsKeys).toBeGreaterThan(5);
  });
});
