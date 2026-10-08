import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * KTEROU zálohu obsluhy čte resolve-domains-env.sh — chováním SKUTEČNÉHO skriptu nad
 * pokusným kořenem (knihovny a config jsou odkazy do tohoto stromu, zálohy jsou pokusné).
 *
 * NAMĚŘENO 2026-10-04: skript četl napevno `.env-prod-backup` z kořene stromu. V běhu
 * jiného prostředí (cold-start předává zálohu v ENV_PROD_BACKUP) tím story-init přepsal
 * zděděný projekt Coolify, adresu Forgeja i GIT_BRANCH hodnotami ze zálohy v kořeni —
 * a zakládal jinde a z jiného repozitáře, než co krok 2b2 před wipem ověřil.
 */
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KLICE = ["GIT_BRANCH", "COOLIFY_PROJECT_UUID", "FORGEJO_URL"];

const V_KORENI = { GIT_BRANCH: "vetev-z-korene", COOLIFY_PROJECT_UUID: "projekt-z-korene", FORGEJO_URL: "https://forge-koren.example.test" };
const V_PROSTREDI = {
  GIT_BRANCH: "vetev-prostredi",
  COOLIFY_PROJECT_UUID: "projekt-prostredi",
  FORGEJO_URL: "https://forge-prostredi.example.test",
};
const ZDEDENE = { GIT_BRANCH: "vetev-zdedena", COOLIFY_PROJECT_UUID: "projekt-zdedeny", FORGEJO_URL: "https://forge-zdedeny.example.test" };

const envSoubor = (kv) =>
  Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

let d;
let koren;
let zalohaProstredi;
let zalohaBezKlicu;

beforeAll(() => {
  d = mkdtempSync(join(tmpdir(), "resolve-domains-env-"));
  koren = join(d, "koren");
  mkdirSync(join(koren, "scripts"), { recursive: true });
  symlinkSync(join(KOREN, "scripts/lib"), join(koren, "scripts/lib"));
  symlinkSync(join(KOREN, "config"), join(koren, "config"));
  // Záloha v kořeni stromu — na sdíleném stanovišti záloha JINÉHO (produkčního) prostředí.
  writeFileSync(join(koren, ".env-prod-backup"), envSoubor(V_KORENI));
  // Záloha prostředí, které právě běží (cold-start ji předává v ENV_PROD_BACKUP).
  zalohaProstredi = join(koren, ".env-prostredi-backup");
  writeFileSync(zalohaProstredi, envSoubor(V_PROSTREDI));
  zalohaBezKlicu = join(koren, ".env-prostredi-bez-klicu-backup");
  writeFileSync(zalohaBezKlicu, envSoubor({ JINY_KLIC: "x" }));
});
afterAll(() => d && rmSync(d, { recursive: true, force: true }));

// Jen to, co běh potřebuje — žádné zděděné proměnné stanoviště.
const prostredi = (extra) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AISHA_PROFILE: "cloud-multi", ...extra });

