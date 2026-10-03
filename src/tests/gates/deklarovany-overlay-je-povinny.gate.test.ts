/**
 * Brána: instance, která overlay DEKLARUJE, ho musí mít — šablona je cizí instance
 *
 * ⛔ NAMĚŘENO 2026-09-13 na nasazeném forku. `aisha-redeploy` před každým
 * nasazením pouští env-doktora (`srovnejOdvozeneKlice()`), který odvozené klíče
 * srovná s derivací. Profil se hledal v `$AISHA_INSTANCE_CONFIG_DIR/profiles/`,
 * a když cesta nebyla exportovaná, TIŠE v šabloně `config/profiles/`. Dry-run
 * doktora na živém trezoru:
 *
 *   s cestou:  SPA_DIAGNOSE=0, EDGE_COMPOSE_PROFILES=extranet-gate,knock
 *   bez cesty: SPA_DIAGNOSE=1 [derived (drift opraven)],
 *              KC_ALLOWED_CLIENTS bez klientů instance
 *
 * Kdo pustil redeploy bez exportu, vrátil vrátného do měřicího režimu; služba
 * s nakonfigurovaným operátorem start odmítla a edge skončil degraded. Nic
 * nespadlo — „šablona, když overlay chybí" bylo pravidlo dveří.
 *
 * Instance přitom overlay DEKLARUJE: `AISHA_INSTANCE_DATA_GIT_URL` leží v jejím
 * trezoru, cold-start podle něj overlay klonuje a migrace ho nasazuje. Pro ni
 * šablona není „méně dat", ale data jiné instance.
 *
 * CO BRÁNA HLÍDÁ — každé tvrzení SPUŠTĚNÍM skutečného kódu, ne čtením textu:
 *   1. dveře (instance-overlay.mjs): deklarace bez cesty → výjimka, která řekne
 *      co chybí a NEPROZRADÍ přihlašovací údaje z URL; bez deklarace zůstává
 *      overlay volitelný (komunitní install na šablonách je legitimní)
 *   2. resolver (derive-domains): deklarace bez cesty → odmítne, nic nevydá;
 *      s cestou se instanční profil OPRAVDU použije (rozliší se od šablony)
 *   3. env-doktor tak, jak ho volá redeploy (apply, deklarace jen v CÍLOVÉM
 *      souboru): skončí nenulou, důvod na PRVNÍM řádku stderr (redeploy ukazuje
 *      začátek), soubor netknutý
 *   4. cold-start: nedostupný deklarovaný overlay končí, nepadá na šablony
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";
import { DECLARATION_ENV, OVERLAY_ENV, REQUIRED_ENV } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const DVERE = join(ROOT, "scripts/lib/instance-overlay.mjs");
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");

/** Heslo ve fixture URL — nesmí se objevit v žádném výstupu. */
const HESLO = "NEVYPISOVAT-heslo-z-url";
const DEKLARACE = `https://robot:${HESLO}@repo.example.invalid/org/instance-data.git#main`;

/**
 * Prostředí bez všeho, co by verdikt řídilo zvenku: vstupy resolveru (importem,
 * ne kopií) a overlayové proměnné JMENOVITĚ — kdyby deklarace ze seznamu
 * vstupů vypadla, brána se nesmí nechat řídit prostředím toho, kdo ji pouští.
 */
function cisteProstredi(navic: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of [...RESOLVER_ENV_INPUTS, OVERLAY_ENV, REQUIRED_ENV, DECLARATION_ENV, "ENV_FILE", "AISHA_STORY"]) {
    delete env[k];
  }
  return { ...env, ...navic };
}

/** Overlay jako adresář: instanční profil se ZNATELNÝM rozdílem proti šabloně. */
function overlayFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "aisha-overlay-povinny-"));
  mkdirSync(join(dir, "profiles"));
  mkdirSync(join(dir, "keycloak"));
  const profil = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8"));
  // Režim dveří patří dveřím: derivace odmítne knock.mode bez `knock` v edge_profiles
  // (lib/dvere-soulad.mjs) — fixture proto nese deklaraci celou, jako skutečná instance.
  profil.edge_profiles = ["knock"];
  profil.knock = { mode: "live" };
  writeFileSync(join(dir, "profiles/cloud-multi.json"), JSON.stringify(profil, null, 2));
  return dir;
}

const vystup = (r: { stdout?: string | null; stderr?: string | null }) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

