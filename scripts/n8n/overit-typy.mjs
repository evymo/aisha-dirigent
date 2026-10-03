#!/usr/bin/env node
/**
 * overit-typy.mjs — zná běžící n8n všechny typy uzlů a pověření, na které
 * odkazují workflowy z n8n/workflows/?
 *
 * ⛔ NAMĚŘENO 2026-09-17 (guru): n8n 1.79.0 neznal ani jeden typ `aisha*`.
 * Balíček n8n-nodes-aisha do n8n nikdo nedoručoval, a když se doručil, jeho
 * uzly padaly v konstruktoru (`NodeConnectionTypes` v n8n-workflow 1.78 není).
 * Obojí se projevilo až za běhu — tisíce chyb „Credentials not found“ za den,
 * zatímco nasazení hlásilo úspěch. Build balíčku prošel, protože se kompiloval
 * proti novějšímu n8n-workflow, než jaký nese nasazený obraz.
 *
 * Měří se tedy PROTI BĚŽÍCÍMU n8n: `/types/nodes.json` a `/types/credentials.json`
 * jsou statické seznamy editoru, bez přihlášení, na interní adrese n8n.
 *
 * Použití: N8N_REST_URL=http://<n8n>:5678 node scripts/n8n/overit-typy.mjs
 * Kód: 0 = vše známé · 1 = něco chybí nebo seznam nešel přečíst.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { porovnej } from "../lib/razeni.mjs";

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "n8n", "workflows");

/** Typy uzlů a pověření, na které workflowy odkazují → Map(typ → Set(workflow)). */
export function odkazovaneTypy(workflows) {
  const uzly = new Map();
  const povereni = new Map();
  const pridej = (mapa, typ, wf) => {
    if (!mapa.has(typ)) mapa.set(typ, new Set());
    mapa.get(typ).add(wf);
  };
  for (const { nazev, data } of workflows) {
    for (const uzel of data.nodes ?? []) {
      if (uzel.type) pridej(uzly, uzel.type, nazev);
      for (const typ of Object.keys(uzel.credentials ?? {})) pridej(povereni, typ, nazev);
    }
  }
  return { uzly, povereni };
}

/** Co z odkazovaného běžící n8n nezná. Seznamy n8n: pole objektů s `name`. */
export function chybejiciTypy({ odkazovane, znameUzly, znamaPovereni }) {
  const uzly = new Set(znameUzly.map((t) => t.name));
  const povereni = new Set(znamaPovereni.map((t) => t.name));
  const vypis = (mapa, zname) =>
    [...mapa.entries()]
      .filter(([typ]) => !zname.has(typ))
      .map(([typ, wf]) => ({ typ, workflowy: [...wf].sort() }))
      .sort((a, b) => porovnej(a.typ, b.typ));
  return { uzly: vypis(odkazovane.uzly, uzly), povereni: vypis(odkazovane.povereni, povereni) };
}

/**
 * Seznam typů z běžícího n8n — s čekáním.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru): init startoval 11 s po n8n, n8n už hlásil
 * healthy, ale `/types/nodes.json` vrátil 404 (155 B) — statické soubory typů si
 * n8n generuje až po startu. O minutu později tentýž dotaz vrátil 200 (13 MB).
 * „Healthy" tedy neznamená „typy hotové": čeká se na platný seznam, a když do
 * limitu nedorazí, je to selhání MĚŘENÍ s počtem pokusů, ne tiché prázdno.
 */
export async function nactiSeznamTypu(url, { pokusu = 40, pauzaMs = 3000 } = {}) {
  let posledni = "";
  for (let i = 1; i <= pokusu; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      let data = null;
      let vadaJson = "";
      try {
        data = JSON.parse(text);
      } catch (e) {
        vadaJson = `odpověď není JSON (${e.name})`;
      }
      if (res.ok && Array.isArray(data)) return data;
      posledni = `HTTP ${res.status}, ${vadaJson || (Array.isArray(data) ? "seznam" : "JSON, ale ne seznam")} (${text.length} B)`;
    } catch (e) {
      posledni = `${e?.cause?.code ?? e?.name ?? "chyba"}`;
    }
    if (i < pokusu) await new Promise((r) => setTimeout(r, pauzaMs));
  }
  throw new Error(`${url} → po ${pokusu} pokusech stále bez seznamu typů (naposledy ${posledni})`);
}

if (isDirectRun(import.meta.url)) {
  const zaklad = String(process.env.N8N_REST_URL ?? "").replace(/\/+$/, "");
  if (!zaklad) {
    console.error("[n8n-typy] N8N_REST_URL chybí — není proti čemu měřit");
    process.exit(1);
  }
  try {
    const workflows = readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => ({ nazev: f.replace(/\.json$/, ""), data: JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8")) }));
    const odkazovane = odkazovaneTypy(workflows);
    const [znameUzly, znamaPovereni] = await Promise.all([
      nactiSeznamTypu(`${zaklad}/types/nodes.json`),
      nactiSeznamTypu(`${zaklad}/types/credentials.json`),
    ]);
    const chybi = chybejiciTypy({ odkazovane, znameUzly, znamaPovereni });
    for (const { typ, workflowy } of chybi.uzly) console.error(`❌ uzel ${typ} — n8n ho nezná (${workflowy.length} workflowů: ${workflowy.slice(0, 5).join(", ")})`);
    for (const { typ, workflowy } of chybi.povereni) console.error(`❌ pověření ${typ} — n8n ho nezná (${workflowy.length} workflowů: ${workflowy.slice(0, 5).join(", ")})`);
    console.log(
      `[n8n-typy] odkazováno ${odkazovane.uzly.size} typů uzlů a ${odkazovane.povereni.size} typů pověření; ` +
        `n8n nezná ${chybi.uzly.length} uzlů a ${chybi.povereni.length} pověření`,
    );
    process.exit(chybi.uzly.length || chybi.povereni.length ? 1 : 0);
  } catch (e) {
    console.error(`[n8n-typy] MĚŘENÍ SELHALO: ${e.message}`);
    process.exit(1);
  }
}
