#!/usr/bin/env node
/**
 * bootstrap-verdikt.mjs — výsledek zakládání n8n v clusteru, zapsaný tam, kde ho
 * cold-start (a kdokoli jiný) PŘEČTE.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (audit cesty cold-startu nad guru). Jednorázový kontejner
 * `<prefix>-n8n--workflow-init` (restart: "no", healthcheck vypnutý) končil kódem,
 * který NIKDO NEČETL: stav aplikace v Coolify se jeho selháním nezmění a krok 6
 * cold-startu ověřoval workflows jen s API klíčem, který operátor nemá (veřejné
 * API n8n stojí za OAuth) — takže vždy „Host verify skipped". Credentials se
 * navíc na cestě cold-startu nezakládaly vůbec (provision-credentials.mjs volala
 * jen CI úloha). n8n tak mohl nabíhat bez workflowů i bez pověření a nikdo by
 * to nevěděl.
 *
 * Verdikt jde přes EXISTUJÍCÍ auditní RPC `log_integration_action` (služba `n8n`
 * je v seedu jádra): service role ho smí volat, operátor ho přečte přes veřejné
 * API. Žádná nová tabulka, žádný nový kanál.
 *
 * Použití (v init kontejneru, po mintu klíče, credentials a workflowech):
 *   node bootstrap-verdikt.mjs --klic-rc <n> --typy-rc <n> --credentials-rc <n> \
 *     --credentials-log <soubor> --workflows-rc <n>
 * `--typy-rc`: scripts/n8n/overit-typy.mjs — zná běžící n8n typy, na které workflowy odkazují?
 * Prostředí: AISHA_POSTGREST_URL (brána, `/rest/v1` se připojuje), AISHA_SERVICE_KEY.
 * Kód: 0 = verdikt zapsán · 1 = zápis selhal (verdikt se NEDOSTAL k nikomu).
 * Nikdy nevypisuje hodnoty tajemství.
 */
import { readFileSync, existsSync } from "node:fs";
import { isDirectRun } from "../lib/cli-entry.mjs";

/**
 * Výpis provision-credentials.mjs → počty a jména přeskočených (chybí vstup obsluhy)
 * a selhaných (jen jméno a typ — text chyby do verdiktu nejde).
 * Nečitelný výpis NENÍ „nic se nepřeskočilo" — vrací `precteno: false`.
 */
export function rozeberCredentialsLog(text) {
  const souhrn = /done:\s*(\d+)\s+created,\s*(\d+)\s+already present,\s*(\d+)\s+skipped/.exec(text ?? "");
  const preskocene = [...String(text ?? "").matchAll(/skip\s+"([^"]+)"\s+\[([^\]]+)\][^\n]*missing env:\s*([^\n]+)/g)]
    .map((m) => ({ nazev: m[1], typ: m[2], chybi: m[3].split(/,\s*/).map((s) => s.trim()).filter(Boolean) }));
  const selhane = [...String(text ?? "").matchAll(/❌\s+"([^"]+)"\s+\[([^\]]+)\]/g)].map((m) => ({ nazev: m[1], typ: m[2] }));
  if (!souhrn) return { precteno: false, zalozeno: 0, existovalo: 0, preskoceno: preskocene.length, preskocene, selhane };
  return {
    precteno: true,
    zalozeno: Number(souhrn[1]),
    existovalo: Number(souhrn[2]),
    preskoceno: Number(souhrn[3]),
    preskocene,
    selhane,
  };
}

/** Celkový stav: selhání kteréhokoli kroku = `error`; jen chybějící vstupy obsluhy = `success` s výčtem. */
export function sestavVerdikt({ klicRc, typyRc, credentialsRc, workflowsRc, credentials }) {
  const selhalo = [];
  if (klicRc !== 0) selhalo.push("api-klic");
  if (typyRc !== 0) selhalo.push("typy");
  if (credentialsRc !== 0 || !credentials.precteno) selhalo.push("credentials");
  if (workflowsRc !== 0) selhalo.push("workflows");
  return {
    // Hodnoty MUSÍ být z CHECK tabulky integration_service_logs ('success',
    // 'failure', 'partial'). ⛔ NAMĚŘENO 2026-09-18: stálo tu "error" — databáze
    // řádek odmítla (23514) a verdikt se nezapsal NIKDY, ani s dosažitelnou adresou.
    status: selhalo.length ? "failure" : "success",
    detail: {
      kroky: { api_klic: klicRc, typy: typyRc, credentials: credentialsRc, workflows: workflowsRc },
      credentials: {
        zalozeno: credentials.zalozeno,
        existovalo: credentials.existovalo,
        preskoceno: credentials.preskoceno,
        preskocene: credentials.preskocene,
        selhane: credentials.selhane ?? [],
      },
      selhalo,
    },
    chyba: selhalo.length ? `n8n bootstrap nedokončen: ${selhalo.join(", ")}` : null,
  };
}

async function zapis(verdikt) {
  const brana = String(process.env.AISHA_POSTGREST_URL ?? "").replace(/\/+$/, "");
  const klic = String(process.env.AISHA_SERVICE_KEY ?? "");
  if (!brana || !klic) {
    throw new Error("AISHA_POSTGREST_URL nebo AISHA_SERVICE_KEY chybí — verdikt nemá kam jít");
  }
  const res = await fetch(`${brana}/rest/v1/rpc/log_integration_action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: klic, Authorization: `Bearer ${klic}` },
    body: JSON.stringify({
      p_service_name: "n8n",
      p_action: "bootstrap",
      p_action_detail: verdikt.detail,
      p_status: verdikt.status,
      p_error_message: verdikt.chyba,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`log_integration_action → HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const hodnota = (p) => {
    const i = argv.indexOf(p);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cislo = (p) => {
    const v = hodnota(p);
    if (!/^\d+$/.test(String(v ?? ""))) {
      console.error(`[n8n-verdikt] ${p} chybí nebo není číslo — verdikt by lhal`);
      process.exit(1);
    }
    return Number(v);
  };
  const log = hodnota("--credentials-log");
  const credentials = rozeberCredentialsLog(log && existsSync(log) ? readFileSync(log, "utf8") : "");
  const verdikt = sestavVerdikt({
    klicRc: cislo("--klic-rc"),
    typyRc: cislo("--typy-rc"),
    credentialsRc: cislo("--credentials-rc"),
    workflowsRc: cislo("--workflows-rc"),
    credentials,
  });
  try {
    await zapis(verdikt);
    console.log(`[n8n-verdikt] zapsáno: ${verdikt.status}${verdikt.chyba ? ` — ${verdikt.chyba}` : ""}; credentials založeno ${credentials.zalozeno}, přeskočeno ${credentials.preskoceno}`);
  } catch (e) {
    console.error(`[n8n-verdikt] ZÁPIS SELHAL — výsledek bootstrapu se k nikomu nedostane: ${e.message}`);
    process.exit(1);
  }
}
