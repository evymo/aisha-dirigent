/**
 * BRÁNA: co discovery cold-startu vydá a skripty čtou z PROSTŘEDÍ, musí dojít do DĚTÍ.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (suchý běh první konvergence instance s otevřenou lane
 *    modelového meshe). `generate-coolify-context.mjs` vydá PUBLIC_EDGE_HOST_ADDR
 *    (adresa uzlu edge) a cold-start výstup jen `eval`-uje — bez `set -a`, takže
 *    proměnná zůstala NEEXPORTOVANÁ. generate-secrets (dítě) ji nikdy neviděl a
 *    MODEL_MESH_VSTUP_ADDR vydal prázdný → compose mostu a řídicí roviny modelového
 *    meshe padl na `:?` — v doktoru (krok 0, simulace kroku 2) i v ostrém kroku 2b.
 *    Trezor tu adresu nenese (je to pozorování, ne deklarace), takže ji neexportoval
 *    nikdo jiný. Žádný test tu cestu neměřil: lane byla dosud u všech instancí zavřená.
 *
 * Měří se VLASTNOST na SKUTEČNÉM bloku discovery z `aisha-cold-start.sh` (ne tvar):
 * blok se pustí v bashi s napodobenou discovery a dítě (`node`) vypíše, co vidí.
 * Třída, ne vzorek: klíče = ty, které discovery vydává doslovně A které čte některý
 * skript ze `scripts/` přes `process.env` — přibude-li další, brána ho změří sama.
 * Exporty, které cold-start dělá PŘED discovery (např. COOLIFY_PROJECT_UUID), se
 * převezmou ze skriptu — `eval` nad exportovanou proměnnou ji nechá exportovanou,
 * takže brána měří skutečný stav, ne čistý shell.
 *
 * Druhá polovina: doktor puštěný SAMOSTATNĚ (runbook „celý doktor jen čtením“) cold-start
 * nemá — simulace kroku 2 si adresu musí zjistit touž discovery jen čtením.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const COLD_START = readFileSync(path.join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
const DOKTOR = readFileSync(path.join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");
const KONTEXT = readFileSync(path.join(ROOT, "scripts/generate-coolify-context.mjs"), "utf-8");

const docasne: string[] = [];
afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
});

/** Blok discovery v cold-startu: od nulování pinu po úklid jeho proměnných. */
function blokDiscovery(): string {
  const zacatek = COLD_START.indexOf('  _disc_pin=""\n');
  const konecZnacka = "  unset _disc_tmp _disc_pin _disc_rc\n";
  const konec = COLD_START.indexOf(konecZnacka, zacatek);
  expect(zacatek, "blok discovery v aisha-cold-start.sh nenalezen — přejmenoval se?").toBeGreaterThan(-1);
  expect(konec, "konec bloku discovery (unset _disc_tmp …) nenalezen").toBeGreaterThan(zacatek);
  const blok = COLD_START.slice(zacatek, konec + konecZnacka.length);
  expect(blok, "blok discovery nevolá generate-coolify-context.mjs — měřil bych prázdno").toMatch(
    /generate-coolify-context\.mjs/,
  );
  return blok;
}

/** Klíče, které discovery vydává doslovně (`emit('KLÍČ', …)`). */
function klíčeDiscovery(): string[] {
  return [...new Set([...KONTEXT.matchAll(/emit\('([A-Z0-9_]+)'/g)].map((m) => m[1]))].sort();
}

/** Skripty, které cold-start spouští jako děti (Node) — celé `scripts/` a `scripts/lib/`. */
function zdrojeSkriptu(): string[] {
  const out: string[] = [];
  for (const dir of ["scripts", "scripts/lib"]) {
    for (const f of readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith(".mjs") || f.includes(".test.")) continue;
      if (f === "generate-coolify-context.mjs") continue;
      out.push(readFileSync(path.join(ROOT, dir, f), "utf-8"));
    }
  }
  return out;
}