describe("deklarovaný overlay je povinný", () => {
  describe("dveře (instance-overlay.mjs)", () => {
    const zeptejSe = (env: NodeJS.ProcessEnv) =>
      spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `import { overlayDirOrRequired } from ${JSON.stringify(DVERE)};
           try { console.log("CESTA=" + overlayDirOrRequired("brána")); }
           catch (e) { console.log("VYJIMKA=" + e.message); }`,
        ],
        { cwd: ROOT, env, encoding: "utf8" },
      );

    test("deklarace bez cesty → výjimka, která jmenuje cestu a neprozradí přihlášení", () => {
      const r = zeptejSe(cisteProstredi({ [DECLARATION_ENV]: DEKLARACE }));
      expect(
        r.stdout,
        "Instance overlay deklaruje, cesta chybí — a dveře vrátily null. Konzument pak\n" +
          "tiše sáhne po šabloně config/profiles/, tedy po profilu CIZÍ instance.\n" +
          "Naměřeno 2026-09-13: redeploy tak odvodil SPA_DIAGNOSE=1 a shodil vrátného.",
      ).toMatch(/^VYJIMKA=/m);
      expect(r.stdout).toContain(OVERLAY_ENV);
      expect(r.stdout, "hláška má říct, CO naklonovat (host a cesta repa)").toContain("repo.example.invalid/org/instance-data.git");
      expect(vystup(r), "přihlašovací údaje z URL se nesmí dostat do hlášky").not.toContain(HESLO);
    });

    test("bez deklarace zůstává overlay volitelný (komunitní install)", () => {
      const r = zeptejSe(cisteProstredi());
      expect(r.stdout.trim()).toBe("CESTA=null");
    });

    test("deklarace s existující cestou → cesta", () => {
      const dir = overlayFixture();
      const r = zeptejSe(cisteProstredi({ [DECLARATION_ENV]: DEKLARACE, [OVERLAY_ENV]: dir }));
      expect(r.stdout.trim()).toBe(`CESTA=${dir}`);
    });
  });

  describe("resolver (derive-domains)", () => {
    const odvod = (env: NodeJS.ProcessEnv) =>
      spawnSync("node", [DERIVE, "--profile=cloud-multi", "--shell"], { cwd: ROOT, env, encoding: "utf8" });
    const spaDiagnose = (stdout: string) => /^SPA_DIAGNOSE=(.*)$/m.exec(stdout)?.[1] ?? null;

    test("deklarace bez cesty → odmítne a nic ze šablony nevydá", () => {
      const r = odvod(cisteProstredi({ [DECLARATION_ENV]: DEKLARACE }));
      expect(r.status, `resolver prošel se šablonou:\n${r.stdout.slice(0, 400)}`).not.toBe(0);
      expect(spaDiagnose(r.stdout), "ze šablony se nesmí vydat ani jeden odvozený klíč").toBeNull();
      expect(r.stderr).toContain(OVERLAY_ENV);
      expect(vystup(r)).not.toContain(HESLO);
    });

    test("s cestou se instanční profil opravdu použije — a liší se od šablony", () => {
      const sablona = odvod(cisteProstredi());
      const instance = odvod(cisteProstredi({ [DECLARATION_ENV]: DEKLARACE, [OVERLAY_ENV]: overlayFixture() }));
      expect(sablona.status, sablona.stderr).toBe(0);
      expect(instance.status, instance.stderr).toBe(0);
      expect(
        [spaDiagnose(sablona.stdout), spaDiagnose(instance.stdout)],
        "fixture overlaye nese knock.mode=live, šablona ne — kdyby se hodnoty rovnaly,\n" +
          "brána by neuměla rozlišit, ZDA se overlay vůbec čte",
      ).toEqual(["1", "0"]);
    });
  });

  describe("env-doktor tak, jak ho volá redeploy", () => {
    /**
     * Apply (holý běh, jako `srovnejOdvozeneKlice()`), deklarace JEN v cílovém
     * souboru — instance nemusí mít .env-prod-backup, a doktor vstupy topologie
     * z cílového souboru vyzvedává. `--no-external`, aby operátorská záloha
     * v pracovní kopii toho, kdo bránu pouští, neřídila verdikt.
     */
    function doktor(navic: Record<string, string>) {
      const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-overlay-"));
      const soubor = join(dir, "env.coolify");
      const obsah = `AISHA_PROFILE=cloud-multi\nAPP_NAME_PREFIX=zkouska\n${DECLARATION_ENV}=${DEKLARACE}\n`;
      writeFileSync(soubor, obsah);
      const r = spawnSync("node", [DOKTOR, "--no-external"], {
        cwd: ROOT,
        env: cisteProstredi({ ENV_FILE: soubor, ...navic }),
        encoding: "utf8",
        timeout: 60_000,
      });
      return { r, obsah, poBehu: readFileSync(soubor, "utf8") };
    }

    test("bez cesty → nenulový kód, důvod na 1. řádku stderr, soubor netknutý", () => {
      const { r, obsah, poBehu } = doktor({});
      expect(r.status, `doktor prošel a odvodil klíče ze šablony:\n${r.stdout.slice(-600)}`).not.toBe(0);
      const prvni = r.stderr.split("\n").find((l) => l.trim() !== "") ?? "";
      expect(
        prvni,
        "redeploy z chyby doktora ukazuje ZAČÁTEK stderr (srovnejOdvozeneKlice). Výchozí výpis\n" +
          "nezachycené výjimky tam má `file:///…`, `throw new Error(` a `^` — nasazení by se\n" +
          "zastavilo bez jediného slova o chybějícím overlayi.",
      ).toContain(OVERLAY_ENV);
      expect(poBehu, "doktor, který odmítl odvodit, nesmí nic zapsat").toBe(obsah);
      expect(vystup(r)).not.toContain(HESLO);
    });

    test("s cestou dorazí do souboru hodnota z INSTANČNÍHO profilu", () => {
      const { r, poBehu } = doktor({ [OVERLAY_ENV]: overlayFixture() });
      expect(r.status, r.stderr.slice(-800)).toBe(0);
      expect(poBehu).toMatch(/^SPA_DIAGNOSE=0$/m);
    });
  });

  describe("cold-start (_fetch_instance_overlay)", () => {
    /**
     * Skutečná funkce vyňatá ze skriptu; podvržené jsou jen DVEŘE
     * (`scripts/lib/instance-overlay.mjs`), protože síť v bráně nebude, a
     * `REPO_ROOT` míří na temp strom, ze kterého si je funkce načte.
     *
     * ⛔ ZMĚNA ŠVU 2026-09-20: dřív se podvrhoval `klonuj()` z `git-klon.sh`,
     * protože cold-start klonoval overlay SÁM. Od chvíle, kdy má získání
     * overlaye jeden domov v `instance-overlay.mjs`, by takový podvrh neměřil
     * nic — funkce by šla kolem něj. Šev se proto posunul tam, kde dnes vede
     * hranice. Tvrzení zůstala týž tři a měří se pořád SPUŠTĚNÍM: bez
     * deklarace se pokračuje s prázdnou cestou, se zdařilým získáním se cesta
     * nastaví, a nedostupný deklarovaný overlay cold-start ZASTAVÍ.
     */
    function klon(url: string, klonujeSe: boolean) {
      const koren = mkdtempSync(join(tmpdir(), "aisha-cold-start-overlay-"));
      mkdirSync(join(koren, "scripts/lib"), { recursive: true });
      const cil = join(koren, "repo");
      writeFileSync(
        join(koren, "scripts/lib/instance-overlay.mjs"),
        klonujeSe
          ? `import { mkdirSync } from "node:fs";\n` +
            `export function ziskejDeklarovanyOverlay() { mkdirSync(${JSON.stringify(cil)}, { recursive: true }); return ${JSON.stringify(cil)}; }\n`
          : `export function ziskejDeklarovanyOverlay() { throw new Error("overlay nedostupny"); }\n`,
      );
      cpSync(COLD_START, join(koren, "cold-start.sh"));
      const skript = String.raw`
        set -uo pipefail
        err()  { echo "ERR $*" >&2; }
        warn() { echo "WARN $*" >&2; }
        info() { echo "INFO $*" >&2; }
        eval "$(sed -n '/^_fetch_instance_overlay() {/,/^}/p' "$KOREN/cold-start.sh")"
        AISHA_INSTANCE_CONFIG_DIR=""
        _fetch_instance_overlay
        echo "POKRACUJE dir=$AISHA_INSTANCE_CONFIG_DIR"
      `;
      return spawnSync("bash", ["-c", skript], {
        encoding: "utf8",
        env: cisteProstredi({ KOREN: koren, REPO_ROOT: koren, AISHA_PROFILE: "cloud-multi", ...(url ? { AISHA_INSTANCE_DATA_GIT_URL: url } : {}) }),
      });
    }

    test("funkce se ze skriptu vůbec vyňala (jinak testy níž nic neměří)", () => {
      expect(readFileSync(COLD_START, "utf8")).toMatch(/^_fetch_instance_overlay\(\) \{$/m);
    });

    test("nedostupný deklarovaný overlay → konec, žádné šablony", () => {
      const r = klon(DEKLARACE, false);
      expect(
        r.stdout,
        "cold-start po selhání klonu pokračoval — dál by se odvozovalo ze šablon, tedy pro cizí instanci",
      ).not.toContain("POKRACUJE");
      expect(r.status).not.toBe(0);
      expect(vystup(r)).not.toContain(HESLO);
    });

    test("bez deklarace pokračuje na šablonách; s klonem nastaví cestu", () => {
      expect(klon("", false).stdout).toContain("POKRACUJE dir=\n");
      expect(klon(DEKLARACE, true).stdout).toMatch(/POKRACUJE dir=\S+\/repo/);
    });
  });
});
