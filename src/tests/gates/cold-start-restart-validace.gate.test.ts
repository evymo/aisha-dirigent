/**
 * Restart validace je zapojená a měří spuštěnou akci, ne starý stav (CLASS gate)
 *
 * DVĚ TŘÍDY VAD, jedna rodina "výstup vypadá jako odpověď na jinou otázku":
 *
 * 1. FROM-ZERO ZELENÉ / RESTART ROZBITÉ — čistý wipe dokazuje "od nuly to
 *    naběhne", ne "po restartu to naběhne znovu". První běh mohl uspět jen
 *    díky bootstrapu, který se už nikdy nezopakuje. Proto cold-start na konci
 *    restartuje stack po vlnách (bez env-sync, bez rebuildu) a čeká na návrat
 *    zdraví — až PO úklidu warmupů, aby se zároveň prokázalo, že sítě přežily
 *    smazání svého tvůrce.
 *
 * 2. ZDRAVÍ STARÉHO KONTEJNERU (#104, změřeno 2026-08-11 na aisha-clamav):
 *    restart visel `queued` (started_at=None) a aplikace celou dobu hlásila
 *    running:healthy — zdraví STARÉHO kontejneru. Čekací smyčka bez pojistky
 *    by uspěla na první dotaz a nikdy nezměřila výsledek spuštěné akce.
 *    Pojistka: aplikace se sledovaným deploymentem není OK, dokud deployment
 *    neskončí (deployPending).
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Zkontroluje zapojení restart validace v cold-startu. Vrací nálezy. */
export function zkontrolujColdStart(sh: string): string[] {
  const nalezy: string[] = [];
  const uklid = sh.lastIndexOf("\nremove_warmup_apps\n");
  const validace = sh.indexOf("--restart-validate");
  const summary = sh.indexOf('step "7. SUMMARY"');

  if (validace === -1) {
    nalezy.push(
      "cold-start nevolá `--restart-validate` — wipe pak dokazuje jen from-zero, " +
        "ne návrat po restartu.",
    );
    return nalezy;
  }
  if (uklid === -1 || validace < uklid) {
    nalezy.push(
      "restart validace musí běžet až PO úklidu warmupů (remove_warmup_apps) — " +
        "jinak neprokáže, že sítě přežily smazání tvůrce a že na netinit nic nezávisí.",
    );
  }
  if (summary !== -1 && validace > summary) {
    nalezy.push("restart validace musí běžet PŘED summary — je to gate, ne poznámka.");
  }
  // --skip-healthy by validaci vyprázdnil (restartujeme právě zdravé); skript
  // tu kombinaci odmítá exit 2 — cold-start ji proto nesmí poslat.
  const radek = sh.slice(sh.lastIndexOf("\n", validace) + 1, sh.indexOf("\n", validace));
  if (/REDEPLOY_FLAGS/.test(radek)) {
    nalezy.push(
      "volání --restart-validate nese $REDEPLOY_FLAGS — na fresh install obsahuje " +
        "--skip-healthy a validace by se odmítla spustit (exit 2) na konci wipu.",
    );
  }
  return nalezy;
}

