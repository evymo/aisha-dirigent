#!/usr/bin/env node
/**
 * obraz-jde-stahnout.mjs — dá se KAŽDÝ připnutý obraz stáhnout z veřejného zdroje?
 *
 * ⛔ PROČ (naměřeno):
 *   2026-09-11  Docker Hub smazal repozitáře minio/minio a minio/mc → 12 h výpadek core.
 *   2026-09-24  quay.io/minio/* přestal vydávat: anonymní token se VYDÁ, manifest
 *               i s ním → 401. Nasazení prošla jen díky lokálním kopiím na hostech.
 * V repu se přitom NIC nezměnilo — obraz zmizel ze světa. Tvar odkazu hlídají jiné
 * brány (no-latest-images, registry-proxy-obraz-ma-repozitar); to, že obraz EXISTUJE,
 * nehlídalo nic. Proto tahle kontrola běží i pravidelně, ne jen při změně pinů.
 *
 * CO SE MĚŘÍ — co se SKUTEČNĚ stahuje, ze čtyř míst:
 *   1. piny `config/image-versions.env` (IMAGE_*=…)
 *   2. compose `docker-compose*.yml`: `image:` s literálem + `FROM` v dockerfile_inline
 *   3. Dockerfile, které compose STAVÍ (`build:` context + dockerfile + args) —
 *      kdekoli ve stromu, s argumenty TOHO buildu (jeden Dockerfile staví víc
 *      základů: netbird-runtime → management/signal/relay)
 *   4. kořenové `Dockerfile*`, které žádný compose nestaví: `FROM`
 * ⛔ Jen piny nestačily (2026-09-25): `IMAGE_ELEMENT_CALL=…:v0.10.4` byl MRTVÝ pin,
 * compose staví inline `FROM …element-call:v0.20.1` — měřila se deklarace, kterou
 * nikdo nestahuje, a skutečný obraz ne.
 * ⛔ Jen kořen nestačil (2026-09-27): Dockerfile v podadresářích (services/*, infra/*,
 * deploy/*, images/*) staví nasazení taky — `clamav/clamav`, `pgvector/pgvector:pg${PG_MAJOR}`
 * nebo `nginx:alpine` neměřilo nic. A `FROM ${ARG}` se přeskakoval, i když ARG má
 * výchozí hodnotu nebo ji dodá compose — tak se verze drží i u obrazů stavěných ze zdroje.
 * `${REGISTRY_PROXY}` se odstraní: každý fork musí fungovat i BEZ naší cache —
 * měří se veřejný originál. `${…}` ve `FROM` se dosadí (args buildu z compose →
 * výchozí `ARG` → hodnoty z image-versions.env); co dosadit nejde, je NEZMĚŘENO
 * s důvodem, ne tiché přeskočení. Přeskočí se aliasy stage (`FROM deps`),
 * `scratch` a tag `:local` (obraz staví compose, ne registr — výrobu hlídá brána
 * obraz-musi-nekdo-vyrobit).
 *
 * TŘI VÝSLEDKY, které se nesmí zaměnit:
 *   DOSTUPNÝ   manifest → 200 (případně po anonymním tokenu)
 *   CHYBÍ      404, nebo 401/403 i S anonymním tokenem (= neveřejný/smazaný)
 *   NEZMĚŘENO  síť, 5xx, nečekaná odpověď — výpadek sítě NENÍ „obraz zmizel"
 * Holé 401 bez tokenu je jen výzva k tokenu, ne nález.
 *
 * Použití:
 *   node scripts/registry/obraz-jde-stahnout.mjs [--soubor config/image-versions.env] [--jen-piny] [--json]
 * Spouští se z KOŘENE repa (čte docker-compose*.yml, kořenové Dockerfile* a Dockerfile,
 * které compose staví — řídký checkout workflow proto bere `Dockerfile*` v každé hloubce).
 * Návratové kódy: 0 vše dostupné · 1 aspoň jeden CHYBÍ · 2 nic nechybí, ale něco NEZMĚŘENO
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { odUvozovkuj } from "../lib/env-hodnota.mjs";

export const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

/** `IMAGE_X=hodnota` řádky → [{klic, obraz}] bez prefixu `${REGISTRY_PROXY…}`. */
export function piny(text) {
  const out = [];
  for (const radek of text.split("\n")) {
    const m = /^(IMAGE_[A-Z0-9_]+)=(.*)$/.exec(radek.trim());
    if (!m) continue;
    // Env soubor se čte jako bash (brána env-soubor-cte-jako-bash) — sdílený dekodér, ne odříznutí.
    const hodnota = odUvozovkuj(m[2].trim()).replace(/^\$\{REGISTRY_PROXY[^}]*\}/, "");
    if (!hodnota || hodnota.includes("${")) continue; // neúplný pin měří jiná brána
    out.push({ klic: m[1], obraz: hodnota });
  }
  return out;
}

