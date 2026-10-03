#!/usr/bin/env node
/**
 * audit-zona-ve-jmene — ZÓNA VE JMÉNĚ PROMĚNNÉ MUSÍ ODPOVÍDAT ZÓNĚ V HODNOTĚ.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-27 na vyrenderovaném .env.coolify).
 *
 * Repo si tohle pravidlo už jednou zapsalo — po incidentu, kdy `*_MESH`
 * proměnné nesly při vypnuté meshi adresu NEMESHOVOU
 * (docs/deploy/MESH-NEBYLA-POUZIVANA-2026-08-26.md):
 *
 *   „Proměnná jménem `*_MESH` musí nést meshovou adresu, nebo NEEXISTOVAT.
 *    Nikdy jinou zónu pod meshovým jménem."
 *
 * Zapsané pravidlo bez měřidla ale vydrží přesně do příště. Při hledání
 * příčiny pozastaveného ACME účtu se našel týž tvar v OPAČNÉM směru:
 *
 *   API_UPSTREAM_PUBLIC=https://<prefix>-api.mesh.<instance>.internal
 *   EXTRANET_UPSTREAM_PUBLIC=https://<prefix>-extra.mesh.<instance>.internal
 *
 * Proměnná jménem `_PUBLIC` nesoucí MESHOVOU adresu. Konzument nemá jak poznat
 * rozdíl: jméno slibuje zónu, obsah je z jiné. Nic nespadne — jen se provoz
 * pokusí jít cestou, která pro danou roli neexistuje.
 *
 * Táž třída stojí i za registrací `.internal` jmen jako Coolify domén: bare
 * `<X>_DOMAIN` je pod `MESH_ENABLED=true` meshové, ale konzumuje ho MIMO jiné
 * registrace u veřejného Traefiku. Jedno jméno, dvě roviny, opačné správné
 * odpovědi. Ručně vyřezaná výjimka pro `pki-bridge` v derive-domains.mjs je
 * první místo, kde to bolelo — tenhle audit ukazuje, kolik jich je celkem.
 *
 * MĚŘÍ SE VYRENDEROVANÝ VÝSTUP, ne zdroj. Zóna vzniká až dosazením, takže
 * ve zdroji (`${API_DOMAIN}`) není co porovnávat — vada je vidět jedině na
 * hodnotách, které z derivace opravdu vypadly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KOREN = join_(fileURLToPath(new URL(".", import.meta.url)), "..");
function join_(a, b) { return resolve(a, b); }

const soubor = process.argv[2] ? resolve(process.argv[2]) : join_(KOREN, ".env.coolify");

let text;
try {
  text = readFileSync(soubor, "utf8");
} catch (e) {
  // ⛔ Fail-closed: audit, který na svůj vstup nedosáhne, NESMÍ hlásit „čisto".
  console.error(`❌ nelze číst ${soubor}: ${e.code ?? e.message}`);
  console.error(`   Vyrenderuj env (render-env / cold-start) nebo zadej cestu argumentem.`);
  process.exit(2);
}

/** Načte KEY=VALUE; komentáře a prázdné řádky ignoruje. */
function nactiEnv(t) {
  const m = new Map();
  for (const radek of t.split("\n")) {
    const r = radek.trim();
    if (!r || r.startsWith("#")) continue;
    const i = r.indexOf("=");
    if (i <= 0) continue;
    m.set(r.slice(0, i), r.slice(i + 1));
  }
  return m;
}

const env = nactiEnv(text);

// ⛔ Zóny se NEHÁDAJÍ z tvaru jména — čtou se z deklarace v témže souboru.
// Kdyby se odvozovaly heuristikou, audit by u jiné instance měřil něco jiného
// než co ta instance deklaruje, a jeho verdikt by neznamenal nic.
const MESH_TLD = env.get("MESH_TLD");
const PUBLIC_TLD = env.get("PUBLIC_TLD");
const INTERNAL_TLD = env.get("INTERNAL_TLD");
if (!MESH_TLD || !PUBLIC_TLD || !INTERNAL_TLD) {
  console.error("❌ v env chybí deklarace zón (MESH_TLD / PUBLIC_TLD / INTERNAL_TLD).");
  console.error("   Bez nich nelze rozhodnout, do které zóny hodnota patří — odmítám hádat.");
  process.exit(2);
}

