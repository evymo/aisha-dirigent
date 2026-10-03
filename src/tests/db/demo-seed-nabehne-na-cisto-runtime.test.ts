import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable, reportTestCapabilities } from "./test-env-probe";
// ⛔ K overlayi vedou JEDNY dveře (brána overlay-jde-jen-jednemi-dvermi):
// AISHA_INSTANCE_CONFIG_DIR čte jedině rozcestník. Tenhle test se ptá na opak
// než ostatní konzumenti — chce mít jistotu, že overlay NENÍ — ale i ta otázka
// musí projít týmiž dveřmi, jinak by vznikla druhá cesta ke stejné proměnné.
// Rozcestník je .mjs sdílený se skripty; typy si TS odvodí z JSDoc v něm.
import { overlayDir } from "../../../scripts/lib/instance-overlay.mjs";

/**
 * DEMO SEED NA ČISTÉ DATABÁZI — běhový důkaz (throwaway PG).
 *
 * ⛔ PROČ: tři sourozenecké brány měří SOUBOR — `seed-compiled-sync` porovnává
 * bajty zakommitovaného seedu proti profilu, `seed-layer-profiles` chování
 * kompilátoru a `demo-seed-nesmi-do-produkce` odmítnutí propadnout na
 * zakommitovaný seed. ŽÁDNÁ neměří BĚH: že se seed profilu `demo` opravdu
 * aplikuje na prázdnou databázi a že se přitom něco zapíše. Zelený soubor a
 * naběhnutý svět jsou dvě různá tvrzení.
 *
 * Měří se POSTUP, ne absence chyby: „prošlo bez chyby" umí i prázdný soubor.
 * Proto se počítá, o kolik řádků svět vyrostl, a proto je tu NEGATIVNÍ SONDA —
 * prázdný a chybějící seed musí dát ZÁPORNÝ verdikt. Bez ní by zelená znamenala
 * „nic nespadlo", ne „aplikovalo se".
 *
 * BEZ INSTANČNÍHO OVERLAYE. Základ musí naběhnout i bez instančních dat a bez
 * šablony; nastavený `AISHA_INSTANCE_CONFIG_DIR` je proto NÁLEZ, ne důvod ho
 * doplnit — měřil by se jiný svět. Brána nezná a nesmí znát jméno instance.
 *
 * Spouštět na databázi BEZ seedu:
 *   AISHA_TESTDB_NO_SEED=1 node scripts/db/with-throwaway-db.mjs -- \
 *     npx vitest run src/tests/db/demo-seed-nabehne-na-cisto-runtime.test.ts
 */

const dbAvailable = isPgReachable();
const SEED = "aisha/db/seed.compiled.sql";
/** Tabulky, do kterých seed sype — měřítko „něco se opravdu zapsalo". */
const MERIDLO = ["public.translations", "public.knowledge_items", "public.expert_rules", "public.context_profiles"];

const psqlArgs = (extra: string[]) => [
  "-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", ...extra,
];
const env = () => ({ ...process.env, PGPASSWORD: PG_PASSWORD });

function velikostSveta(): number {
  const dotaz = MERIDLO.map((t) => `(select count(*) from ${t})`).join(" + ");
  return Number(execFileSync("psql", psqlArgs(["-c", `select ${dotaz}`]), { encoding: "utf8", env: env() }).trim());
}

/**
 * Aplikuje soubor a vrátí VERDIKT: povedlo se, a zapsalo to něco?
 * Chybějící soubor i selhání psql = záporný verdikt, ne výjimka — o to tu jde.
 */
function seedNabehl(soubor: string): { ok: boolean; pred: number; po: number; duvod?: string } {
  const pred = velikostSveta();
  if (!existsSync(soubor)) return { ok: false, pred, po: pred, duvod: "soubor neexistuje" };
  try {
    execFileSync("psql", psqlArgs(["-f", soubor]), { encoding: "utf8", env: env(), stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const po = velikostSveta();
    return { ok: false, pred, po, duvod: `psql selhal: ${(e as Error).message.slice(0, 200)}` };
  }
  const po = velikostSveta();
  return { ok: po > pred, pred, po, duvod: po > pred ? undefined : "aplikovalo se, ale nic nepřibylo" };
}

beforeAll(async () => {
  await reportTestCapabilities("Demo seed na čisté databázi");
});

describe("demo seed na čisté databázi", () => {
  it("měří se svět BEZ instančního overlaye", () => {
    expect(
      overlayDir(),
      "instanční overlay je nastavený — tahle brána tvrdí, že základ naběhne BEZ instančních dat. " +
        "Nastavený overlay znamená, že se měří jiný svět; proměnnou nedoplňuj, odeber ji.",
    ).toBeNull();
  });

  it.skipIf(!dbAvailable)("zakommitovaný seed je profilu demo (jinak by se měřil jiný profil)", () => {
    expect(existsSync(SEED), `${SEED} chybí — není co aplikovat`).toBe(true);
    expect(readFileSync(SEED, "utf8").slice(0, 2000)).toMatch(/Profile:\s*demo/i);
  });

  it.skipIf(!dbAvailable)("na prázdné databázi projde a SVĚT VYROSTE", () => {
    const pred = velikostSveta();
    expect(
      pred,
      "databáze už je naseedovaná — tenhle běh by neměřil první aplikaci, " +
        "ale idempotenci. Spusť s AISHA_TESTDB_NO_SEED=1.",
    ).toBe(0);

    const v = seedNabehl(SEED);
    expect(v.ok, `seed demo profilu neprošel nebo nic nezapsal: ${v.duvod} (${v.pred} → ${v.po})`).toBe(true);
    expect(v.po).toBeGreaterThan(0);
  });

  it.skipIf(!dbAvailable)("NEGATIVNÍ SONDA: prázdný ani chybějící seed nesmí dát zelenou", () => {
    const prazdny = join(mkdtempSync(join(tmpdir(), "seed-sonda-")), "prazdny.sql");
    writeFileSync(prazdny, "-- záměrně prázdný seed\n");
    const vPrazdny = seedNabehl(prazdny);
    expect(vPrazdny.ok, "prázdný seed dal zelenou — měřidlo měří absenci chyby, ne postup").toBe(false);
    expect(vPrazdny.po).toBe(vPrazdny.pred);

    const vChybi = seedNabehl(join(tmpdir(), "tenhle-soubor-neexistuje-nikdy.sql"));
    expect(vChybi.ok, "chybějící seed dal zelenou").toBe(false);
    expect(vChybi.duvod).toMatch(/neexistuje/);
  });
});
