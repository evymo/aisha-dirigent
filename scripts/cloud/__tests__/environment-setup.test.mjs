// scripts/cloud/environment-setup.sh — platformní repo se hledá podle jména
// balíčku (repo se přejmenovalo aisha-orchestrator → aisha-dirigent) a souhrn
// odliší přeskočený krok od úspěšného. Skript se načte přes `source`, kroky
// (instalace, docker) se nespustí.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../environment-setup.sh");
const temps = [];

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-setup-"));
  temps.push(dir);
  return dir;
}

function withPackage(root, dirName, pkgName) {
  mkdirSync(path.join(root, dirName), { recursive: true });
  writeFileSync(path.join(root, dirName, "package.json"), JSON.stringify({ name: pkgName }, null, 2));
}

/** Spustí bash, načte skript a provede `body` s přepsaným ROOT/LOGDIR. */
function run(root, body) {
  return execFileSync(
    "bash",
    ["-c", `source "${SCRIPT}"; ROOT="${root}"; LOGDIR="${root}/log"; SUMMARY="${root}/log/summary.txt"; mkdir -p "${root}/log"; ${body}`],
    { encoding: "utf8" },
  );
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("environment-setup.sh — platformní repo", () => {
  it("najde repo podle jména balíčku bez ohledu na jméno adresáře", () => {
    const root = tempRoot();
    withPackage(root, "aisha-extranet-sdk", "@aisha/extranet-sdk");
    withPackage(root, "aisha-dirigent", "aisha-platform");
    expect(run(root, "platform_repo").trim()).toBe(path.join(root, "aisha-dirigent"));
  });

  it("bez platformního repa krok selže (✗), nehlásí úspěch", () => {
    const root = tempRoot();
    withPackage(root, "potok", "potok");
    run(root, "step aisha-orchestrator orchestrator; wait");
    const summary = readFileSync(path.join(root, "log/summary.txt"), "utf8");
    expect(summary).toMatch(/^✗ aisha-orchestrator/m);
  });

  it("chybějící volitelné repo je v souhrnu přeskočené, ne ✓", () => {
    const root = tempRoot();
    run(root, "step venv-potok venv_potok; wait");
    const summary = readFileSync(path.join(root, "log/summary.txt"), "utf8");
    expect(summary).toMatch(/^– venv-potok \(přeskočeno: repo chybí: .*potok\)$/m);
  });

  it("source skriptu nespouští kroky", () => {
    const root = tempRoot();
    expect(run(root, "echo načteno").trim()).toBe("načteno");
  });
});
