// =============================================================================
// run-vitest-verdikt.test.mjs — sondy hlídače postupu (včetně té negativní)
// =============================================================================
// ⛔ HLÍDAČ, KTERÝ SE NEDÁ OVĚŘIT, JE JEN NÁZOR. Změna „verdikt stojí na důkazu,
// ne na uplynulém čase" se dá snadno zkazit tak, že hlídač přestane zamrznutí
// POZNAT — a nikdo si toho nevšimne, protože všechno je pak zelené. Proto je
// mezi sondami povinná NEGATIVNÍ: běh, který doopravdy zamrzne a nenechá po
// sobě důkaz, musí i nadále skončit nenulově (a rozlišitelně).
//
// Běhy se podstrkují přes `AISHA_VITEST_CMD` (náhradní běh `__sondy__/sonda-behu.mjs`),
// takže se tu nespouští vitest ve vitestu a celá sada trvá vteřiny.
// Wrapper se pouští s cwd v dočasném adresáři, aby nemohl sáhnout na report
// z opravdového běhu bran v pracovní kopii.
// =============================================================================
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KOD_NEZMERENO, KOD_SELHANI, KOD_ZELENA, verdiktFazi } from "./verdikt-kody.mjs";

const ZDE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(ZDE, "run-vitest.mjs");
const SONDA = path.join(ZDE, "__sondy__", "sonda-behu.mjs");

const STALL_MS = 2_500;

