/**
 * env-doktor NEVYPÍŠE hodnotu tajemství — ani celou, ani začátek.
 *
 * ⛔ NAMĚŘENO 2026-09-16 v logu cold-startu instance (režim APPLY, tedy hodnoty,
 * které se skutečně zapsaly a nasadily): sekce „Keys to add" tiskla u každého
 * přidaného klíče `v.slice(0, 27)…`, u hodnoty do 30 znaků celou. V logu byl
 * celý jeden přístupový klíč k úložišti a prvních 27 znaků dalších 14 tajemství
 * (tokeny appservice, heslo PKI bootstrap klienta, admin Grafany…). Logy
 * cold-startu se ukládají a sdílí; tajemství do nich nepatří v žádné délce.
 *
 * ⭐ Brána SPOUŠTÍ doktora v APPLY nad prázdným souborem (vygeneruje všechno,
 * co umí), přečte, co ZAPSAL, a měří VLASTNOST výstupu: žádná hodnota klíče
 * s druhem tajemství (a žádný alias, který ji nese) se ve stdout ani stderr
 * neobjeví — ani jejím prvním osmi znaky. Druhy bere z `--print-contract-keys`,
 * ne ze seznamu v bráně, takže nové tajemství v kontraktu pokryje samo.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
const DRUHY_TAJEMSTVI = new Set(["secret", "hex", "b64std"]);
const PREFIX = 8;

function druhyKontraktu(): Map<string, string> {
  const r = spawnSync("node", [DOKTOR, "--print-contract-keys"], {
    cwd: ROOT,
    env: { ...process.env, AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi" },
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`--print-contract-keys skončil ${r.status}: ${r.stderr}`);
  const druhy = new Map<string, string>();
  for (const radek of r.stdout.split("\n")) {
    const [klic, druh] = radek.split("\t");
    if (klic && druh && klic !== "__CONTRACT_END__") druhy.set(klic, druh);
  }
  return druhy;
}

function behDoktora(): { vystup: string; zapsano: Map<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-tajemstvi-"));
  // Soubor NEEXISTUJE = čistý start (prázdný existující doktor správně odmítne
  // jako rozepsaný zápis). Identita je zkušební: bez ní doktor nic neodvodí.
  const envFile = join(dir, "env.coolify");
  try {
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env: {
        ...process.env,
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
    if (beh.status !== 0 || !existsSync(envFile)) {
      throw new Error(`env-doktor skončil ${beh.status} bez zápisu: ${(beh.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
    }
    const zapsano = new Map<string, string>();
    for (const radek of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
      if (m) zapsano.set(m[1], m[2].replace(/^["']|["']$/g, ""));
    }
    return { vystup: `${beh.stdout ?? ""}\n${beh.stderr ?? ""}`, zapsano };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("env-doktor nevypíše tajemství (brána)", () => {
  const druhy = druhyKontraktu();
  const { vystup, zapsano } = behDoktora();
  const tajemstvi = [...zapsano].filter(([k, v]) => DRUHY_TAJEMSTVI.has(druhy.get(k) ?? "") && v.length >= PREFIX);

  test("univerzum: doktor vygeneroval tajemství a vypsal sekci přidaných klíčů", () => {
    expect(tajemstvi.length, "doktor nezapsal žádné tajemství — brána by měřila prázdno").toBeGreaterThan(20);
    expect(vystup).toContain("Keys to add");
  });

  test("⛔ ve výstupu není žádná hodnota tajemství ani její začátek", () => {
    const unikle = tajemstvi.filter(([, v]) => vystup.includes(v.slice(0, PREFIX))).map(([k]) => k);
    expect(unikle, "doktor vypsal (část) hodnoty tajemství").toEqual([]);
  });
});
