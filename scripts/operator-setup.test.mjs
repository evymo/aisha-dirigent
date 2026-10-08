/**
 * operator-setup --verify — kód env-doktora „WEB_FQDNS neznám" není selhání ověření.
 *
 * ⛔ Revize 5b5045d8a (2026-10-05): env-doktor od té doby končí kódem
 * KOD_ENV_DOKTORA_WEB_NEVIM, když WEB_FQDNS (domény webu) nezná — na instalaci
 * před prvním cold-startem VŽDY (klíč smí založit jen cold-start). `--verify`
 * bral jakoukoli nenulu jako selhání, takže čerstvá instalace by ověřením
 * nikdy neprošla. Měří se skutečný operator-setup proti atrapě env-doktora
 * (ROOT = cwd): 0 a 3 projdou, 3 řekne proč; kotva — 2 (pád doktora) dál selže.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { KOD_ENV_DOKTORA_WEB_NEVIM } from "./lib/domenovy-overlay.mjs";

const SKRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "operator-setup.mjs");
const docasne = [];
afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
});

/** operator-setup --verify v kořeni, kde env-doktor je atrapa končící daným kódem. */
function overeni(kodDoktora) {
  const koren = mkdtempSync(path.join(tmpdir(), "operator-setup-verify-"));
  docasne.push(koren);
  mkdirSync(path.join(koren, "scripts"));
  writeFileSync(path.join(koren, "scripts", "aisha-env-doctor.mjs"), `process.exit(${kodDoktora});\n`);
  const r = spawnSync(process.execPath, [SKRIPT, "--verify"], {
    cwd: koren,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: koren },
    timeout: 60_000,
  });
  return { kod: r.status, vystup: `${r.stdout}${r.stderr}` };
}

describe("operator-setup --verify a kód env-doktora", () => {
  it("0 → ověření projde", () => {
    const r = overeni(0);
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/Preflight passed/);
  });

  it(`${KOD_ENV_DOKTORA_WEB_NEVIM} (WEB_FQDNS neznám, čerstvá instalace) → ověření projde a řekne, že klíč založí cold-start`, () => {
    const r = overeni(KOD_ENV_DOKTORA_WEB_NEVIM);
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/WEB_FQDNS \(domény webu\) zatím neznám — založí ho první cold-start/);
    expect(r.vystup).toMatch(/Preflight passed/);
  });

  it("kotva: 2 (pád env-doktora) → ověření dál SELŽE", () => {
    const r = overeni(2);
    expect(r.kod, r.vystup).toBe(1);
    expect(r.vystup).toMatch(/Preflight reported problems/);
    expect(r.vystup).not.toMatch(/WEB_FQDNS/);
  });
});
