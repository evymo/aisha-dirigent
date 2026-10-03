/**
 * Brána: external-klic-je-opravdu-operatorsky
 *
 * INVARIANT: povinnost dodat hodnotu se ODVOZUJE od toho, jestli ji v tomhle
 * nasazení někdo konzumuje. Klíč druhu `external`, který v celém stromu nikdo
 * nečte, nesmí být hlášen jako chybějící — je to zbytek po jiné instalaci,
 * ne vada téhle.
 *
 * PROČ: `external` je jediný druh, který si doktor nedoplní. Každý falešně
 * povinný klíč je ruční krok navíc u instalace, která ho nepotřebuje — a u
 * `coolify-sync-envs.sh` (běží `--report --strict`) je to rovnou zastavené
 * nasazení.
 *
 * NAMĚŘENO 2026-08-14 při obnově aisha.guru: z klíčů druhu `external` jich 16
 * patřilo volitelným konektorům (`EW_*`, `TC_*`, `MONEY_*`) a v celém stromu
 * neměly ANI JEDEN výskyt — ani v compose, ani v katalogu, ani v kódu. Přesto
 * je preflight vyžadoval. Uživatel to pojmenoval přesně: takové služby se mají
 * dát nasadit bez nich a cold-start si má sám odvodit, co je podle zapnutých
 * pluginů potřeba.
 *
 * CO SE MĚŘÍ (vlastnost, ne vzorek — jde přes VŠECHNY vypsané klíče, oběma
 * směry, a čte se ŽIVÝ VÝSTUP doktora, ne jeho zdroják):
 *
 *   (1) Každý klíč, který doktor odsune do „bez konzumenta", tam patří —
 *       nezávislé přeměření (`git grep -w`) ho v stromu opravdu nenajde.
 *   (2) Každý klíč, který doktor hlásí jako blokující „still missing", má
 *       konzumenta. Tenhle směr je ten podstatný: kdyby se odvození vypnulo,
 *       spadne sem i `EW_*` a brána to okamžitě ukáže.
 *
 * PROČ ZA BĚHU: kontrakt se z části skládá spreadem nad `config/image-versions.env`
 * a povinnost se počítá až proti obsahu stromu — statická analýza zdrojáku by
 * měřila něco jiného než to, co nasazení opravdu udělá. Doktor běží s vlastním
 * `ENV_FILE` v tempu a v režimu `--report`, takže nic nezapisuje.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");

const NADPIS_BEZ_KONZUMENTA = "External keys bez konzumenta";
const NADPIS_CHYBI = "External keys still missing";

/** ANSI pryč — jinak by se porovnávaly barvy, ne klíče. */
function bezBarev(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

/**
 * Spustí doktora nad PRÁZDNÝM env souborem (žádný vault) a vrátí obě sekce.
 * Prázdný vstup je jediné stanoviště, ze kterého jsou obě sekce vidět: s
 * plným `.env-prod-backup` se externals vyřeší a neměřilo by se nic.
 */
/**
 * Doktor nad PRÁZDNÝM vstupem, ne nad trezorem toho, kdo bránu pouští.
 *
 * ⛔ NAMĚŘENO 2026-09-14 v pracovní kopii operátora: doktor si načte
 * `.env-prod-backup` i cílový `.env.coolify` ze souborů (ne z prostředí) a
 * od chvíle, kdy instance s deklarovaným overlayem bez cesty k němu odmítá
 * odvozovat (instance-overlay.mjs), brána spadla — v CI prošla, protože tam
 * trezor není. Verdikt tak řídil trezor, ne kód. Temp ENV_FILE + `--no-external`
 * + bez vstupů resolveru = totéž stanoviště lokálně i v CI.
 */
function izolovaneProstredi(envFile: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of [...RESOLVER_ENV_INPUTS, "ENV_FILE", "AISHA_STORY"]) delete env[k];
  return { ...env, ENV_FILE: envFile, AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi" };
}

function sekceDoktora(): {
  bezKonzumenta: string[];
  chybi: string[];
  syrovy: string;
  ocekavanoChybejicich: number;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-env-doctor-brana-"));
  const envFile = path.join(dir, "env.test");
  writeFileSync(envFile, "");
  const r = spawnSync(process.execPath, [DOCTOR, "--report", "--no-external"], {
    cwd: ROOT,
    encoding: "utf8",
    // ⛔ NAMĚŘENO 2026-08-15 v CI: se 120 s byl doktor ZABIT uprostřed výpisu.
    // Prohledává všech ~11,5 tis. sledovaných souborů kvůli odvození
    // konzumovaných klíčů; lokálně s teplou cache 1,7 s, na sdíleném runneru
    // pod zátěží násobně víc.
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    env: izolovaneProstredi(envFile),
  });
  // ⛔ USEKNUTÝ VÝSTUP ZABITÉHO PROCESU NENÍ MĚŘENÍ.
  //
  // Tohle brána dřív nekontrolovala — a naměřený důsledek byl, že přisoudila
  // vadu NESPRÁVNÉMU VINÍKOVI: při timeoutu se stihl vytisknout souhrnný řádek
  // `✗ external: 30`, ale ne už sekce s výpisem, a brána z toho usoudila
  // „doktor si protiřečí, výpis a účtování se rozešly". Doktor si neprotiřečil.
  // Nedopsal.
  //
  // `status === null` znamená konec signálem (SIGTERM z timeoutu), `r.error`
  // nese ETIMEDOUT/ENOBUFS. Obojí je selhání NÁSTROJE a musí se tak i jmenovat
  // (feedback_tool_failure_read_as_data).
  if (r.error || r.signal || r.status === null) {
    throw new Error(
      `env-doktor nedoběhl — jeho výstup NENÍ měření: ` +
        `signal=${r.signal ?? "—"} error=${r.error ? (r.error as Error).message : "—"} status=${r.status}. ` +
        `Přečteno ${(r.stdout ?? "").length} B stdout. Tohle není nález o kontraktu, ale o běhu nástroje.`,
    );
  }
  const syrovy = bezBarev(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  // ⛔ NAMĚŘENO 2026-08-14 v CI: první verze vyžadovala PŘÍTOMNOST sekce
  // „External keys still missing". Jenže doktor vypisuje jen NEPRÁZDNÉ sekce —
  // a v CI (kde chybí `.env-prod-backup` i celé prostředí) může být seznam
  // prázdný. Brána pak padala na tvrzení o svém vlastním předpokladu, ne na
  // měřené vlastnosti.
  //
  // Doklad, že nástroj BĚŽEL, dává souhrnný řádek, který se tiskne VŽDY:
  //     ✗ external:     N (need .env-prod-backup or manual)
  // Z něj se vezme N. Je-li N > 0 a sekce chybí, je to skutečná vada výpisu;
  // je-li N == 0, není co třídit a řekne se to nahlas (viz první test).
  const souhrn = syrovy.match(/external:\s+(\d+)\s+\(need/);
  if (!souhrn) {
    throw new Error(
      `doktor nevypsal souhrnný řádek "external: N" (exit=${r.status}) — nedoběhl tam, ` +
        `kde se externals účtují, takže by se měřilo mlčení. Prvních 800 znaků:\n${syrovy.slice(0, 800)}`,
    );
  }
  const ocekavanoChybejicich = Number(souhrn[1]);
  if (ocekavanoChybejicich > 0 && !syrovy.includes(NADPIS_CHYBI)) {
    throw new Error(
      `souhrn hlásí ${ocekavanoChybejicich} chybějících externals, ale sekce "${NADPIS_CHYBI}" chybí — ` +
        `výpis a účtování se rozešly.\n` +
        // Bez ukázky výstupu je tahle hláška v CI k nepoužití: neřekne, jestli
        // doktor sekci VYNECHAL, nebo ji jen nestihl. Posledních pár řádků to
        // rozhodne na první pohled.
        `Posledních 15 řádků výstupu (${syrovy.length} B celkem):\n` +
        syrovy.trimEnd().split("\n").slice(-15).join("\n"),
    );
  }
  const radky = syrovy.split("\n");
  const posbirej = (nadpis: string): string[] => {
    const i = radky.findIndex((x) => x.includes(nadpis));
    if (i === -1) return [];
    const out: string[] = [];
    for (const r of radky.slice(i + 1)) {
      const m = r.match(/^\s*[○✗]\s+([A-Z][A-Z0-9_]*)\s*$/);
      if (!m) break;
      out.push(m[1]);
    }
    return out;
  };
  return {
    bezKonzumenta: posbirej(NADPIS_BEZ_KONZUMENTA),
    chybi: posbirej(NADPIS_CHYBI),
    syrovy,
    ocekavanoChybejicich,
  };
}

/**
 * Nezávislé přeměření: čte ten klíč někdo ve sledovaném stromu?
 *
 * Schválně JINOU cestou než doktor (`git grep -w` místo vlastního skenu), aby
 * se obě strany nemohly mýlit stejně.
 */
function maKonzumenta(klic: string): boolean {
  const r = spawnSync(
    "git",
    ["grep", "-l", "-w", "--", klic, "--",
      // Celý strom mínus próza: dokumentace klíč ZMIŇUJE, nekonzumuje ho.
      // Vlastní kontrakt taky ne — deklarace není spotřeba (viz níž).
      ":(exclude)docs/", ":(exclude)*.md", ":(exclude)*.example", ":(exclude)*.sample"],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git grep pro ${klic} selhal (status=${r.status}): ${r.stderr}`);
  }
  // Kontrakt samotný NENÍ konzument — je to deklarace. Kdyby se počítal, měl by
  // konzumenta každý klíč a měření by nikdy nic neřeklo.
  return (r.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .some((f) => !f.endsWith("scripts/aisha-env-doctor.mjs"));
}

describe("brána: external-klic-je-opravdu-operatorsky", () => {
  const { bezKonzumenta, chybi, syrovy, ocekavanoChybejicich } = sekceDoktora();

  it("doktor opravdu běžel a jeho účtování sedí s výpisem (mlčení není měření)", () => {
    expect(syrovy.length, "prázdný výstup doktora").toBeGreaterThan(500);
    // Kolik jich doktor NAÚČTOVAL == kolik jich VYPSAL. Rozejít se to nesmí:
    // pak by kterýkoli z dalších testů měřil jinou množinu, než o které se mluví.
    expect(chybi.length, "souhrn a výpis blokujících externals se rozešly").toBe(ocekavanoChybejicich);
    // Když není co třídit, řekne se to — a další dva testy projdou prázdné
    // ZÁMĚRNĚ, ne mlčky.
    if (bezKonzumenta.length + chybi.length === 0) {
      console.warn(
        "[brána] doktor v tomhle prostředí nevyhodnotil ANI JEDEN external — " +
          "obě klasifikace jsou tedy prázdné; měří se jen to, že účtování a výpis sedí",
      );
    }
  });

  it("klíč odsunutý jako „bez konzumenta\" v stromu opravdu nikdo nečte", () => {
    const omylem = bezKonzumenta.filter((k) => maKonzumenta(k));
    expect(
      omylem,
      "Tyhle klíče doktor prohlásil za nepotřebné, ale strom je čte — jejich chybění\n" +
        "je skutečná vada, kterou by nasazení nemělo přejít mlčky:\n  " + omylem.join("\n  "),
    ).toEqual([]);
  });

  it("klíč hlášený jako blokující má v stromu konzumenta", () => {
    const zbytecne = chybi.filter((k) => !maKonzumenta(k));
    expect(
      zbytecne,
      "Preflight vyžaduje hodnoty pro spotřebitele, který v tomhle nasazení neexistuje.\n" +
        "Tohle je přesně ta třída, která 2026-08-14 zastavila cold-start (EW_*/TC_*/MONEY_*):\n  " +
        zbytecne.join("\n  "),
    ).toEqual([]);
  });
});
