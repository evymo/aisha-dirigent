/**
 * Mesh-sync je ZAPOJENÝ, ne jen přítomný (CLASS gate)
 *
 * TŘÍDA VADY: brána ověřuje, že soubor EXISTUJE, a čte se to jako důkaz, že se
 * VOLÁ. Skript pak roky leží zapojený jen v dokumentaci.
 *
 * Naměřeno 2026-08-09 na ostrém `--wipe` deployi aisha.guru:
 *   · scripts/coolify-mesh-sync.mjs plní CORE_MESH_IP z live NetBird peerů.
 *   · Volal ho POUZE `npm run mesh:sync`, MESH_CUTOVER_RUNBOOK.md a chybová
 *     hláška v docker-compose.coolify-prebuilt.yml. Z cold-startu NIKDO.
 *   · Přitom cold-start-heredoc-bindings.gate.test.ts:178 píše „Set by
 *     scripts/coolify-mesh-sync.mjs in cold-start step 5" a
 *     env-doctor-contract-coverage.gate.test.ts:78 „populated by
 *     coolify-mesh-sync.mjs AFTER NetBird enrols" — obě ale ověřovaly jen
 *     existenci souboru (netbird-peers.gate.test.ts: `existsSync(...)`).
 *   · Důsledek: CORE_MESH_IP zůstalo prázdné, vlna 5 by nasadila edge
 *     s mesh-routerem bez cíle DNAT → api 502 (incidenty 07-29/30/31).
 *
 * ── DRUHÁ POLOVINA: pojistka musí respektovat pozici ve vlně ──────────────
 * MESH JE ARCHITEKTURA, NE FÁZE: instance je izolované prostředí, kde spolu
 * služby komunikují přes mesh — bezpečně a odděleně. Nic z toho, co je níž,
 * neznamená, že by někde mesh být neměl.
 *
 * Pojistka proti prázdné CORE_MESH_IP (aisha-redeploy.mjs) je správná, ale
 * pálila i ve vlně 2 — tedy v bootstrap okně, kdy se mesh teprve ZAPÍNÁ
 * (management plane jde nahoru až ve vlně 4). WAVES[5] to říká
 * doslova: „Edge and core deploy in wave 2 (before netbird management) … After
 * wave 4 brings management online, we re-deploy edge … This is the key to
 * making mesh self-healing on cold-start."
 *
 * Kruh, který to vyrobilo: edge odmítnut ve vlně 2 → Phase A skončila chybou →
 * Phase D (mesh) se nespustila → vlna 5, která pojistku uspokojí, taky ne.
 * Tvrdý fail v rané vlně zrušil vlnu, která nesla opravu. Přesně proti tomuhle
 * je pravidlo „fail-closed musí respektovat pozici ve vlně".
 *
 * INVARIANT (dvě vlastnosti, obě nutné):
 *   1. cold-start VOLÁ coolify-mesh-sync.mjs, a to PŘED vlnou 5.
 *   2. pojistka na CORE_MESH_IP je podmíněná vlnou — nepálí v bring-up vlnách.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts", "aisha-cold-start.sh");
const REDEPLOY = join(ROOT, "scripts", "aisha-redeploy.mjs");

function read(p: string): string {
  expect(existsSync(p), `${p} musí existovat`).toBe(true);
  return readFileSync(p, "utf-8");
}

/** Řádky, které skript SPOUŠTĚJÍ — ne komentáře, ne dokumentace. */
export function invocationLines(src: string, script: string): string[] {
  return src
    .split("\n")
    .filter((l) => l.includes(script))
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("#") && !l.startsWith("*") && !l.startsWith("//"));
}

