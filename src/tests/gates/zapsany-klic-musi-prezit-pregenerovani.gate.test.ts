/**
 * Brána: co pipeline zapíše do env, musí přežít přegenerování.
 *
 * TŘÍDA VADY. `.env.coolify` NENÍ zdroj pravdy, je to VYGENEROVANÝ ARTEFAKT —
 * cold-start ho staví heredocem od nuly. Skripty do něj přitom průběžně
 * zapisují pověření (`upsert_env`). Klíč, který nemá žádnou cestu zpět, se tím
 * při nejbližším přegenerování TICHO ZAHODÍ. Není „prázdný" — je aktivně smazaný.
 *
 * Naměřeno 2026-08-20: `AISHA_BOOTSTRAP_PASSWORD` a `_CLIENT_SECRET` neměly
 * cestu žádnou. Následek se ale neprojevil na nich, nýbrž o tři vrstvy níž:
 * bez nich se mesh peer discovery ověřoval servisním účtem, ten se na prázdném
 * datastoru stal VLASTNÍKEM účtu, a protože servisní účty Keycloak do výpisu
 * uživatelů nedává, management ho hlásil jako neznámého a odpovídal
 * „user is pending approval". Peer discovery pak vracel 403, adresa jádra
 * zůstala prázdná, mesh-router neměl cíl pro DNAT a api odpovídalo 502.
 * Vypadalo to na čekání na schválení; schvalovat přitom nebylo co.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   Pro KAŽDÝ klíč, který nějaký skript zapisuje přes `upsert_env`, musí
 *   existovat aspoň jedna cesta, kterou hodnota přegenerování přežije:
 *     (a) řádek v heredocu cold-startu,
 *     (b) `emit()` v generate-secrets (drží hodnotu i ji hlásí v --print-keys),
 *     (c) položka v kontraktu env-doktora (ten ji umí doplnit/zahojit).
 *
 * Univerzum se HLEDÁ (`git grep`), nepíše — jinak brána měří jen to, co už víme.
 * Právě tím tahle brána při vzniku našla pět dalších klíčů (PKI), u nichž je
 * cesta (c) a které by vyjmenovaný seznam minul.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

const COLD_START = "scripts/aisha-cold-start.sh";
const GENERATOR = "scripts/generate-secrets.mjs";
const DOKTOR = "scripts/aisha-env-doctor.mjs";

/** Klíče, které skripty zapisují do env souboru. Univerzum se HLEDÁ. */
function zapisovaneKlice(): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-hoE", 'upsert_env[[:space:]]+"?([A-Z][A-Z0-9_]+)"?', "--", "scripts/"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const klice = new Set<string>();
  for (const radek of out.split("\n")) {
    const m = radek.match(/upsert_env\s+"?([A-Z][A-Z0-9_]+)"?/);
    if (m) klice.add(m[1]);
  }
  return [...klice].sort();
}

function cestaHeredoc(zdroj: string, klic: string): boolean {
  return new RegExp(`^${klic}=`, "m").test(zdroj);
}

function cestaGenerator(printKeys: Set<string>, klic: string): boolean {
  return printKeys.has(klic);
}

function cestaDoktor(zdroj: string, klic: string): boolean {
  // Kontraktní tabulka doktora: ["KLÍČ", "druh", …]
  return new RegExp(`\\[\\s*"${klic}"\\s*,`).test(zdroj);
}

function nactiPrintKeys(): Set<string> {
  const r = spawnSync("node", [join(ROOT, GENERATOR), "--print-keys"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    throw new Error(
      `${GENERATOR} --print-keys skončil s ${r.status}: ${(r.stderr || "").slice(0, 400)}`,
    );
  }
  return new Set(
    (r.stdout || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /^[A-Z][A-Z0-9_]*$/.test(s)),
  );
}

describe("zapsaný klíč musí přežít přegenerování", () => {
  const klice = zapisovaneKlice();
  const coldStart = readFileSync(join(ROOT, COLD_START), "utf8");
  const doktor = readFileSync(join(ROOT, DOKTOR), "utf8");

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    // Sonda musí umět odpovědět „ne": kdyby se `upsert_env` přejmenovalo,
    // seznam by osiřel a brána by tiše zezelenala nad nulou.
    expect(klice.length).toBeGreaterThan(0);
  });

  test("měřidlo pozná klíč BEZ cesty (fixtura, která umí říct ne)", () => {
    const vymysleny = "TENTO_KLIC_NIKDE_NEEXISTUJE_XYZ";
    expect(cestaHeredoc(coldStart, vymysleny)).toBe(false);
    expect(cestaDoktor(doktor, vymysleny)).toBe(false);
    // a naopak: klíč, který cestu MÁ, se pozná
    expect(cestaDoktor(doktor, "AISHA_PKI_BOOTSTRAP_PASSWORD")).toBe(true);
  });

  test("každý zapisovaný klíč má aspoň jednu cestu zpět", () => {
    const printKeys = nactiPrintKeys();
    expect(printKeys.size).toBeGreaterThan(0);

    const bezCesty: string[] = [];
    for (const k of klice) {
      const a = cestaHeredoc(coldStart, k);
      const b = cestaGenerator(printKeys, k);
      const c = cestaDoktor(doktor, k);
      if (!a && !b && !c) bezCesty.push(k);
    }

    expect(
      bezCesty,
      [
        `Tyhle klíče se do env ZAPISUJÍ, ale nic je po přegenerování nevrátí:`,
        ...bezCesty.map((k) => `  - ${k}`),
        ``,
        `CO S TÍM — stačí JEDNA z cest, podle toho, čím ta hodnota je:`,
        `  (a) hodnotu vyrábí ČLOVĚK nebo vnější systém → řádek do heredocu`,
        `      v ${COLD_START} ve tvaru KLIC=\${KLIC:-} A ZÁROVEŇ`,
        `      emit('KLIC', preservedValue('KLIC')) v ${GENERATOR};`,
        `      samotný heredoc hodnotu nedrží, samotný emit ji heredoc přepíše.`,
        `  (b) hodnotu vyrábíme my → emit() s generátorem v ${GENERATOR}.`,
        `  (c) hodnotu umí doplnit doktor → položka v jeho kontraktní tabulce`,
        `      v ${DOKTOR} (tak to mají PKI bootstrap klíče).`,
        ``,
        `NEDĚLEJ: nepřidávej klíč do seznamu výjimek. Tahle brána neměří`,
        `pravopis, ale jestli hodnota PŘEŽIJE — výjimka by to nezařídila.`,
        `NEDĚLEJ: nedosazuj u hesla náhodnou náhradní hodnotu, pokud se musí`,
        `shodovat s protějškem (Keycloak). Špatné heslo je horší než prázdné —`,
        `prázdno je vidět, neshoda vypadá jako porucha protějšku.`,
      ].join("\n"),
    ).toEqual([]);
  });
});