/** Klíče discovery, které některé dítě čte z prostředí. */
function klíčeČtenéDětmi(): string[] {
  const zdroje = zdrojeSkriptu();
  return klíčeDiscovery().filter((k) => {
    const re = new RegExp(`process\\.env\\.${k}(?![A-Z0-9_])|process\\.env\\[["'\`]${k}["'\`]\\]`);
    return zdroje.some((s) => re.test(s));
  });
}

/** Proměnné, které cold-start exportuje PŘED blokem discovery (`export X` / `export X=…`). */
function exportyPředDiscovery(): string[] {
  const pred = COLD_START.slice(0, COLD_START.indexOf('  _disc_pin=""\n'));
  const jmena = new Set<string>();
  for (const m of pred.matchAll(/^\s*export\s+([A-Z_][A-Z0-9_]*(?:\s+[A-Z_][A-Z0-9_]*)*)/gm)) {
    for (const j of m[1].split(/\s+/)) jmena.add(j.replace(/=.*/, ""));
  }
  for (const m of pred.matchAll(/^\s*export\s+([A-Z_][A-Z0-9_]*)=/gm)) jmena.add(m[1]);
  return [...jmena];
}

/** Pustí skutečný blok discovery s napodobenou discovery; vrátí, co vidí dítě. */
function coVidiDite(klice: string[], predExportovane: string[]): Record<string, string> {
  const repo = mkdtempSync(path.join(tmpdir(), "discovery-deti-"));
  docasne.push(repo);
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  // Napodobená discovery: vydá přesně tvar skutečné (`KLÍČ='hodnota'`), hodnoty jsou atrapy.
  writeFileSync(
    path.join(repo, "scripts/generate-coolify-context.mjs"),
    klice.map((k) => `process.stdout.write(${JSON.stringify(`${k}='zkouska-${k}'\n`)});`).join("\n"),
  );
  const dite = `node -e 'for (const k of process.argv.slice(1)) process.stdout.write(k + "=" + (process.env[k] ?? "<CHYBÍ>") + "\\n")' ${klice.join(" ")}`;
  const skript = [
    "cs_je_prod_env() { return 0; }",
    "warn() { :; }",
    "err() { :; }",
    `REPO_ROOT='${repo}'`,
    "DRY_RUN=1; WIPE=0; CS_PROJEKT_PIN=''; ENV_COOLIFY=''; AISHA_ENV=''",
    // Stav exportů, jaký cold-start má v okamžiku discovery (hodnota prázdná, atribut export).
    ...predExportovane.filter((j) => klice.includes(j)).map((j) => `export ${j}=''`),
    blokDiscovery(),
    dite,
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  expect(r.status, `blok discovery v bashi selhal: ${r.stderr}`).toBe(0);
  const out: Record<string, string> = {};
  for (const radek of r.stdout.trim().split("\n")) {
    const i = radek.indexOf("=");
    if (i > 0) out[radek.slice(0, i)] = radek.slice(i + 1);
  }
  return out;
}

describe("discovery cold-startu dojde do dětí", () => {
  test("třída není prázdná — adresa edge je mezi klíči, které děti čtou", () => {
    // Bez tohohle by brána nad prázdnou množinou prošla vždy (zelená, protože neviděla nic).
    const klice = klíčeČtenéDětmi();
    expect(klice, "měřidlo osiřelo: discovery nevydává nic, co by děti četly").toContain("PUBLIC_EDGE_HOST_ADDR");
  });

  test("každý klíč discovery čtený dítětem vidí dítě s hodnotou z discovery", () => {
    const klice = klíčeČtenéDětmi();
    const vidi = coVidiDite(klice, exportyPředDiscovery());
    const nedoslo = klice.filter((k) => vidi[k] !== `zkouska-${k}`);
    expect(
      nedoslo,
      `discovery vydá, cold-start eval-uje, ale dítě (generate-secrets, doktor…) NEVIDÍ: ${nedoslo.join(", ")} — ` +
        "eval bez set -a proměnnou jen nastaví; exportuj ji hned za discovery (viz PUBLIC_EDGE_HOST_ADDR)",
    ).toEqual([]);
  });

  test("kontrolní vzorek: bez exportu po discovery dítě adresu edge NEVIDÍ (měřidlo umí zčervenat)", () => {
    // Mutace téhož bloku: odebraný export. Kdyby brána prošla i tady, neměří nic.
    const blok = blokDiscovery();
    const bezExportu = blok.replace(/^\s*export PUBLIC_EDGE_HOST_ADDR\s*$/m, "    :");
    expect(bezExportu, "kontrolní vzorek: v bloku není export PUBLIC_EDGE_HOST_ADDR k odebrání").not.toBe(blok);
    const repo = mkdtempSync(path.join(tmpdir(), "discovery-deti-mutace-"));
    docasne.push(repo);
    mkdirSync(path.join(repo, "scripts"), { recursive: true });
    writeFileSync(
      path.join(repo, "scripts/generate-coolify-context.mjs"),
      `process.stdout.write("PUBLIC_EDGE_HOST_ADDR='zkouska'\\n");`,
    );
    const skript = [
      "cs_je_prod_env() { return 0; }",
      "warn() { :; }",
      "err() { :; }",
      `REPO_ROOT='${repo}'`,
      "DRY_RUN=1; WIPE=0; CS_PROJEKT_PIN=''; ENV_COOLIFY=''; AISHA_ENV=''",
      bezExportu,
      `node -e 'process.stdout.write(process.env.PUBLIC_EDGE_HOST_ADDR ?? "<CHYBÍ>")'`,
    ].join("\n");
    const r = spawnSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    expect(r.stdout).toBe("<CHYBÍ>");
  });

  test("samostatný doktor si adresu edge pro simulaci kroku 2 zjistí touž discovery jen čtením", () => {
    // Blok čerstvého envu (fáze D): od mktemp po env-doktora.
    const start = DOKTOR.indexOf('_fresh_env="$(mktemp');
    const konec = DOKTOR.indexOf("aisha-env-doctor.mjs", start);
    expect(start, "blok čerstvého envu v doktoru nenalezen").toBeGreaterThan(-1);
    const blok = DOKTOR.slice(start, konec);
    const volaniGeneratoru = blok.search(/node\s+"\$REPO_ROOT\/scripts\/generate-secrets\.mjs"/);
    const discovery = blok.search(/node\s+"\$REPO_ROOT\/scripts\/generate-coolify-context\.mjs"/);
    expect(discovery, "simulace kroku 2 nevolá discovery — samostatný doktor nezná adresu edge").toBeGreaterThan(-1);
    expect(discovery, "discovery musí běžet PŘED generátorem tajemství").toBeLessThan(volaniGeneratoru);
    // Jen čtení: bez --env-coolify (nic nezapíše) a bez zakládání projektu.
    const radekDiscovery = blok.slice(blok.lastIndexOf("\n", discovery - 1), blok.indexOf("\n", discovery));
    const okoli = blok.slice(Math.max(0, discovery - 400), discovery + 200);
    expect(radekDiscovery, "discovery v simulaci nesmí dostat --env-coolify (zápis)").not.toMatch(/--env-coolify/);
    expect(okoli, "discovery v simulaci musí mít COOLIFY_AUTO_CREATE_PROJECT=0").toMatch(
      /COOLIFY_AUTO_CREATE_PROJECT=0/,
    );
    // Generátor dostane zjištěnou adresu prostředím (čte ji z process.env).
    const pred = blok.slice(Math.max(0, volaniGeneratoru - 80), volaniGeneratoru);
    expect(pred, "generátor v simulaci nedostal zjištěnou adresu edge").toMatch(/PUBLIC_EDGE_HOST_ADDR="\$_fresh_edge"\s*$/);
  });
});
