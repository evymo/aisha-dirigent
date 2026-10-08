#!/usr/bin/env node
/**
 * nasazeni-navazani.mjs — na co má pokračovací job navázat?
 *
 * PROČ VZNIKL (naměřeno 2026-09-30)
 * ---------------------------------
 * Vlna nasazení s mnoha aplikacemi trvá 35–49 min; runner job utne na svém
 * stropu (2026-09-30: přesně v 60. minutě, uprostřed vlny). Nasazení v Coolify
 * přitom DOBÍHAJÍ dál — runner je jen přestal sledovat. Vlnový job proto na
 * měkkém termínu předá rozpracované appky pokračovacímu jobu, který na ně
 * NAVÁŽE: dočká se jich a ověří je stejným standardem jako dnešní zelená.
 *
 * Tenhle modul rozhoduje JEDINĚ podle nasazení, která vznikla PO začátku
 * téhož běhu CI (razítko z jobu `deploy-zacatek`). Neusuzuje „appka je
 * v cílovém stavu“ z historie — to by vyžadovalo důkaz revize na cíli, který
 * stacky nevydávají.
 *
 *   akce      kdy
 *   navazat   nejnovější nasazení s commit == GIT_SHA běží (queued/in_progress)
 *   overit    nejnovější nasazení s commit == GIT_SHA doběhlo (finished)
 *   nasadit   žádné takové nasazení není, nebo nejnovější spadlo (zopakuje se
 *             a skutečná chyba spadne znovu — neschová se)
 *   cizi_sha  po začátku běhu vzniklo nasazení s JINOU revizí: někdo mezitím
 *             sloučil a Coolify postavil novější HEAD. Tvrdý pád, nikdy tiché
 *             přijetí (pravidlo slučování: až po terminálním deploy-verdikt).
 *   nejasne   nasazení bez revize (commit HEAD/prázdný) nebo stav, který modul
 *             nezná — nejistota = STOP, ne odhad
 *
 * CLI: JSON odpovědi `/api/v1/deployments/applications/<uuid>` na stdin,
 *   node scripts/lib/nasazeni-navazani.mjs --od <epoch s> --sha <revize>
 * stdout: `akce<TAB>deployment_uuid<TAB>stav<TAB>detail`. Kód 2 = nečitelný vstup.
 */
import { isDirectRun } from "./cli-entry.mjs";

const BEZI = new Set(["queued", "in_progress"]);
const HOTOVO = new Set(["finished", "success", "succeeded"]);
const SPADLO = new Set(["failed", "cancelled", "canceled", "error"]);
const REVIZE = /^[0-9a-f]{7,40}$/;

/** Čas vzniku nasazení v sekundách; nečitelný = NaN (a nasazení se pak nepočítá jako „po začátku“). */
function vzniklo(d) {
  const t = Date.parse(String(d?.created_at ?? ""));
  return Number.isFinite(t) ? t / 1000 : NaN;
}

/**
 * @param {{deployments?: unknown[]}|unknown[]} odpoved  tělo `/deployments/applications/<uuid>`
 * @param {{od: number, sha: string}} o  razítko začátku běhu (s) a nasazovaná revize
 * @returns {{akce: string, uuid: string, stav: string, detail: string}}
 */
export function vyberNavazani(odpoved, { od, sha }) {
  if (!Number.isFinite(od) || od <= 0) throw new Error("chybí razítko začátku běhu (--od)");
  if (!REVIZE.test(String(sha ?? ""))) throw new Error(`revize '${sha}' není sha`);
  const seznam = Array.isArray(odpoved) ? odpoved : odpoved?.deployments;
  if (!Array.isArray(seznam)) throw new Error("odpověď Coolify nenese seznam nasazení");

  const poZacatku = seznam
    .filter((d) => vzniklo(d) >= od)
    .sort((a, b) => vzniklo(b) - vzniklo(a));

  const bezRevize = poZacatku.find((d) => !REVIZE.test(String(d?.commit ?? "")));
  if (bezRevize) {
    return {
      akce: "nejasne",
      uuid: String(bezRevize.deployment_uuid ?? ""),
      stav: String(bezRevize.status ?? ""),
      detail: `nasazení po začátku běhu bez revize (commit='${bezRevize.commit ?? ""}') — nelze rozhodnout, čí je`,
    };
  }
  const cizi = poZacatku.find((d) => String(d.commit) !== sha);
  if (cizi) {
    return {
      akce: "cizi_sha",
      uuid: String(cizi.deployment_uuid ?? ""),
      stav: String(cizi.status ?? ""),
      detail: `během nasazení bylo sloučeno: ${String(cizi.commit)}`,
    };
  }

  const posledni = poZacatku[0];
  if (!posledni) return { akce: "nasadit", uuid: "", stav: "", detail: "v tomto běhu nenasazeno" };
  const stav = String(posledni.status ?? "");
  const uuid = String(posledni.deployment_uuid ?? "");
  if (!uuid) return { akce: "nejasne", uuid: "", stav, detail: "nasazení bez deployment_uuid" };
  if (BEZI.has(stav)) return { akce: "navazat", uuid, stav, detail: "nasazení tohoto běhu ještě běží" };
  if (HOTOVO.has(stav)) return { akce: "overit", uuid, stav, detail: "nasazení tohoto běhu doběhlo" };
  if (SPADLO.has(stav)) return { akce: "nasadit", uuid, stav, detail: `nasazení tohoto běhu skončilo '${stav}'` };
  return { akce: "nejasne", uuid, stav, detail: `neznámý stav nasazení '${stav}'` };
}

if (isDirectRun(import.meta.url)) {
  const arg = (jmeno) => {
    const i = process.argv.indexOf(jmeno);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  let vstup = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (vstup += d));
  process.stdin.on("end", () => {
    try {
      const v = vyberNavazani(JSON.parse(vstup), { od: Number(arg("--od")), sha: arg("--sha") });
      process.stdout.write([v.akce, v.uuid, v.stav, v.detail].join("\t") + "\n");
    } catch (e) {
      process.stderr.write(`nasazeni-navazani: ${e.message}\n`);
      process.exit(2);
    }
  });
}