/** Odkaz → měřitelný tvar, nebo null (ARG, lokální build, scratch). */
export function normalizujOdkaz(ref) {
  const r = odUvozovkuj(String(ref).trim()).replace(/^\$\{REGISTRY_PROXY[^}]*\}/, "");
  if (!r || r.includes("$") || r.toLowerCase() === "scratch") return null;
  if (/:local$/.test(r)) return null;
  return r;
}

/** `FROM` odkazy textu (Dockerfile nebo dockerfile_inline v compose) bez aliasů stage. */
export function odkazyFrom(text) {
  const aliasy = new Set();
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?\S+\s+AS\s+(\S+)/gim)) aliasy.add(m[1].toLowerCase());
  const out = [];
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
    if (aliasy.has(m[1].toLowerCase())) continue;
    const r = normalizujOdkaz(m[1]);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Dosadí `${X}`, `${X:-d}`, `${X-d}`, `${X:?m}`, `${X?m}` a `$X` z `promenne`.
 * `REGISTRY_PROXY` je vždy prázdné — měří se veřejný originál, ne naše cache.
 * @returns {{hodnota: string|null, chybi?: string}} `null` + jméno, když něco dosadit nejde
 */
export function dosad(text, promenne = {}) {
  const s = String(text);
  let out = "";
  let chybi;
  const hodnotaJmena = (k, op, vychozi) => {
    if (k === "REGISTRY_PROXY") return "";
    const v = promenne[k];
    const prazdne = v === undefined || v === null || (op?.startsWith(":") && v === "");
    if (!prazdne) return v;
    if (op === ":-" || op === "-") {
      const d = dosad(vychozi ?? "", promenne);
      if (d.hodnota !== null) return d.hodnota;
      chybi ??= d.chybi;
      return "";
    }
    chybi ??= k;
    return "";
  };
  // Skener, ne regulární výraz: výchozí hodnota smí obsahovat další `${…}`
  // (`${A:-${B}}`), a regex by skončil u první `}`.
  for (let i = 0; i < s.length; ) {
    if (s[i] !== "$") {
      out += s[i++];
      continue;
    }
    if (s[i + 1] === "{") {
      let hloubka = 1;
      let j = i + 2;
      for (; j < s.length && hloubka; j++) {
        if (s[j] === "{") hloubka++;
        else if (s[j] === "}") hloubka--;
      }
      if (hloubka) return { hodnota: null, chybi: chybi ?? "neuzavřené ${" };
      const vnitrek = s.slice(i + 2, j - 1);
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([\s\S]*))?$/.exec(vnitrek);
      i = j;
      if (!m) {
        chybi ??= vnitrek || "${}";
        continue;
      }
      out += hodnotaJmena(m[1], m[2], m[3]);
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i + 1));
    if (!m) {
      out += s[i++];
      continue;
    }
    i += 1 + m[0].length;
    out += hodnotaJmena(m[0]);
  }
  return chybi ? { hodnota: null, chybi } : { hodnota: out };
}

/**
 * Hodnoty `config/image-versions.env` (piny i ne-piny jako POSTGRES_MAJOR) pro
 * dosazení do compose args a `FROM`. Odkazy mezi nimi se dosadí v pořadí souboru.
 */
export function promenneZEnv(text) {
  const out = {};
  for (const radek of text.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek.trim());
    if (!m || m[1] === "REGISTRY_PROXY") continue;
    const d = dosad(odUvozovkuj(m[2].trim()), out);
    if (d.hodnota !== null) out[m[1]] = d.hodnota;
  }
  return out;
}

/**
 * Compose `build:` bloky → [{context, dockerfile, args}] (dockerfile_inline se
 * měří jinde). Bez parseru YAML: denní běh má řídký checkout bez závislostí a
 * build blok má pevný tvar (krátký `build: <cesta>`, nebo context/dockerfile/args
 * s mapou i seznamem `- KEY=value`).
 */
