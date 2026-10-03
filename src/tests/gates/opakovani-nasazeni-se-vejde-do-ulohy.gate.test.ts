/**
 * Brána: automatické dotažení nasazení musí OPRAVDU proběhnout — a jen tam, kde smí.
 *
 * PROČ (naměřeno 2026-09-23, <fork>-core po #380)
 * -------------------------------------------
 * Nasazení spadlo na závodu s vydáním balíku v npm (`@sentry/core@10.75.3` vyšel
 * 3 min po startu nasazení). Opakování téhož commitu prošlo, jenže ho musel
 * někdo spustit RUČNĚ. `deploy-and-verify.sh` teď doloženě přechodný pád zopakuje
 * sám (`nasazeni-prechodna-chyba.mjs`). Aby to nebyla jen věta v komentáři:
 *
 *   1. STROP ÚLOHY POJME OPAKOVÁNÍ. Nasazení jádra trvá 16–21 min (medián z 32
 *      úspěšných), pokus smí TIMEOUT_S. Úloha se stropem 30 min by opakování
 *      zabila uprostřed — a Coolify by dál stavěl, zatímco CI už hlásí pád.
 *      Od 2026-09-26 má pokus DVA stropy: FRONTA_S (čekání ve frontě Coolify,
 *      stav `queued`) a TIMEOUT_S (práce, běží až po opuštění fronty) — strop
 *      úlohy musí pojmout oba (naměřeno: fronta 36–43 min u appek, které se
 *      postavily za 7 min).
 *   2. MODUL JE V ŘÍDKÉM CHECKOUTU. Úlohy nasazení si stahují jen vyjmenované
 *      soubory; chybějící modul = `node` spadne = „klasifikace selhala" = tiché
 *      vypnutí celého mechanismu (skript pak správně NEopakuje, ale nikdo neví proč).
 *   3. OPAKUJE SE JEN NA VERDIKT. Rozhodnutí o opakování smí vzejít jedině
 *      z posouzení pádu — slepé „zkus znovu" by z vady udělalo náhodně zelenou.
 *
 * Čísla se čtou z JEDNOHO domova (skript), ne opisují sem.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const CI = readFileSync(join(ROOT, ".forgejo/workflows/ci.yml"), "utf8");
const SKRIPT = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
const MODUL = "scripts/lib/nasazeni-prechodna-chyba.mjs";

function cislo(re: RegExp, co: string): number {
  const m = re.exec(SKRIPT);
  if (!m) throw new Error(`ve skriptu chybí ${co} — brána by jinak měřila opsané číslo`);
  return Number(m[1]);
}

function ulohy(yml: string): Array<{ jmeno: string; telo: string }> {
  const starty = [...yml.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map((m) => ({ jmeno: m[1], at: m.index ?? 0 }));
  return starty.map((s, i) => ({ jmeno: s.jmeno, telo: yml.slice(s.at, i + 1 < starty.length ? starty[i + 1].at : yml.length) }));
}

const OPAKOVANI = cislo(/^OPAKOVANI=(\d+)\s*$/m, "OPAKOVANI");
const TIMEOUT_S = cislo(/^TIMEOUT_S=(\d+)\s*$/m, "výchozí TIMEOUT_S");
const PRODLEVA_S = cislo(/^PRODLEVA_S=(\d+)\s*$/m, "PRODLEVA_S");
const FRONTA_S = cislo(/^FRONTA_S=(\d+)\s*$/m, "výchozí FRONTA_S");

const PRIME = ulohy(CI).filter((u) => /^\s*(?:run:\s*)?bash scripts\/ci\/deploy-and-verify\.sh\b/m.test(u.telo));

describe("automatické dotažení nasazení", () => {
  it("úlohy volající skript přímo existují (jinak brána nic neměří)", () => {
    expect(PRIME.map((u) => u.jmeno).sort()).toEqual(["deploy-core", "deploy-edge", "deploy-extranet"]);
  });

  it.each(PRIME.map((u) => [u.jmeno, u.telo]))("%s: strop úlohy pojme (1 + opakování) pokusů (fronta + práce) a prodlevu", (_j, telo) => {
    const strop = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(telo)?.[1] ?? NaN);
    const prace = Number(/--timeout-s[ =](\d+)/.exec(telo)?.[1] ?? TIMEOUT_S);
    const fronta = Number(/--fronta-s[ =](\d+)/.exec(telo)?.[1] ?? FRONTA_S);
    const potreba = Math.ceil(((1 + OPAKOVANI) * (fronta + prace) + OPAKOVANI * PRODLEVA_S) / 60);
    expect(strop).toBeGreaterThanOrEqual(potreba);
  });

  it.each(PRIME.map((u) => [u.jmeno, u.telo]))("%s: modul posouzení je v řídkém checkoutu", (_j, telo) => {
    expect(telo).toContain(`            ${MODUL}\n`);
    expect(telo).toContain("            scripts/lib/cli-entry.mjs\n");
  });

  it("skript opakuje JEN na verdikt posouzení pádu", () => {
    const telo = /dalsi_pokus\(\) \{([\s\S]*?)\n\}/.exec(SKRIPT)?.[1] ?? "";
    expect(telo).toContain(`node ${MODUL}`);
    expect(telo).toMatch(/if \[ "\$ano" != "ano" \]; then[\s\S]*?return 1/);
    // jediné místo, kde se rozhoduje o dalším pokusu, je větev pádu nasazení
    expect(SKRIPT.match(/dalsi_pokus "\$NASAZENI"/g)?.length).toBe(1);
    expect(SKRIPT).toMatch(/failed\|cancelled\|canceled\|error\)[\s\S]*?if dalsi_pokus "\$NASAZENI"; then STAV="opakovat"; break; fi\n\s*exit 1 ;;/);
  });
});

/**
 * CHOVÁNÍ, ne text: `dalsi_pokus` se vyjme ze SKUTEČNÉHO skriptu a spustí s podstrčeným
 * `curl` (Coolify) a `sleep`. Klasifikátor i filtr aktivních nasazení běží naostro.
 * Síťová třída (`ECONNRESET`) nepotřebuje registr, takže test je bez sítě.
 */
