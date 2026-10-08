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
 *      ⛔ 2026-10-01: rozpočet úlohy = JEDEN pokus. Tvrdý strop sdíleného runneru
 *      (1 h) přebíjí timeout-minutes, takže druhý pokus (125 min) se do úlohy
 *      nevešel nikdy — runner ji utnul dřív (naměřeno: Core 15–20 min, nikdy přes
 *      60). Opakování přechodného pádu patří do POKRAČOVACÍ úlohy (vzor Stacky po
 *      vlnách), ne do téže úlohy; skript má proto OPAKOVANI=0 a brána to drží.
 *      Úloha navíc pojme REZERVA_S (checkout, setup, kroky před čekáním a po něm):
 *      skript má VŽDY skončit dřív než runner a říct, co se stalo (2026-10-01).
 *      Rezerva se skládá z naměřené režie a ohraničených kroků po čekání, které
 *      brána vyčte ze skriptu; úlohy po vlnách mají měkký termín ze svého stropu.
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

/** Úlohy ci.yml jako text BEZ komentářových řádků — zmínka v komentáři není volání (naměřeno: komentář
 *  „--fronta-s 1500“ nad úlohou přebil skutečný argument a brána měřila komentář). */
function ulohy(yml: string): Array<{ jmeno: string; telo: string }> {
  const starty = [...yml.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map((m) => ({ jmeno: m[1], at: m.index ?? 0 }));
  return starty.map((s, i) => ({
    jmeno: s.jmeno,
    telo: yml
      .slice(s.at, i + 1 < starty.length ? starty[i + 1].at : yml.length)
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n"),
  }));
}

const OPAKOVANI = cislo(/^OPAKOVANI=(\d+)\s*$/m, "OPAKOVANI");
const TIMEOUT_S = cislo(/^TIMEOUT_S=(\d+)\s*$/m, "výchozí TIMEOUT_S");
const PRODLEVA_S = cislo(/^PRODLEVA_S=(\d+)\s*$/m, "PRODLEVA_S");
const FRONTA_S = cislo(/^FRONTA_S=(\d+)\s*$/m, "výchozí FRONTA_S");
const REZERVA_S = cislo(/^REZERVA_S=(\d+)\s*$/m, "REZERVA_S");
const REZIE_NAMERENA_S = cislo(/^REZIE_NAMERENA_S=(\d+)\s*$/m, "REZIE_NAMERENA_S");
const DOBEH_S = cislo(/^DOBEH_S=(\d+)\s*$/m, "DOBEH_S");

/** Nejhorší případ ohraničených kroků PO čekání — vyčtený ze skriptu, ne opsaný. */
function poCekaniMax(): { sonda: number; verify: number } {
  // Smyček `for pokus in …` je ve skriptu víc — sonda zdraví je ta, která volá $HEALTH_URL.
  const smycka = [...SKRIPT.matchAll(/for pokus in ((?:\d+ ?)+); do([\s\S]*?)\n {2}done/g)].find((m) => m[2].includes('"$HEALTH_URL"'));
  if (!smycka) throw new Error("smyčka sondy zdraví ve skriptu chybí — rezervu nejde změřit");
  const pokusu = smycka[1].trim().split(/\s+/).length;
  const curl = Number(/--max-time (\d+) "\$HEALTH_URL"/.exec(smycka[2])?.[1] ?? NaN);
  const spanek = Number(/\n\s*sleep (\d+)\s*$/m.exec(smycka[2])?.[1] ?? NaN);
  const verify = Number(/--max-time (\d+) "\$VERIFY_URL"/.exec(SKRIPT)?.[1] ?? NaN);
  return { sonda: pokusu * curl + (pokusu - 1) * spanek, verify };
}

const PRIME = ulohy(CI).filter((u) => /^\s*(?:run:\s*)?bash scripts\/ci\/deploy-and-verify\.sh\b/m.test(u.telo));

describe("automatické dotažení nasazení", () => {
  it("úlohy volající skript přímo existují (jinak brána nic neměří)", () => {
    expect(PRIME.map((u) => u.jmeno).sort()).toEqual([
      "deploy-core",
      "deploy-core-pokracovani",
      "deploy-edge",
      "deploy-edge-pokracovani",
      "deploy-extranet",
      "deploy-extranet-pokracovani",
    ]);
  });

  it("uvnitř úlohy se neopakuje — rozpočet úlohy je JEDEN pokus", () => {
    expect(
      OPAKOVANI,
      "Druhý pokus v téže úloze se pod tvrdý strop sdíleného runneru nevejde (2 × (fronta + práce) + prodleva > 1 h). " +
        "Opakování přechodného pádu = pokračovací úloha (vzor Stacky po vlnách, `--navazat-od`, jen jednou).",
    ).toBe(0);
  });

  it.each(PRIME.map((u) => [u.jmeno, u.telo]))("%s: strop úlohy pojme jeden pokus (fronta + práce) a rezervu", (_j, telo) => {
    const strop = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(telo)?.[1] ?? NaN);
    const prace = Number(/--timeout-s[ =](\d+)/.exec(telo)?.[1] ?? TIMEOUT_S);
    const fronta = Number(/--fronta-s[ =](\d+)/.exec(telo)?.[1] ?? FRONTA_S);
    const potreba = (1 + OPAKOVANI) * (fronta + prace) + OPAKOVANI * PRODLEVA_S + REZERVA_S;
    expect(
      strop * 60,
      `strop ${strop} min nepojme fronta ${fronta} s + práce ${prace} s + rezerva ${REZERVA_S} s = ${potreba} s — ` +
        "runner by úlohu utnul dřív, než skript řekne, co se stalo. Snižte frontu (--fronta-s), ne práci.",
    ).toBeGreaterThanOrEqual(potreba);
  });

  it("rezerva pojme naměřenou režii i ohraničené kroky po čekání (krok 5, sonda, --verify-url)", () => {
    const { sonda, verify } = poCekaniMax();
    expect(REZIE_NAMERENA_S, "naměřená režie chybí — rezerva by nebyla změřená").toBeGreaterThan(0);
    const dno = REZIE_NAMERENA_S + DOBEH_S + sonda + verify;
    expect(REZERVA_S, `REZERVA_S ${REZERVA_S} < režie ${REZIE_NAMERENA_S} + krok 5 ${DOBEH_S} + sonda ${sonda} + verify ${verify} = ${dno} s`).toBeGreaterThanOrEqual(dno);
  });

  it("krok 5 (dočkání po finished) má vlastní strop DOBEH_S, ne strop práce", () => {
    const krok5 = /node scripts\/coolify-deploy-watch\.mjs[\s\S]*?; then/.exec(SKRIPT)?.[0] ?? "";
    expect(krok5, "volání coolify-deploy-watch ve skriptu chybí").not.toBe("");
    expect(krok5).toContain('--timeout-s="$DOBEH_S"');
  });

  it("úlohy po vlnách (nasad-podle-vln.sh) mají měkký termín ze SVÉHO stropu — skript skončí dřív než runner", () => {
    const vlnove = ulohy(CI).filter((u) => /^\s*bash scripts\/ci\/nasad-podle-vln\.sh\b/m.test(u.telo));
    expect(vlnove.map((u) => u.jmeno), "nenašel jsem úlohy po vlnách — změnilo se volání?").toContain("deploy-koren");
    const bez = vlnove
      .filter((u) => {
        const strop = /^ {4}timeout-minutes:\s*(\d+)/m.exec(u.telo)?.[1];
        return (
          !strop ||
          !new RegExp(`STROP_ULOHY_MIN: "${strop}"`).test(u.telo) ||
          !/TERMIN=\$\(\( \$\(date \+%s\) \+ \(STROP_ULOHY_MIN - \d+\) \* 60 \)\)/.test(u.telo) ||
          !/--mekky-termin "\$TERMIN"/.test(u.telo)
        );
      })
      .map((u) => u.jmeno);
    expect(bez, "Bez měkkého termínu ze stropu úlohy ji runner utne uprostřed nasazení a nikdo neřekne, co zůstalo.").toEqual([]);
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

/** `trida_padu` ze SKUTEČNÉHO skriptu s podstrčeným curl; klasifikátor běží naostro. */
function tridaPadu(log: string, neniJson = false) {
  const fn = /(trida_padu\(\) \{[\s\S]*?\n\})/.exec(SKRIPT)?.[1];
  if (!fn) throw new Error("funkce trida_padu ve skriptu není");
  const dir = mkdtempSync(join(tmpdir(), "trida-padu-"));
  writeFileSync(join(dir, "nasazeni.json"), neniJson ? "<html>502</html>" : JSON.stringify({ created_at: new Date().toISOString(), logs: JSON.stringify([{ output: log }]) }));
  const harness = [
    "set -uo pipefail",
    `curl() { cat "${dir}/nasazeni.json"; }`,
    "COOLIFY_URL=https://coolify.invalid; COOLIFY_API_TOKEN=x",
    fn,
    'trida_padu NAS1; echo "TRIDA=$TRIDA_PADU"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", harness], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  return (/^TRIDA=.*$/m.exec(r.stdout)?.[0] ?? `${r.stdout}${r.stderr}`).trim();
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

  it("opakování vypnuté (OPAKOVANI=0 ⇒ max 1) → STOP a řekne, kdo pád zopakuje — bez jediného dotazu", () => {
    const out = dalsiPokus({ log: SELHANI_SITE, pokus: 1, max: 1 });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("Uvnitř úlohy se neopakuje");
    expect(out).not.toContain("neočekávané volání");
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

  it("třída pádu (jen do souhrnu): přechodná, nepřechodná, neposouzeno — klasifikátor běží naostro", () => {
    expect(tridaPadu(SELHANI_SITE)).toMatch(/^TRIDA=sit-registru \(přechodná\): /);
    expect(tridaPadu("Error type: App\\Exceptions\\DeploymentException")).toMatch(/^TRIDA=\S+ \(nepřechodná\): /);
    expect(tridaPadu("", true)).toBe("TRIDA=neposouzeno (klasifikace pádu selhala)");
  });

  it("⛔ pád v pokračování, které už nasadilo znovu, se vysloví jako „pád i po opakování“ s třídou", () => {
    const vetev = /failed\|cancelled\|canceled\|error\)([\s\S]*?)exit 1 ;;/.exec(SKRIPT)?.[1] ?? "";
    expect(vetev).toContain('trida_padu "$NASAZENI"');
    expect(vetev).toMatch(/if \[ "\$\{NAV_AKCE:-\}" = "nasadit" \]; then\s*\n(\s*#.*\n)*\s*echo "::error title=pád i po opakování::[^"]*Třída: \$\{TRIDA_PADU\}"/);
  });

  it("bez GITHUB_REF (běh mimo CI) → STOP, větev se nedosazuje", () => {
    const out = dalsiPokus({ log: SELHANI_SITE, bezRef: true });
    expect(out).toContain("ROZHODNUTI=stop");
    expect(out).toContain("GITHUB_REF");
  });
});