/** Vytáhne hostitele z hodnoty (URL i holé jméno, s portem i bez). */
function hostitele(hodnota) {
  const out = [];
  for (const kus of String(hodnota).split(/[,;\s]+/)) {
    if (!kus) continue;
    const bezSchematu = kus.replace(/^[a-z0-9+.-]+:\/\//i, "");
    const host = bezSchematu.split("/")[0].split("@").pop().replace(/:\d+$/, "");
    if (!host || !host.includes(".")) continue;      // krátká docker jména nemají zónu
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;  // IP adresa není zóna
    if (/\$\{/.test(host)) continue;                  // nedosazená proměnná
    out.push(host.toLowerCase());
  }
  return out;
}

function zona(host) {
  if (host.endsWith(MESH_TLD)) return "mesh";
  if (host.endsWith(PUBLIC_TLD)) return "public";
  if (host.endsWith(INTERNAL_TLD)) return "internal";
  return "jina";
}

// Token ve jméně → zóna, kterou jméno SLIBUJE.
// `INTERNAL` se záměrně nehlídá: v tomhle repu znamená hned dvě věci
// (vnitřní zóna vs. „uvnitř clusteru", např. KEYCLOAK_INTERNAL_URL=http://<kontejner>),
// takže by pravidlo hlásilo šum. Hlídá se jen to, co je jednoznačné.
const SLIB = [
  { token: "MESH", musi: (z) => z === "mesh", popis: "meshovou adresu" },
  { token: "PUBLIC", musi: (z) => z !== "mesh", popis: "adresu MIMO mesh" },
  { token: "DIRECT", musi: (z) => z !== "mesh", popis: "adresu MIMO mesh (mesh-nezávislou)" },
];

const nalezy = [];
for (const [klic, hodnota] of env) {
  if (!hodnota) continue;
  // Deklarace zón samy sebou nejsou porušením — definují měřítko.
  if (klic === "MESH_TLD" || klic === "PUBLIC_TLD" || klic === "INTERNAL_TLD") continue;
  // ⛔ SMĚROVACÍ TABULKA NENÍ ADRESA. `*_MESH_INGRESS_ROUTES` nese trojice
  // port|Host|cíl — a `Host`, na který mesh-ingress matchuje, je ZÁMĚRNĚ jméno
  // té zóny, pod kterou volající službu oslovuje. Hlásit to znamená nutit
  // k „opravě", která by tabulku rozešla s tím, co po drátě opravdu chodí.
  // Naměřeno při prvním běhu: bez téhle výjimky 40 z 61 nálezů byl šum.
  if (/_(INGRESS_)?ROUTES$/.test(klic)) continue;
  const tokeny = klic.split(/[_-]/);
  for (const pravidlo of SLIB) {
    if (!tokeny.includes(pravidlo.token)) continue;
    for (const host of hostitele(hodnota)) {
      const z = zona(host);
      if (pravidlo.musi(z)) continue;
      nalezy.push({ klic, host, zona: z, slib: pravidlo.token, popis: pravidlo.popis });
    }
  }
}

if (nalezy.length === 0) {
  console.log(`✅ zóna ve jméně odpovídá zóně v hodnotě (${env.size} proměnných v ${soubor.split("/").pop()})`);
  process.exit(0);
}

console.error(`❌ jméno slibuje jinou zónu, než hodnota nese — ${nalezy.length} nález(ů):\n`);
for (const n of nalezy) {
  console.error(`  ${n.klic}`);
  console.error(`      jméno obsahuje '${n.slib}' → má nést ${n.popis}`);
  console.error(`      hodnota je ze zóny '${n.zona}': ${n.host}`);
}
console.error(`\n  Oprav BUĎ hodnotu (vydat adresu slibované zóny), NEBO jméno`);
console.error(`  (pojmenovat proměnnou podle zóny, kterou opravdu nese).`);
console.error(`  Nikdy ne třetí cestou — mlčky nechat jméno lhát.`);
process.exit(1);