export function buildyZCompose(text) {
  const radky = text.split("\n");
  const out = [];
  for (let i = 0; i < radky.length; i++) {
    const m = /^(\s*)build:\s*(.*?)\s*$/.exec(radky[i]);
    if (!m) continue;
    const odsazeni = m[1].length;
    // YAML kotva `build: &jmeno` otevírá blok; alias `build: *jmeno` je týž build
    // znovu (měří se u kotvy), ne cesta.
    const kratky = m[2].replace(/\s+#.*$/, "").replace(/^&\S+\s*/, "");
    if (kratky.startsWith("*")) continue;
    if (kratky && kratky !== "|" && kratky !== ">") {
      out.push({ context: odUvozovkuj(kratky), dockerfile: "Dockerfile", args: {} });
      continue;
    }
    const b = { context: ".", dockerfile: "Dockerfile", args: {} };
    let inline = false;
    let argsOdsazeni = -1;
    for (let j = i + 1; j < radky.length; j++) {
      const l = radky[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const o = /^(\s*)/.exec(l)[1].length;
      if (o <= odsazeni) break;
      if (argsOdsazeni >= 0 && o > argsOdsazeni) {
        const kv = /^\s*-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*(.*)$/.exec(l);
        if (kv) b.args[kv[1]] = odUvozovkuj(kv[2].replace(/\s+#.*$/, "").trim());
        continue;
      }
      argsOdsazeni = -1;
      const kv = /^\s*([a-z_]+):\s*(.*?)\s*$/.exec(l);
      if (!kv) continue;
      const hodnota = odUvozovkuj(kv[2].replace(/\s+#.*$/, ""));
      if (kv[1] === "context") b.context = hodnota;
      else if (kv[1] === "dockerfile") b.dockerfile = hodnota;
      else if (kv[1] === "dockerfile_inline") inline = true;
      else if (kv[1] === "args") argsOdsazeni = o;
    }
    if (!inline) out.push(b);
  }
  return out;
}

/**
 * `FROM` Dockerfilu s dosazenými ARG: argumenty buildu přebíjí výchozí `ARG`
 * (jen globální, před prvním FROM — jiné FROM nevidí), ty se dosadí mezi sebou.
 * @returns {{obrazy: string[], nedosazene: {ref: string, chybi: string}[]}}
 */
export function obrazyZDockerfile(text, argsBuildu = {}) {
  const prvniFrom = text.search(/^\s*FROM\s/im);
  const hlavicka = prvniFrom >= 0 ? text.slice(0, prvniFrom) : text;
  const argy = {};
  for (const m of hlavicka.matchAll(/^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?\s*$/gm)) {
    if (Object.hasOwn(argsBuildu, m[1]) && argsBuildu[m[1]] !== undefined) {
      argy[m[1]] = argsBuildu[m[1]];
    } else if (m[2] !== undefined) {
      const d = dosad(odUvozovkuj(m[2].trim()), argy);
      if (d.hodnota !== null) argy[m[1]] = d.hodnota;
    }
  }
  const aliasy = new Set();
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?\S+\s+AS\s+(\S+)/gim)) aliasy.add(m[1].toLowerCase());
  const obrazy = [];
  const nedosazene = [];
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
    if (aliasy.has(m[1].toLowerCase())) continue;
    const d = dosad(m[1], argy);
    if (d.hodnota === null) {
      nedosazene.push({ ref: m[1], chybi: d.chybi });
      continue;
    }
    const r = normalizujOdkaz(d.hodnota);
    if (r && !aliasy.has(r.toLowerCase())) obrazy.push(r);
  }
  return { obrazy, nedosazene };
}

/** Compose: `image:` s literálem + `FROM` v dockerfile_inline. */
export function odkazyZCompose(text) {
  const out = [];
  for (const m of text.matchAll(/^\s*image:\s*["']?([^"'\s#]+)/gm)) {
    const r = normalizujOdkaz(m[1]);
    if (r) out.push(r);
  }
  return [...out, ...odkazyFrom(text)];
}

/** `repo[:tag][@digest]` → {registr, api, repo, ref}. Docker Hub = výchozí registr. */
export function rozeber(obraz) {
  let zbytek = obraz;
  let ref = "latest";
  const at = zbytek.indexOf("@");
  if (at >= 0) {
    ref = zbytek.slice(at + 1);
    zbytek = zbytek.slice(0, at);
  }
  // `jméno:tag@digest` (piny se digestem, docker/minio 2026-09-27): stahuje se
  // podle digestu, tag je jen popisek — ze jména repozitáře ale musí pryč, jinak
  // registr hledá repo `golang:1.24…` a vrátí 404 = falešné CHYBÍ.
  const dvojtecka = zbytek.lastIndexOf(":");
  if (dvojtecka > zbytek.lastIndexOf("/")) {
    if (at < 0) ref = zbytek.slice(dvojtecka + 1);
    zbytek = zbytek.slice(0, dvojtecka);
  }
  const casti = zbytek.split("/");
  const maRegistr = casti.length > 1 && /[.:]/.test(casti[0]) || casti[0] === "localhost";
  const registr = maRegistr ? casti.shift() : "docker.io";
  let repo = casti.join("/");
  if (registr === "docker.io" && !repo.includes("/")) repo = `library/${repo}`;
  const api = registr === "docker.io" ? "https://registry-1.docker.io" : `https://${registr}`;
  return { registr, api, repo, ref };
}

/** `Bearer realm="…",service="…",scope="…"` → objekt. */
export function vyzva(hlavicka) {
  if (!hlavicka || !/^Bearer\s/i.test(hlavicka)) return null;
  const out = {};
  for (const m of hlavicka.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out.realm ? out : null;
}

/**
 * Zeptá se registru na manifest. `fetchImpl` je injektovatelný kvůli testům.
 * @returns {Promise<{stav:"DOSTUPNÝ"|"CHYBÍ"|"NEZMĚŘENO", duvod:string}>}
 */
export async function zmer(obraz, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const { api, repo, ref } = rozeber(obraz);
  const url = `${api}/v2/${repo}/manifests/${ref}`;
  const dotaz = async (hlavicky = {}) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { method: "HEAD", headers: { Accept: ACCEPT, ...hlavicky }, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
  };
  let r;
  try {
    r = await dotaz();
  } catch (e) {
    return { stav: "NEZMĚŘENO", duvod: `síť: ${e?.name === "AbortError" ? "timeout" : e?.message ?? e}` };
  }
  if (r.status === 200) return { stav: "DOSTUPNÝ", duvod: "200 bez tokenu" };
  if (r.status === 404) return { stav: "CHYBÍ", duvod: "404 bez tokenu" };
  if (r.status !== 401) return nezmereno(r.status, "bez tokenu");

  const v = vyzva(r.headers.get("www-authenticate"));
  if (!v) return { stav: "NEZMĚŘENO", duvod: "401 bez použitelné výzvy Bearer" };
  const tokenUrl = new URL(v.realm);
  if (v.service) tokenUrl.searchParams.set("service", v.service);
  tokenUrl.searchParams.set("scope", v.scope ?? `repository:${repo}:pull`);
  let token;
  try {
    const tr = await fetchImpl(tokenUrl.toString());
    if (tr.status !== 200) {
      // Registr odmítl vydat ani anonymní token na pull → repozitář není veřejný.
      return tr.status === 401 || tr.status === 403
        ? { stav: "CHYBÍ", duvod: `anonymní token odmítnut (${tr.status})` }
        : nezmereno(tr.status, "token");
    }
    const telo = await tr.json();
    token = telo.token ?? telo.access_token;
  } catch (e) {
    return { stav: "NEZMĚŘENO", duvod: `token: ${e?.message ?? e}` };
  }
  if (!token) return { stav: "NEZMĚŘENO", duvod: "odpověď na token bez tokenu" };

  let r2;
  try {
    r2 = await dotaz({ Authorization: `Bearer ${token}` });
  } catch (e) {
    return { stav: "NEZMĚŘENO", duvod: `síť (s tokenem): ${e?.message ?? e}` };
  }
  if (r2.status === 200) return { stav: "DOSTUPNÝ", duvod: "200 s anonymním tokenem" };
  // 401/403 i S tokenem = neveřejné nebo smazané (quay.io/minio 2026-09-24); 404 = neexistuje.
  if (r2.status === 401 || r2.status === 403 || r2.status === 404) {
    return { stav: "CHYBÍ", duvod: `${r2.status} i s anonymním tokenem` };
  }
  return nezmereno(r2.status, "s tokenem");
}

function nezmereno(status, kde) {
  return { stav: "NEZMĚŘENO", duvod: `HTTP ${status} (${kde})` };
}

/**
 * Co se bude měřit — BEZ sítě, aby to šlo ověřit bránou i testem.
 * @param {string} soubor piny (relativně ke `koren`)
 * @param {{ jenPiny?: boolean, koren?: string }} [opts]
 * @returns {{ seznam: {klic: string, obraz: string}[], nemeritelne: {klic: string, obraz: string, stav: "NEZMĚŘENO", duvod: string}[] }}
 */
export function soupis(soubor = "config/image-versions.env", { jenPiny = false, koren = "." } = {}) {
  const cti = (f) => readFileSync(join(koren, f), "utf8");
  // Obraz → odkud (pin nebo soubory). Deduplikace: týž obraz se měří jednou.
  const odkud = new Map();
  const pridej = (obraz, zdroj) => odkud.set(obraz, [...(odkud.get(obraz) ?? []), zdroj]);
  // Co měřit nejde (ARG bez hodnoty, chybějící Dockerfile) — NEZMĚŘENO s důvodem, ne ticho.
  const nemeritelne = new Map();
  const nelze = (co, zdroj, duvod) => nemeritelne.set(`${zdroj}|${co}`, { klic: zdroj, obraz: co, stav: "NEZMĚŘENO", duvod });
  const envText = cti(soubor);
  for (const p of piny(envText)) pridej(p.obraz, p.klic);
  if (!jenPiny) {
    const promenne = promenneZEnv(envText);
    const stavene = new Set();
    for (const f of readdirSync(koren).filter((n) => /^docker-compose.*\.ya?ml$/.test(n)).sort()) {
      const text = cti(f);
      for (const o of odkazyZCompose(text)) pridej(o, f);
      for (const b of buildyZCompose(text)) {
        const cesta = normalize(join(b.context, b.dockerfile));
        stavene.add(cesta);
        if (!existsSync(join(koren, cesta))) {
          nelze(cesta, f, `build Dockerfile ${cesta} ve stromu není`);
          continue;
        }
        const args = {};
        for (const [k, v] of Object.entries(b.args)) args[k] = dosad(v, promenne).hodnota ?? undefined;
        const { obrazy, nedosazene } = obrazyZDockerfile(cti(cesta), args);
        for (const o of obrazy) pridej(o, cesta);
        for (const n of nedosazene) nelze(n.ref, `${f}→${cesta}`, `ARG ${n.chybi} bez hodnoty (compose args ani výchozí ARG)`);
      }
    }
    for (const f of readdirSync(koren).filter((n) => /^Dockerfile/.test(n) && !stavene.has(n)).sort()) {
      const { obrazy, nedosazene } = obrazyZDockerfile(cti(f));
      for (const o of obrazy) pridej(o, f);
      for (const n of nedosazene) nelze(n.ref, f, `ARG ${n.chybi} bez výchozí hodnoty`);
    }
  }
  const seznam = [...odkud].map(([obraz, zdroje]) => ({
    klic: [...new Set(zdroje)].slice(0, 2).join(",") + (new Set(zdroje).size > 2 ? `,+${new Set(zdroje).size - 2}` : ""),
    obraz,
    zdroje: [...new Set(zdroje)],
  }));
  return { seznam, nemeritelne: [...nemeritelne.values()] };
}

async function main(argv) {
  const i = argv.indexOf("--soubor");
  const soubor = i >= 0 ? argv[i + 1] : "config/image-versions.env";
  const json = argv.includes("--json");
  const { seznam, nemeritelne } = soupis(soubor, { jenPiny: argv.includes("--jen-piny") });
  if (!seznam.length) {
    console.error(`obraz-jde-stahnout: v ${soubor} není žádný pin IMAGE_* — neměřím prázdno jako úspěch`);
    return 2;
  }
  const vysledky = [...nemeritelne];
  for (const { klic, obraz } of seznam) vysledky.push({ klic, obraz, ...(await zmer(obraz)) });
  const chybi = vysledky.filter((v) => v.stav === "CHYBÍ");
  const nezmereno = vysledky.filter((v) => v.stav === "NEZMĚŘENO");
  if (json) {
    console.log(JSON.stringify({ vysledky, chybi: chybi.length, nezmereno: nezmereno.length }, null, 2));
  } else {
    for (const v of vysledky) console.log(`${v.stav.padEnd(9)} ${v.obraz.padEnd(62)} ${v.klic}  (${v.duvod})`);
    console.log(`\nSouhrn: ${vysledky.length} obrazů · dostupných ${vysledky.length - chybi.length - nezmereno.length} · CHYBÍ ${chybi.length} · NEZMĚŘENO ${nezmereno.length}`);
  }
  for (const v of chybi) {
    console.log(`::error title=obraz nejde stáhnout::${v.klic}=${v.obraz} — ${v.duvod}. Nasazení na hostu bez lokální kopie spadne; oprav pin nebo zdroj.`);
  }
  for (const v of nezmereno) console.log(`::warning title=obraz NEZMĚŘEN::${v.klic}=${v.obraz} — ${v.duvod}`);
  return chybi.length ? 1 : nezmereno.length ? 2 : 0;
}

if (isDirectRun(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (kod) => process.exit(kod),
    (e) => {
      console.error(`obraz-jde-stahnout: ${e?.stack ?? e}`);
      process.exit(2);
    },
  );
}
