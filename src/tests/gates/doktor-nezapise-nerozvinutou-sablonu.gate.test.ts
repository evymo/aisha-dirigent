/**
 * Env-doktor nezapíše NEROZVINUTOU ŠABLONU — žádný druh klíče.
 *
 * ⛔ NAMĚŘENO 2026-09-27 dry-runem nad trezorem instance (main 23faca010):
 * doktor chtěl zapsat `WEB_PUSH_VAPID_SUBJECT = https://${APP_DOMAIN:-}`.
 * `dom()` vrací doslovný řádek z config/domains.env, když klíč neleží v trezoru
 * ani v prostředí — `APP_DOMAIN=${APP_DOMAIN:-}` je sebeodkaz, a do topologie
 * (která APP_DOMAIN vydává) `dom()` nesahá. coolify-sync-envs by text rozeslal
 * doslovně. Kontrakt má takových složenin `https://${dom(X)}` osm.
 *
 * Co se drží (měří se ZAPSANÝ soubor, ne výpis ani text kódu):
 *   1. doména instance je uložená → VAPID subject se složí z ní;
 *   2. doména chybí → subject se NEZAPÍŠE (ani `https://${…}`, ani holé
 *      `https://`) a doktor to vypíše;
 *   3. v celém zapsaném souboru není jediná hodnota s `${`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
const SUBJEKT = "WEB_PUSH_VAPID_SUBJECT";

interface Beh {
  vystup: string;
  radky: Map<string, string[]>;
}

/** Doktor v APPLY nad dočasným souborem; `start` = obsah před během (null = soubor není). */
function behDoktora(start: string | null): Beh {
  const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-sablona-"));
  const envFile = join(dir, "env.coolify");
  try {
    if (start !== null) writeFileSync(envFile, start, { mode: 0o600 });
    // Doména NESMÍ přitéct z prostředí běžce — měří se, co doktor udělá bez ní.
    const { APP_DOMAIN: _pryc, ...prostredi } = process.env;
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env: {
        ...prostredi,
        ENV_FILE: envFile,
        APP_NAME_PREFIX: "zkouska",
        AISHA_STORY: "zkouska",
        AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (beh.error) throw beh.error;
    if (!envDoktorDokoncil(beh.status) || !existsSync(envFile)) {
      throw new Error(`env-doktor skončil ${beh.status}: ${(beh.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
    }
    const radky = new Map<string, string[]>();
    for (const radek of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
      if (m) radky.set(m[1], [...(radky.get(m[1]) ?? []), m[2].replace(/^["']|["']$/g, "")]);
    }
    return { vystup: `${beh.stdout ?? ""}\n${beh.stderr ?? ""}`, radky };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Klíče, jejichž zapsaná hodnota nese `${` — kladná kotva: soubor se opravdu přečetl. */
function sablonyVSouboru(b: Beh): string[] {
  expect(b.radky.size, "zapsaný soubor je skoro prázdný — měření by bylo slepé").toBeGreaterThan(100);
  return [...b.radky].filter(([, hodnoty]) => hodnoty.some((h) => h.includes("${"))).map(([k]) => k);
}

describe("env-doktor nezapíše nerozvinutou šablonu (brána)", () => {
  test("uložená doména instance → VAPID subject se složí z ní", () => {
    const b = behDoktora("APP_DOMAIN=app.zkouska.test\n");
    expect(b.radky.get(SUBJEKT), `${SUBJEKT} se nezapsal`).toEqual(["https://app.zkouska.test"]);
    expect(sablonyVSouboru(b)).toEqual([]);
  });

  test("⛔ doména chybí → subject se nezapíše (ani šablona, ani holé https://) a doktor to řekne", () => {
    const b = behDoktora(null);
    const subjekt = b.radky.get(SUBJEKT) ?? [];
    expect(subjekt.filter((h) => h !== ""), `${SUBJEKT} nesmí nést hodnotu bez domény`).toEqual([]);
    expect(b.vystup).toContain("NEROZVINUTÁ ŠABLONA");
    expect(b.vystup).toContain(SUBJEKT);
    expect(sablonyVSouboru(b), "zapsaná hodnota nese doslovné `${…}`").toEqual([]);
  });
});