/** Načte prostředí SKUTEČNÝM skriptem a vrátí hodnoty tří klíčů + chybový výstup. */
function nacti(extra = {}) {
  const skript = [
    "set -uo pipefail",
    'PROJECT_ROOT="$1"',
    '. "$PROJECT_ROOT/scripts/lib/resolve-domains-env.sh"',
    'printf "%s\\n" "${GIT_BRANCH:-}" "${COOLIFY_PROJECT_UUID:-}" "${FORGEJO_URL:-}" "${APP_DOMAIN:-}"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript, "resolve-domains-env", koren], { encoding: "utf8", env: prostredi(extra) });
  expect(r.status, r.stderr).toBe(0);
  const [vetev, projekt, forgejo, appDomena] = r.stdout.split("\n");
  // Kontrola stanoviště: skript doběhl celý (topologie se odvodila), neměří se useknutý běh.
  expect(appDomena, `topologie se neodvodila:\n${r.stderr}`).not.toBe("");
  return { hodnoty: { GIT_BRANCH: vetev, COOLIFY_PROJECT_UUID: projekt, FORGEJO_URL: forgejo }, stderr: r.stderr };
}
const varovani = (stderr) => stderr.split("\n").filter((l) => l.startsWith("WARN: resolve-domains-env.sh"));

describe("resolve-domains-env.sh — kterou zálohu obsluhy čte", () => {
  it("kotva: bez ENV_PROD_BACKUP se čte záloha v kořeni jako dřív (samostatné spuštění se nemění)", () => {
    expect(nacti(ZDEDENE).hodnoty).toEqual(V_KORENI);
    // Prázdný řetězec = nenastaveno.
    expect(nacti({ ...ZDEDENE, ENV_PROD_BACKUP: "" }).hodnoty).toEqual(V_KORENI);
  });

  it("produkční tvar: ENV_PROD_BACKUP ukazuje na zálohu v kořeni → táž odpověď", () => {
    const r = nacti({ ...ZDEDENE, ENV_PROD_BACKUP: join(koren, ".env-prod-backup") });
    expect(r.hodnoty).toEqual(V_KORENI);
    expect(varovani(r.stderr)).toEqual([]);
  });

  it("ne-produkční tvar: čte se záloha PROSTŘEDÍ běhu, ne záloha v kořeni — větev, projekt i adresa Forgeja", () => {
    const r = nacti({ ...ZDEDENE, ENV_PROD_BACKUP: zalohaProstredi });
    expect(r.hodnoty).toEqual(V_PROSTREDI);
    for (const k of KLICE) expect(r.hodnoty[k], `${k} přišel ze zálohy v kořeni`).not.toBe(V_KORENI[k]);
  });

  it("záloha prostředí klíče nenese → platí hodnoty zděděné od volajícího; kořen je nepřepíše", () => {
    expect(nacti({ ...ZDEDENE, ENV_PROD_BACKUP: zalohaBezKlicu }).hodnoty).toEqual(ZDEDENE);
  });

  it("jmenovaná záloha neexistuje → záloha v kořeni se místo ní NEČTE a skript to řekne", () => {
    const neni = join(koren, ".env-neni-backup");
    const r = nacti({ ...ZDEDENE, ENV_PROD_BACKUP: neni });
    expect(r.hodnoty).toEqual(ZDEDENE);
    expect(varovani(r.stderr)).toHaveLength(1);
    expect(varovani(r.stderr)[0]).toContain(neni);
    // `/dev/null` je v repu zavedený způsob, jak říct „žádná záloha“ — bez varování.
    const zadna = nacti({ ...ZDEDENE, ENV_PROD_BACKUP: "/dev/null" });
    expect(zadna.hodnoty).toEqual(ZDEDENE);
    expect(varovani(zadna.stderr)).toEqual([]);
  });
});

describe("story-init: projekt a adresa repozitáře v běhu jiného prostředí", () => {
  /**
   * SKUTEČNÝ začátek story-initu (načtení prostředí až po zachycení větve) jako soubor
   * v pokusném kořeni — kořen si skript odvozuje z vlastní cesty, stejně jako ostrý.
   */
  function vstupyStoryInitu(extra) {
    const text = readFileSync(join(KOREN, "scripts/coolify-story-init.sh"), "utf8");
    const od = text.indexOf('REPO_ROOT_GUESS="$(cd');
    const kotvaKonce = 'GIT_BRANCH="${GIT_BRANCH:-main}"\n';
    const po = text.indexOf(kotvaKonce, od);
    expect(od, "začátek vstupů story-initu nenalezen — test by měřil prázdno").toBeGreaterThan(-1);
    expect(po, "konec vstupů story-initu nenalezen — test by měřil prázdno").toBeGreaterThan(od);
    const usek = text.slice(od, po + kotvaKonce.length);
    expect(usek, "úsek nenačítá prostředí sdíleným skriptem").toContain("scripts/lib/resolve-domains-env.sh");
    const soubor = join(koren, "scripts", "usek-story-init.sh");
    writeFileSync(soubor, ["set -euo pipefail", usek, 'printf "%s\\n" "$PROJECT_UUID" "$FORGEJO_URL" "$GIT_BRANCH_Z_PROSTREDI"', ""].join("\n"));
    const r = spawnSync("bash", [soubor], { encoding: "utf8", env: prostredi(extra) });
    expect(r.status, r.stderr).toBe(0);
    const [projekt, forgejo, vetevProstredi] = r.stdout.split("\n");
    return { projekt, forgejo, vetevProstredi };
  }

  // Prostředí, jak ho cold-start předá story-initu v ne-produkčním běhu.
  const zdedeneBezVetve = { COOLIFY_PROJECT_UUID: ZDEDENE.COOLIFY_PROJECT_UUID, FORGEJO_URL: ZDEDENE.FORGEJO_URL };

  it("ne-produkční běh se zálohou jiného prostředí v kořeni: projekt, adresa i větev zůstanou ty z běhu", () => {
    const s = vstupyStoryInitu({ ...zdedeneBezVetve, ENV_PROD_BACKUP: zalohaBezKlicu });
    expect(s.projekt, "story-init by zakládal v projektu ze zálohy v kořeni").toBe(ZDEDENE.COOLIFY_PROJECT_UUID);
    expect(s.forgejo, "story-init by Coolify nasměroval na Forgejo ze zálohy v kořeni").toBe(ZDEDENE.FORGEJO_URL);
    // Krok 2b2 viděl GIT_BRANCH nenastavený — story-init musí vidět totéž (jinak rozpor až po wipu).
    expect(s.vetevProstredi, "story-init vidí větev ze zálohy v kořeni, krok 2b2 ji neviděl").toBe("");
  });

  it("kontrolní vzorek: bez ENV_PROD_BACKUP (samostatné spuštění) platí záloha v kořeni jako dřív", () => {
    const s = vstupyStoryInitu(zdedeneBezVetve);
    expect([s.projekt, s.forgejo, s.vetevProstredi]).toEqual([V_KORENI.COOLIFY_PROJECT_UUID, V_KORENI.FORGEJO_URL, V_KORENI.GIT_BRANCH]);
  });
});