describe("mesh-sync je zapojený do cold-startu, ne jen přítomný", () => {
  test("cold-start coolify-mesh-sync.mjs VOLÁ (ne jen zmiňuje v komentáři)", () => {
    const src = read(COLD_START);
    const calls = invocationLines(src, "coolify-mesh-sync.mjs");
    expect(
      calls.length,
      "cold-start musí coolify-mesh-sync.mjs spustit. Samotná existence skriptu " +
        "není zapojení — přesně tak vznikla vada z 2026-08-09: dvě brány tvrdily " +
        '"populated by coolify-mesh-sync.mjs in cold-start step 5", ale nikdo ho nevolal.',
    ).toBeGreaterThan(0);
    expect(
      calls.some((l) => l.includes("--apply")),
      "volání musí být --apply; check-only běh nic nepropíše do Coolify",
    ).toBe(true);
  });

  test("volá se PŘED vlnou 5 (mesh warmup), ne po ní", () => {
    const src = read(COLD_START);
    const lines = src.split("\n");
    const syncAt = lines.findIndex(
      (l) => l.includes("coolify-mesh-sync.mjs") && !l.trim().startsWith("#"),
    );
    const wave5At = lines.findIndex((l) => l.includes("--from=${AISHA_WAVE_PHASE_D_FROM}"));
    expect(syncAt, "volání mesh-sync nenalezeno").toBeGreaterThan(-1);
    expect(wave5At, "spuštění vln od 5 nenalezeno").toBeGreaterThan(-1);
    expect(
      syncAt,
      "mesh IP musí být propagované DŘÍV, než vlna 5 nasadí edge — jinak dostane " +
        "mesh-router DNAT bez cíle (api 502, incidenty 07-29/30/31)",
    ).toBeLessThan(wave5At);
  });

  test("selhání mesh-syncu cold-start zastaví (fail-loud, ne warn)", () => {
    const src = read(COLD_START);
    const i = src.indexOf("coolify-mesh-sync.mjs --apply");
    expect(i).toBeGreaterThan(-1);
    const after = src.slice(i, i + 900);
    expect(
      /\bexit 1\b/.test(after),
      "bez mesh IP nemá smysl pokračovat do vlny 5 — pokračovat by znamenalo " +
        "nasadit rozbitý routing a tvářit se zeleně",
    ).toBe(true);
  });

  test("pojistka na CORE_MESH_IP respektuje pozici ve vlně", () => {
    const src = read(REDEPLOY);
    expect(
      /function meshGuardApplies\s*\(/.test(src),
      "musí existovat explicitní predikát, od které vlny pojistka platí",
    ).toBe(true);

    // Každé místo, kde se pálí na MESH_IP_REQUIRED_BY, musí být wave-podmíněné.
    const guardSites = src
      .split("\n")
      .filter((l) => l.includes("MESH_IP_REQUIRED_BY.has("));
    expect(guardSites.length, "očekávána aspoň jedna pojistka").toBeGreaterThan(0);
    for (const line of guardSites) {
      expect(
        line.includes("meshGuardApplies("),
        `pojistka bez podmínky na vlnu: ${line.trim()}\n` +
          "Vlna 2 je bootstrap okno — mesh se teprve zapíná, management jde nahoru až " +
          "ve vlně 4 (WAVES[5]: Edge and core deploy in wave 2 " +
          "before netbird management … This is the key to making mesh self-healing). " +
          "Tvrdý fail tam zruší i vlnu 5, která mesh zavádí.",
      ).toBe(true);
    }
  });

  test("ad-hoc běh (mimo vlny) pojistku NEZTRÁCÍ", () => {
    // `--only edge` / `npm run redeploy` = operátor sahá na edge mimo cold-start
    // a mesh očekává. Přesně ten scénář způsobil incidenty 07-29/30/31, takže
    // tam pojistka pálit musí.
    const src = read(REDEPLOY);
    const fn = src.slice(src.indexOf("function meshGuardApplies"), src.indexOf("function meshGuardApplies") + 700);
    expect(
      /wave === WAVE_ADHOC/.test(fn),
      "ad-hoc pozice musí být pojmenovaná konstanta a pojistka na ní musí platit",
    ).toBe(true);
    // ⛔ NAMĚŘENO 2026-08-19: tady stálo `/const WAVE_ADHOC = 0;/`, tedy PŘIPNUTÁ
    // HODNOTA. Jenže vlna 0 SKUTEČNĚ existuje, takže `WAVE_ADHOC = 0` znamenalo,
    // že pojistka nerozliší „operátor sáhl mimo vlny" od „běží vlna 0" — a hlásila
    // opak pravdy. Brána tu vadu držela na místě: kdo ji narovnal, shodil bránu.
    // Vlastnost zní: ad-hoc je POJMENOVANÁ konstanta, která se NEPŘEKRÝVÁ s žádným
    // pořadím vlny. Jak přesně se jmenuje hodnota, je jedno.
    const deklarace = /const WAVE_ADHOC = (.+?);/.exec(src);
    expect(deklarace, "ad-hoc se DEKLARUJE (WAVE_ADHOC), neodvozuje z chybějícího argumentu").toBeTruthy();
    const hodnota = deklarace![1].trim();
    expect(
      Number.isInteger(Number(hodnota)),
      `WAVE_ADHOC = ${hodnota} — celé číslo koliduje se skutečným pořadím vlny (vlna 0 existuje), ` +
        "takže pojistka nerozezná ad-hoc běh od té vlny",
    ).toBe(false);
  });

  test("Phase D2 je řízená projektovým rozsahem, ne tvarem nasazení", () => {
    // Automatizovaně, autonomně, project-scope defined: multi-cloud / multi-node /
    // single-node musí jet TOUŽ cestou a lišit se jen deklarací instance.
    // Rozhoduje MESH_ENABLED (operátorská deklarace ve vaultu); profily nesou jen
    // šablonový default false, takže větvit podle profilu by bylo čtení šablony
    // místo skutečnosti.
    //
    // Bez téhle podmínky by fail-loud Phase D2 shodila každý běh, kde si instance
    // mesh nedeklarovala — a single-node, který si vystačí s docker sítí, by
    // přestal jít nasadit vůbec.
    const src = read(COLD_START);
    const i = src.indexOf("Phase D2");
    expect(i, "Phase D2 nenalezena").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, i - 600), i + 3000);
    expect(
      /\[ "\$\{MESH_ENABLED\}" = "true" \]/.test(block),
      "Phase D2 musí být podmíněná MESH_ENABLED — ne profilem, ne počtem uzlů",
    ).toBe(true);
    expect(
      /else[\s\S]{0,200}Phase D2 přeskočena/.test(block),
      "vypnutá mesh musí být hlášená a přeskočená, ne tichá",
    ).toBe(true);
  });

  test("žádné fallbacky: nedeklarovaný MESH_ENABLED padá, netiší se", () => {
    // "Nevím, jestli tahle instance jede přes mesh" není "ne". Bez téhle
    // kontroly by prázdná proměnná Phase D2 tiše přeskočila a vlna 5 by nasadila
    // edge s mesh-routerem bez cíle — volba, kterou nikdo nevyslovil.
    const src = read(COLD_START);
    const i = src.indexOf("Phase D2");
    const block = src.slice(Math.max(0, i - 1600), i + 3000);
    expect(
      /if \[ -z "\$\{MESH_ENABLED:-\}" \]/.test(block),
      "nedeklarovaná hodnota musí padnout, ne mlčky vypnout mesh",
    ).toBe(true);
  });

  test("žádné fallbacky: pozice ve vlně se nedovozuje z undefined", () => {
    // Kdyby chybějící wave znamenalo "asi ad-hoc", nové volání by chování
    // dostalo opomenutím. Volající pozici DEKLARUJE — nebo to spadne.
    const src = read(REDEPLOY);
    expect(
      /Number\.isInteger\(wave\)/.test(src),
      "meshGuardApplies musí neuvedenou pozici odmítnout, ne dosadit",
    ).toBe(true);
    expect(
      /wave === undefined|wave \?\? |wave \|\| /.test(src),
      "žádný tichý default pro pozici ve vlně",
    ).toBe(false);
    // …a každé spouštěcí volání pozici skutečně nese. Od 2026-08-11 (restart
    // validace) se trigger volá i přes dispatch (triggerFn) a retry přes
    // retryTrigger — invariant platí pro CELOU rodinu volání, ne jen pro
    // doslovné jméno triggerDeploy (jinak by refaktor sondu tiše vyprázdnil).
    const calls = src
      .split("\n")
      .filter((l) => /await (?:triggerDeploy|triggerRestart|triggerFn|retryTrigger)\(/.test(l));
    // Od fáze D (2026-09-26) jde každý trigger jedněmi dveřmi `spustHlidane`
    // (souběžnost + disková brána). Pozice se tam DEKLARUJE klíčem `wave:` —
    // rodina volání proto zahrnuje i dveře, jinak by refaktor sondu vyprázdnil.
    const dvere = src
      .split("\n")
      .filter((l) => /spustHlidane\(/.test(l) && !/function spustHlidane/.test(l));
    expect(calls.length + dvere.length, "očekávána aspoň dvě volání").toBeGreaterThan(1);
    for (const c of calls) {
      expect(
        /(?:triggerDeploy|triggerRestart|triggerFn|retryTrigger)\([^)]*,\s*(wave(\.num)?|WAVE_ADHOC)\)/.test(c),
        `volání bez deklarované pozice: ${c.trim()}`,
      ).toBe(true);
    }
    for (const c of dvere) {
      expect(
        /\bwave:\s*(?:wave\.num|WAVE_ADHOC|poziceVlny)\b/.test(c),
        `volání dveří bez deklarované pozice: ${c.trim()}`,
      ).toBe(true);
    }
    // …a dveře pozici předají triggeru a neuvedenou odmítnou (ne dosadí).
    const teloDveri = src.slice(src.indexOf("async function spustHlidane("), src.indexOf("// ── Pre-wave snapshot"));
    expect(teloDveri.length, "tělo spustHlidane nenalezeno").toBeGreaterThan(100);
    expect(/triggerFn\([^)]*,\s*wave\)/.test(teloDveri), "dveře musí pozici předat triggeru").toBe(true);
    expect(/Number\.isInteger\(wave\)/.test(teloDveri), "dveře musí neuvedenou pozici odmítnout").toBe(true);
  });

  test("wave se do pojistky opravdu předává (jinak by predikát byl dekorace)", () => {
    const src = read(REDEPLOY);
    expect(/refreshMeshIps\(short,\s*wave\)/.test(src), "refreshMeshIps musí wave dostat").toBe(true);
    // Vlnová smyčka volá od 2026-08-11 přes dispatch (triggerFn = deploy|restart);
    // pozici musí předávat bez ohledu na zvolenou operaci.
    // Od fáze D (2026-09-26) volá smyčka trigger jedněmi dveřmi (spustHlidane).
    expect(
      /(?:triggerDeploy|triggerFn)\([^)]*,\s*wave\.num\)/.test(src) ||
        /spustHlidane\([^)]*\{[^}]*\bwave:\s*wave\.num\b/.test(src),
      "vlnová smyčka musí wave.num předat do trigger volání (triggerFn/triggerDeploy/spustHlidane)",
    ).toBe(true);
  });
});