function spustWrapper({ rezim, trvaniMs, suspendJumpMs = 60_000, poStartu }) {
  // `poStartu` dostane i cestu k report-adresáři, aby uměla fixtuře dát pokyn.
  const cwd = mkdtempSync(path.join(os.tmpdir(), "sonda-cwd-"));
  const reportDir = mkdtempSync(path.join(os.tmpdir(), "sonda-report-"));
  const zacatek = Date.now();
  const p = spawn(process.execPath, [WRAPPER], {
    cwd,
    env: {
      ...process.env,
      AISHA_VITEST_CMD: JSON.stringify([process.execPath, SONDA]),
      AISHA_STALL_MS: String(STALL_MS),
      AISHA_SUSPEND_JUMP_MS: String(suspendJumpMs),
      AISHA_REPORT_DIR: reportDir,
      SONDA_REZIM: rezim,
      ...(trvaniMs ? { SONDA_TRVANI_MS: String(trvaniMs) } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  p.stdout.on("data", (d) => (out += d.toString()));
  p.stderr.on("data", (d) => (err += d.toString()));
  if (poStartu) poStartu(p, reportDir);
  return new Promise((resolve) => {
    p.on("exit", (kod) => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(reportDir, { recursive: true, force: true });
      resolve({ kod, out, err, trvalo: Date.now() - zacatek });
    });
  });
}

const spi = (ms) => new Promise((r) => setTimeout(r, ms));

describe("verdikt běhu stojí na důkazu, ne na uplynulém čase", () => {
  test("NEGATIVNÍ SONDA: zamrzlý běh bez důkazu je pořád poznat — a je NEZMĚŘENO, ne selhání", async () => {
    const r = await spustWrapper({ rezim: "ticho" });
    expect(r.kod).toBe(KOD_NEZMERENO);
    expect(r.err).toContain("BEZ POSTUPU");
    expect(r.err).toContain("NEZMĚŘENO");
    // Nezměřeno se NESMÍ slít se selháním testů — to je celý smysl třetího stavu.
    expect(r.kod).not.toBe(1);
    expect(r.kod).not.toBe(0);
  }, 20_000);

  test("zamrzlý běh, po kterém zbyl zelený report, se uzavře PODLE REPORTU", async () => {
    const r = await spustWrapper({ rezim: "report-zeleny" });
    expect(r.kod).toBe(0);
    expect(r.err).toContain("verdikt z REPORTU");
    expect(r.err).toContain("PASS");
  }, 20_000);

  test("zamrzlý běh s padlými testy v reportu je SELHÁNÍ, ne nezměřeno", async () => {
    const r = await spustWrapper({ rezim: "report-cerveny" });
    expect(r.kod).toBe(1);
    expect(r.err).toContain("2 padlých");
  }, 20_000);

  test("běh, který MLČÍ, ale hýbe reportem, se nesmí zabít (mlčení není smrt)", async () => {
    // Ticho trvá dvojnásobek okna hlídače; jediný důkaz života je pohyb tepu.
    const r = await spustWrapper({ rezim: "tep", trvaniMs: STALL_MS * 2 });
    expect(r.kod).toBe(0);
    expect(r.err).not.toContain("BEZ POSTUPU");
    expect(r.trvalo).toBeGreaterThan(STALL_MS);
  }, 30_000);

  test("uspaný stroj není zamrzlý běh: skok v čase se nezapočítá do ticha", async () => {
    // Wrapper se na 4 s zastaví (SIGSTOP) — delší pauza, než je celé okno
    // hlídače. Bez rozpoznání skoku by po probuzení rovnou uzavřel NEZMĚŘENO.
    const r = await spustWrapper({
      rezim: "spanek",
      trvaniMs: 5_500,
      suspendJumpMs: 1_000,
      poStartu: async (p, reportDir) => {
        await spi(500);
        try {
          process.kill(p.pid, "SIGSTOP");
          await spi(4_000);
          process.kill(p.pid, "SIGCONT");
          // Pokyn AŽ TEĎ: bez rozpoznání skoku by wrapper uzavřel běh hned při
          // probuzení (stál 4 s, okno je 2,5 s) — dřív, než fixtura stihne
          // cokoli zapsat. S rozpoznáním má běh další celé okno a fixtura ho
          // v klidu doběhne. Pořadí je tím dané, ne odhadnuté.
          writeFileSync(path.join(reportDir, "pokracuj"), "\n");
        } catch {
          /* proces už skončil — test to pozná na návratovém kódu */
        }
      },
    });
    expect(r.err).toContain("skok v čase");
    expect(r.kod).toBe(0);
  }, 30_000);

  test("BAREVNÝ souhrn je taky souhrn — zelený běh se nesmí uzavřít jako NEZMĚŘENO", async () => {
    // ⛔ NAMĚŘENO 2026-09-20 v CI (běh 50075): vitest barví i do roury, takže
    // v bufferu stojí `Tests <ESC>[22m <ESC>[1m<ESC>[32m551 passed`. Vzor
    // `/Tests\s+\d+/` na tom neuspěje a zelený běh (551 testů, kód 0) se
    // uzavřel jako NEZMĚŘENO. Text se proto před měřením očišťuje od barev.
    const r = await spustWrapper({ rezim: "barevny-souhrn" });
    expect(r.kod).toBe(0);
    expect(r.err).not.toContain("NEZMĚŘENO");
  }, 20_000);

  test("falešný pád z RPC timeoutu se pozná i v barveném výstupu", async () => {
    // Tolerance, kvůli které tenhle wrapper vůbec vznikl — a která byla v CI
    // po celou dobu mrtvá ze stejné příčiny (barvy v bufferu).
    const r = await spustWrapper({ rezim: "rpc-timeout" });
    expect(r.kod).toBe(0);
    expect(r.err).toContain("RPC-timeout false positive");
  }, 20_000);

  test("nula bez jediného měření není zelená", async () => {
    const r = await spustWrapper({ rezim: "nula-bez-mereni" });
    expect(r.kod).toBe(KOD_NEZMERENO);
    expect(r.err).toContain("Nula bez měření není zelená");
  }, 20_000);
});

describe("verdikt nesmí zmizet na rouře mezi fázemi", () => {
  // ⛔ NAMĚŘENO 2026-09-20 dvakrát na téže větvi: běh i jeho opakování napsaly
  // „ani opakovaný běh nic nezměřil… Tohle NENÍ nález, ale nefunkční měřidlo",
  // a stack-smoke přesto uzavřela fázi jako `✗ offline (FAIL)` a pre-push push
  // zamítl s „oprav před pushem". Nástroj poznal, že nic nenaměřil, a pak se
  // zachoval, jako by naměřil vadu. Tahle sada hlídá právě to sčítání.
  test("vše zelené → 0", () => {
    expect(verdiktFazi({ preflightOk: true, offlineOk: true }).kod).toBe(KOD_ZELENA);
  });

  test("poctivě padlý krok → SELHÁNÍ (nález se nesmí schovat za „zopakuj běh“)", () => {
    const v = verdiktFazi({
      preflightOk: true,
      offlineOk: false,
      offlineSelhaloZmerene: true,
      offlineNezmerene: ["npm run test:gates"],
    });
    expect(v.kod).toBe(KOD_SELHANI);
    expect(v.jenNezmereno).toBe(false);
  });

  test("selhaly JEN nezměřené kroky → NEZMĚŘENO propadne až nahoru", () => {
    const v = verdiktFazi({
      preflightOk: true,
      offlineOk: false,
      offlineNezmerene: ["npm run test:gates"],
    });
    expect(v.kod).toBe(KOD_NEZMERENO);
    expect(v.jenNezmereno).toBe(true);
    // A pořád to NENÍ zelená: neověřeno není ověřeno, push se nepouští.
    expect(v.kod).not.toBe(KOD_ZELENA);
  });

  test("padlý preflight přebíjí nezměřené kroky — měřidlo se ani nerozjelo", () => {
    const v = verdiktFazi({
      preflightOk: false,
      offlineOk: false,
      offlineNezmerene: ["npm run test:gates"],
    });
    expect(v.kod).toBe(KOD_SELHANI);
  });
});
