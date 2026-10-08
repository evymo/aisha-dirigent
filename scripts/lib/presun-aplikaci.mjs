#!/usr/bin/env node
/**
 * presun-aplikaci.mjs — aplikace běží na jiném serveru, než deklaruje manifest. Co teď?
 *
 * Změna umístění (přepis v profilu → manifest `app: <id>:<slot>:…`) se u EXISTUJÍCÍ
 * aplikace nikam nepromítne: Coolify server aplikace mění jen při založení
 * (coolify-story-init.sh), u existující se porovnává jen git a compose. Bez této
 * kontroly by konvergence proběhla „zeleně“ a aplikace dál běžela na starém
 * serveru — přesun by se tiše nestal. Drift-check to umí najít (`serverDrift`),
 * ale běžel jen v hlídce, ne v kroku 0.
 *
 * Verdikt (kontrakt d8 U3, rozhodnutí integrátora 10-05):
 *   · držená aplikace (deklarace instance, lib/nasazeni-drzene.mjs) → DRŽENO,
 *     nic se nehýbe, pokračuje se. Přesun čeká na uvolnění z deklarace.
 *   · ostatní → STOP (kód 1) s pojmenovanou cestou: přesun = `--rewarmup=<aplikace>`.
 *     Ta aplikaci smaže i se svazky na starém serveru a založí ji na novém —
 *     vědomý krok operátora, ne vedlejší účinek konvergence.
 *   · server, který drift-check nezměřil (`serverUnmeasured`) → NEZMĚŘENO (2).
 *
 * Nic nezapisuje: čte drift (JSON z coolify-drift-check.mjs --json) a deklaraci držení.
 * Kód 0 = žádný přesun nečeká (nebo jen držené) · 1 = přesun čeká → STOP · 2 = NEZMĚŘENO.
 *
 * CLI: node scripts/lib/presun-aplikaci.mjs --manifest <soubor> [--env-soubor <soubor>]
 *   Drift-check se pouští s týmž manifestem; prostředí (COOLIFY_*, UUID slotů) dědí.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { drzeniInstance } from "./nasazeni-drzene.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Story manifestu (`story: <jméno>`) — prefix jmen aplikací v Coolify. */
export function storyManifestu(text) {
  const m = /^story:\s*(\S+)\s*$/m.exec(String(text));
  return m ? m[1] : null;
}

/**
 * @param {{ serverDrift?: object[], serverUnmeasured?: object[] }} drift výstup drift-checku
 * @param {{ story: string, drzene: { aplikace: string }[] }} kontext
 * @returns {{ kod: 0|1|2, aplikace: string, zprava: string }[]}
 */
export function verdiktyPresunu(drift, { story, drzene, planovanyWipe = false, planovanyRewarmup = [] }) {
  const drzena = new Map(drzene.map((p) => [p.aplikace, p]));
  const prestavi = new Set(planovanyRewarmup);
  const role = (jmeno) => (String(jmeno).startsWith(`${story}-`) ? String(jmeno).slice(story.length + 1) : String(jmeno));
  const out = [];
  for (const d of drift?.serverDrift ?? []) {
    const r = role(d.name);
    if (drzena.has(r)) {
      // Držení má přednost i před plánovanou operací: cold-start drženou aplikaci
      // ani nepřestaví (rewarmup držené = STOP v cold-startu), ani nesmaže (wipe ji přeskočí).
      out.push({
        kod: 0,
        aplikace: d.name,
        zprava: `DRŽENO: ${d.name} zůstává na serveru ${String(d.liveServer).slice(0, 12)}…, manifest deklaruje slot '${d.expectedHost}' — přesun čeká na uvolnění z deklarace držení`,
      });
    } else if (planovanyWipe || prestavi.has(d.name)) {
      // Jen CELÉ jméno aplikace, jako cold-start (revize accel-1, 2. kolo): holou roli
      // `--rewarmup=model` cold-start mezi aplikacemi nenajde, nic nesmaže a aplikace
      // zůstane, kde je — doktor by tichý nepřesun odemkl.
      out.push({
        kod: 0,
        aplikace: d.name,
        zprava: `PŘESUN: ${d.name} se přesune ${planovanyWipe ? "plánovaným wipem" : "plánovaným rewarmupem"} na slot '${d.expectedHost}' — operace ji založí znovu na deklarovaném serveru`,
      });
    } else {
      out.push({
        kod: 1,
        aplikace: d.name,
        zprava:
          `${d.name} běží na serveru ${String(d.liveServer).slice(0, 12)}…, manifest deklaruje slot '${d.expectedHost}' ` +
          `(${String(d.expectedServer).slice(0, 12)}…) — konvergence aplikaci NEPŘESUNE. ` +
          `Přesun = bash scripts/aisha-cold-start.sh --rewarmup=${d.name} (smaže ji i se svazky na starém serveru a založí na novém)`,
      });
    }
  }
  for (const n of drift?.serverUnmeasured ?? []) {
    out.push({ kod: 2, aplikace: n.name, zprava: `${n.name}: server NEZMĚŘEN (${n.reason})` });
  }
  return out;
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const hodnota = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = hodnota("--manifest");
  const planovanyWipe = argv.includes("--planovany-wipe");
  const planovanyRewarmup = String(hodnota("--planovany-rewarmup") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const envSoubor = hodnota("--env-soubor");
  const konec = (kod, zprava) => {
    console.error(`presun-aplikaci: ${zprava}`);
    process.exit(kod);
  };
  if (!manifest) konec(2, "chybí --manifest");
  let story;
  try {
    story = storyManifestu(readFileSync(manifest, "utf8"));
  } catch (e) {
    konec(2, `manifest nejde přečíst (${e.message}) — NEZMĚŘENO`);
  }
  if (!story) konec(2, `manifest ${manifest} nemá řádek 'story:' — jména aplikací neznám, NEZMĚŘENO`);

  let drzene;
  try {
    drzene = drzeniInstance("presun-aplikaci", { envSoubory: envSoubor ? [envSoubor] : [] }).polozky;
  } catch (e) {
    konec(2, `${e.message}`);
  }

  // Drift-check vrací 0 (bez driftu), 1 (fatální: orphaned/missing), 2 (compose/server
  // drift), 3 (nezměřeno). Pro přesun platí JEN serverDrift a serverUnmeasured; ostatní
  // nálezy hlásí drift-check sám jinde. Bez JSON na výstupu je to NEZMĚŘENO.
  const r = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/coolify-drift-check.mjs"), "--json", "--manifest", manifest], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  let drift;
  try {
    drift = JSON.parse(r.stdout);
  } catch (e) {
    console.error(`presun-aplikaci: výstup drift-checku není JSON (${e.message})`);
    konec(2, `drift-check nevydal JSON (kód ${r.status}): ${String(r.stderr).trim().split("\n").pop() ?? ""} — přesun NEZMĚŘEN`);
  }
  const verdikty = verdiktyPresunu(drift, { story, drzene, planovanyWipe, planovanyRewarmup });
  for (const v of verdikty) (v.kod === 0 ? console.log : console.error)(`${v.kod === 1 ? "STOP " : v.kod === 2 ? "NEZMĚŘENO " : ""}${v.zprava}`);
  // Jistý nález (STOP) má přednost před nezměřeným: hláška má jmenovat to, co víme.
  const kod = verdikty.some((v) => v.kod === 1) ? 1 : verdikty.some((v) => v.kod === 2) ? 2 : 0;
  if (verdikty.length === 0) console.log("přesun aplikací: žádná aplikace neběží jinde, než deklaruje manifest");
  process.exit(kod);
}