/** Zkontroluje implementaci restart režimu v redeploy skriptu. Vrací nálezy. */
export function zkontrolujRedeploy(mjs: string): string[] {
  const nalezy: string[] = [];
  if (!/flag\("--restart-validate"\)/.test(mjs)) {
    nalezy.push("aisha-redeploy.mjs nezná --restart-validate — cold-start by volal neexistující režim.");
  }
  if (!/\/applications\/\$\{uuid\}\/restart/.test(mjs)) {
    nalezy.push("chybí triggerRestart přes /applications/{uuid}/restart — restart by se nespustil.");
  }
  if (!/bez deployment_uuid/.test(mjs)) {
    nalezy.push(
      "restart bez deployment_uuid musí být chyba (fail-loud) — bez důkazu zařazení " +
        "nejde restart odlišit od tichého no-opu.",
    );
  }
  // Invariant, ne doslovný tvar: podmínka přijetí musí deployPending vylučovat.
  // Sonda se hledá PODLE OBSAHU (isFullyHealthy), ne podle jména proměnné:
  // `const ok = …` trefilo v souboru dřív logovací pomocník `const ok = (s) => log(…)`
  // na ř. 207 a měřilo tedy úplně jiný řádek (2026-08-11) — regex našel *nějakou*
  // shodu a to vypadalo jako měření.
  const okLine = mjs.split("\n").find((l) => /^\s*const ok = .*isFullyHealthy\(/.test(l)) || "";
  if (!okLine) {
    nalezy.push("nenalezena podmínka přijetí (const ok = … isFullyHealthy(…)) — brána nemá co měřit.");
  } else if (!/!deployPending/.test(okLine)) {
    nalezy.push(
      "chybí pojistka deployPending (#104) — čekací smyčka by přijala zdraví STARÉHO " +
        "kontejneru, zatímco restart/deploy teprve stojí ve frontě (změřeno 2026-08-11).",
    );
  }
  // Tutéž operaci: buď přímo `retryTrigger: triggerFn`, nebo (od fáze D, 2026-09-26)
  // přes jedny dveře k triggeru — `spustHlidane([name], { …, triggerFn, … })`, kudy
  // jde i disková brána a souběžnost. Bez `triggerFn` by dveře vzaly výchozí
  // triggerDeploy a restart by se tiše změnil v redeploy.
  const retryToutezOperaci =
    /retryTrigger: triggerFn\b/.test(mjs) ||
    /retryTrigger: async \([^)]*\) => \(await spustHlidane\(\[name\], \{[^}]*\btriggerFn\b[^}]*\}\)\)\[0\]/.test(mjs);
  if (!retryToutezOperaci || !/await retryTrigger\(/.test(mjs)) {
    nalezy.push(
      "auto-retry musí opakovat TOUTÉŽ operaci (retryTrigger) — selhaný restart nesmí " +
        "tiše přejít v redeploy, ten odpovídá na jinou otázku.",
    );
  }
  return nalezy;
}

describe("restart validace: zapojení + poctivé měření", () => {
  const sh = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
  const mjs = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf-8");

  test("cold-start volá restart validaci na správném místě", () => {
    expect(zkontrolujColdStart(sh)).toEqual([]);
  });

  test("redeploy skript restart režim skutečně implementuje", () => {
    expect(zkontrolujRedeploy(mjs)).toEqual([]);
  });

  // ── Negativní testy ─────────────────────────────────────────────────────────
  test("chybějící volání v cold-startu je nález", () => {
    expect(zkontrolujColdStart(sh.split("--restart-validate").join("--nic")).join("\n")).toContain(
      "nevolá",
    );
  });

  test("validace před úklidem warmupů je nález", () => {
    // Přesunout volání PŘED remove_warmup_apps: prohodit pořadí markerů.
    const mut = sh.replace("\nremove_warmup_apps\n", "\ntrue\n");
    expect(
      zkontrolujColdStart(mut).join("\n"),
    ).toContain("PO úklidu");
  });

  test("REDEPLOY_FLAGS na volacím řádku je nález", () => {
    const mut = sh.replace(
      "node scripts/aisha-redeploy.mjs --restart-validate \\",
      "node scripts/aisha-redeploy.mjs --restart-validate $REDEPLOY_FLAGS \\",
    );
    expect(zkontrolujColdStart(mut).join("\n")).toContain("REDEPLOY_FLAGS");
  });

  test("odstranění deployPending pojistky je nález", () => {
    const mut = mjs.replace(/^(\s*)const ok = .*isFullyHealthy\(.*$/m, "$1const ok = isFullyHealthy(cls);");
    expect(zkontrolujRedeploy(mut).join("\n")).toContain("#104");
  });

  test("zmizení celé podmínky přijetí je nález (brána nesmí mlčet)", () => {
    const mut = mjs.replace(/^(\s*)const ok = .*isFullyHealthy\(.*$/m, "$1const ok = true;");
    expect(zkontrolujRedeploy(mut).join("\n")).toContain("nemá co měřit");
  });

  test("ztráta fail-loud větve u deployment_uuid je nález", () => {
    const mut = mjs.replace(/bez deployment_uuid/g, "ok");
    expect(zkontrolujRedeploy(mut).join("\n")).toContain("fail-loud");
  });

  test("retry jinou operací je nález", () => {
    const mut = mjs.replace("await retryTrigger(", "await triggerDeploy(");
    expect(zkontrolujRedeploy(mut).join("\n")).toContain("TOUTÉŽ operaci");
  });

  test("retry dveřmi bez triggerFn (= výchozí redeploy) je nález", () => {
    const mut = mjs.replace(/(retryTrigger: async \([^)]*\) => \(await spustHlidane\(\[name\], \{[^}]*?)\btriggerFn, /, "$1");
    expect(mut, "mutace se musí trefit").not.toBe(mjs);
    expect(zkontrolujRedeploy(mut).join("\n")).toContain("TOUTÉŽ operaci");
  });
});