/** Skutečný TVAR odpovědi Coolify pro nasazení jedné appky (naměřeno 09-23, anonymizováno). */
const TVAR_NASAZENI_APLIKACE = JSON.parse(readFileSync(join(__dirname, "fixtures/coolify-nasazeni-aplikace.json"), "utf8"));
/** Odpověď s danými stavy — klíče a zbytek položky beze změny ze skutečného tvaru. */
function nasazeniAplikace(stavy: string[]) {
  const vzor = TVAR_NASAZENI_APLIKACE.deployments[0];
  return { count: stavy.length, deployments: stavy.map((status) => ({ ...vzor, status })) };
}
const SELHANI_SITE = ["#12 [build 4/7] RUN npm ci", "#12 3.2 npm error code ECONNRESET", "#12 ERROR: process \"/bin/sh -c npm ci\" did not complete successfully: exit code: 1"].join("\n");

function dalsiPokus(o: {
  log: string;
  aktivni?: string[];
  pokus?: number;
  max?: number;
  logNeniJson?: boolean;
  hlava?: string;
  bezRef?: boolean;
}) {
  const fn = /(dalsi_pokus\(\) \{[\s\S]*?\n\})/.exec(SKRIPT)?.[1];
  if (!fn) throw new Error("funkce dalsi_pokus ve skriptu není");
  const dir = mkdtempSync(join(tmpdir(), "dalsi-pokus-"));
  const telo = o.logNeniJson ? "<html>502</html>" : JSON.stringify({ created_at: new Date().toISOString(), logs: JSON.stringify([{ output: o.log }]) });
  writeFileSync(join(dir, "nasazeni.json"), telo);
  writeFileSync(join(dir, "aktivni.json"), JSON.stringify(nasazeniAplikace(o.aktivni ?? ["failed", "finished"])));
  const harness = [
    "set -uo pipefail",
    `curl() { local u="\${@: -1}"; case "$u" in */deployments/NAS1) cat "${dir}/nasazeni.json" ;; */deployments/applications/UUID1\\?*) cat "${dir}/aktivni.json" ;; *) echo "neočekávané volání $u" >&2; return 7 ;; esac; }`,
    `git() { [ "$1" = ls-remote ] && printf '%s\\trefs/heads/main\\n' "${o.hlava ?? "c".repeat(40)}"; }`,
    "sleep() { :; }",
    `APP=x-core; UUID=UUID1; GIT_SHA=${"c".repeat(40)}; COOLIFY_URL=https://coolify.invalid; COOLIFY_API_TOKEN=x; POKUS=${o.pokus ?? 1}; POKUSU_MAX=${o.max ?? 2}; PRODLEVA_S=0`,
    o.bezRef ? "unset GITHUB_REF" : "GITHUB_REF=refs/heads/main",
    'OPAKOVANI_STAV="NEOPAKOVÁNO"',
    fn,
    'if dalsi_pokus NAS1; then echo "ROZHODNUTI=opakovat"; else echo "ROZHODNUTI=stop"; fi',
    'echo "STAV=$OPAKOVANI_STAV"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", harness], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  return `${r.stdout}${r.stderr}`;
}

describe("dalsi_pokus — chování", () => {
  it("doložená přechodná chyba a volná appka → opakovat a vyslovit proč", () => {
    const out = dalsiPokus({ log: SELHANI_SITE });
    expect(out).toContain("ROZHODNUTI=opakovat");
    expect(out).toContain("sit-registru");
    expect(out).toMatch(/STAV=OPAKOVÁNO: pokus 2\/2/);
  });

  it("neznámý pád → STOP, i když pokusy zbývají", () => {
    const out = dalsiPokus({ log: "Error type: App\\Exceptions\\DeploymentException" });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toMatch(/rozhodující chyba|nejistota = STOP/);
  });

  it("téže appce běží jiné nasazení → STOP (souběh se pere o obrazy); jen dokončená nevadí", () => {
    const soubeh = dalsiPokus({ log: SELHANI_SITE, aktivni: ["in_progress", "failed"] });
    expect(soubeh).toContain("ROZHODNUTI=stop");
    expect(soubeh).toContain("jiné nasazení");
    const cizi = dalsiPokus({ log: SELHANI_SITE, aktivni: ["failed", "finished", "finished"] });
    expect(cizi).toContain("ROZHODNUTI=opakovat");
  });

  it("vyčerpané pokusy → STOP bez jediného dotazu", () => {
    const out = dalsiPokus({ log: SELHANI_SITE, pokus: 2, max: 2 });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("Opakování vyčerpáno");
    expect(out).not.toContain("neočekávané volání");
  });

  it("posouzení nejde provést (odpověď není JSON) → STOP, ne opakování naslepo", () => {
    const out = dalsiPokus({ log: "", logNeniJson: true });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("klasifikace pádu selhala");
  });

  it("opakování vypnuté (OPAKOVANI=0 ⇒ max 1) → STOP", () => {
    expect(dalsiPokus({ log: SELHANI_SITE, pokus: 1, max: 1 })).toContain("ROZHODNUTI=stop");
  });

  it("větev se mezitím posunula → STOP (novější revizi nasadí její vlastní běh)", () => {
    const out = dalsiPokus({ log: SELHANI_SITE, hlava: "d".repeat(40) });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("posunula");
  });

  it("vada kódu + nesouvisející síťový řádek jinde v logu → STOP (posuzuje se rozhodující krok)", () => {
    const smiseny = [
      "#9 [svc 3/5] RUN curl -s https://example.invalid/health || true",
      "#9 0.4 dial tcp 10.0.0.1:443: i/o timeout",
      "#9 DONE 0.6s",
      "#14 [svc 5/5] RUN npm run build",
      "#14 12.1 src/index.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      '#14 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
    ].join("\n");
    expect(dalsiPokus({ log: smiseny })).toContain("ROZHODNUTI=stop");
  });

  it("bez GITHUB_REF (běh mimo CI) → STOP, větev se nedosazuje", () => {
    const out = dalsiPokus({ log: SELHANI_SITE, bezRef: true });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("GITHUB_REF");
  });
});

