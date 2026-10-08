import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKRIPT = join(dirname(fileURLToPath(import.meta.url)), "npm-scope-guard.sh");
const docasne = [];
afterEach(() => {
  for (const d of docasne.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Spustí stráž nad vlastním (dočasným) uživatelským npmrc; vrátí jeho obsah. */
function straz(verdaccio) {
  const domov = mkdtempSync(join(tmpdir(), "npm-scope-guard-"));
  docasne.push(domov);
  const npmrc = join(domov, ".npmrc");
  const env = { PATH: process.env.PATH, HOME: domov, NPM_CONFIG_USERCONFIG: npmrc };
  if (verdaccio !== undefined) env.VERDACCIO_URL = verdaccio;
  const r = spawnSync("bash", [SKRIPT], { env, encoding: "utf8" });
  return { kod: r.status, vystup: r.stdout + r.stderr, npmrc: readFileSync(npmrc, "utf8") };
}

describe("npm-scope-guard: soukromé scope NIKDY nespadnou na veřejný registr", () => {
  it("s Verdacciem (opt-in) míří @aisha i @evymo tam", () => {
    const { kod, npmrc } = straz("https://npm.example.test/");
    expect(kod).toBe(0);
    expect(npmrc).toMatch(/^@aisha:registry=https:\/\/npm\.example\.test\/$/m);
    expect(npmrc).toMatch(/^@evymo:registry=https:\/\/npm\.example\.test\/$/m);
  });

  it("⛔ bez Verdaccia se scope zamknou do nedosažitelného registru — ne na npmjs", () => {
    for (const hodnota of [undefined, ""]) {
      const { kod, vystup, npmrc } = straz(hodnota);
      expect(kod).toBe(0);
      expect(npmrc).toMatch(/^@aisha:registry=https:\/\/[^/\s]+\.invalid\/$/m);
      expect(npmrc).toMatch(/^@evymo:registry=https:\/\/[^/\s]+\.invalid\/$/m);
      expect(npmrc).not.toMatch(/registry\.npmjs\.org/);
      expect(vystup).toMatch(/nedosažitelný registr/);
    }
  });
}, 60_000);
