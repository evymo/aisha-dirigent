#!/usr/bin/env node
/**
 * dvere-soulad.mjs — má instance dveře (svc-knock), a drží pohromadě všechno,
 * co z toho plyne? Jeden domov té otázky.
 *
 * ⛔ NAMĚŘENO 2026-09-15 (rozbor cesty cold-startu nad instancí s dveřmi).
 * O „zapnuto?" rozhodovala tři místa a každé jinak:
 *   · cold-start pouštěl `knock-provision.mjs` BEZ PODMÍNKY, takže roster
 *     (`SPA_OPERATORS_B64`) vznikl na každé instanci,
 *   · deploy-init zapínal profil `knock` podle ROSTERU, ne podle deklarace
 *     (a deklarace `EDGE_COMPOSE_PROFILES` vypínala `extranet-gate`),
 *   · derivace bez `knock.mode: live` vydala `SPA_DIAGNOSE=1` — a svc-knock
 *     s rosterem v měřicím režimu ODMÍTNE START.
 * Instance, která dveře nechtěla, je tedy dostala, a to v podobě, která
 * nenaběhne. Každé místo samo o sobě vypadalo rozumně; rozpor žil MEZI nimi.
 *
 * PRAVIDLO: dveře má instance, jejíž deklarace (`edge_profiles` v profilu
 * instance → derivace → `EDGE_COMPOSE_PROFILES`) jmenuje profil `knock`.
 * Nic jiného je nezapíná — ani roster, ani to, co zbylo na aplikaci.
 *
 * Čisté funkce níž odpovídají nad ČTENÁŘEM hodnot (`klíč → hodnota`), takže
 * tatáž odpověď platí pro soubor (`.env.coolify`) i pro aplikaci v Coolify.
 *
 * CLI:
 *   node dvere-soulad.mjs --coolify --prefix <p> --env-file <SoT> [--operator-file <.env-prod-backup>]
 *        → soulad dveří NA APLIKACI edge + kolize veřejných UDP portů s aplikacemi
 *          JINÝCH projektů na témž serveru (jen čtení Coolify API);
 *          0 = soulad, 1 = vady/kolize, 2 = NEMĚŘENO, 3 = bez nálezu, ale část nezměřena,
 *          4 = vady/kolize a mezi nimi ZAVŘENÝ EDGE BEZ DVEŘÍ (KOD_ZAVRENY_EDGE)
 *   node dvere-soulad.mjs --deklarovano [--env-file <soubor>]
 *        → 0 = dveře deklarované, 1 = nedeklarované, 2 = NEMĚŘENO
 *   node dvere-soulad.mjs --soulad [--env-file <soubor>] [--operator-file <.env-prod-backup>]
 *        → 0 = soulad, 1 = vady (vypsané), 2 = NEMĚŘENO,
 *          4 = vady a mezi nimi ZAVŘENÝ EDGE BEZ DVEŘÍ (KOD_ZAVRENY_EDGE)
 *   Bez `--env-file` se čte prostředí procesu (deploy-init si soubor načetl sám).
 *
 * ⛔ VERDIKT JE KÓD, NE TEXT. Výpis je výklad pro člověka a jeho věty se mění;
 * kdo potřebuje rozhodnout, čte návratový kód. NAMĚŘENO 2026-09-26: doktor
 * hledal ve výpisu řetězec `EDGE_DOOR_MODE=enforce` — jenže ten stojí i ve
 * VYSVĚTLENÍ vady KNOCK_UPSTREAM („s EDGE_DOOR_MODE=enforce by edge zamkl
 * všechny"), takže instance s režimem `off` dostala dva falešné FATALy.
 *
 * Hodnoty se nikdy nevypisují — jen jména klíčů a druh rozporu.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { parseEnvFile } from "./config-env-files.mjs";
import { serverIdOf } from "./fqdn-owners.mjs";
import { KLIC_DEKLARACE, KNOCK_ALIAS_PRIPONA, KNOCK_HTTP_PORT, PROFIL_DVERI, dvereDeklarovane, knockUpstream, profily } from "./dvere-deklarace.mjs";

// Deklarace dveří a adresa verdiktu bydlí v čistém modulu bez I/O (derivace ho
// načítá); tady se jen znovu vydávají, aby měl soulad jeden vstup.
export { KLIC_DEKLARACE, KNOCK_ALIAS_PRIPONA, KNOCK_HTTP_PORT, PROFIL_DVERI, dvereDeklarovane, knockUpstream, profily };

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Compose edge stacku — tam dveře bydlí. */
export const EDGE_COMPOSE = "docker-compose.coolify-prebuilt.yml";

const neprazdne = (v) => String(v ?? "").trim() !== "";

/**
 * Návratový kód CLI pro ZAVŘENÝ EDGE BEZ DVEŘÍ (`EDGE_DOOR_MODE=enforce` na
 * instanci, která dveře nedeklaruje). Nese ho strukturovaný příznak
 * `zavrenyEdgeBezDveri`, nikdy shoda textu — viz hlavička.
 */
export const KOD_ZAVRENY_EDGE = 4;

/** Je hodnota platný port (1–65535, jen číslice)? */
export function jePort(v) {
  const t = String(v ?? "").trim();
  return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= 65535;
}

/**
 * Rozpory dveří nad jednou sadou hodnot.
 *
 * @param {(klic: string) => string | undefined} cti  hodnoty stanoviště (soubor / aplikace)
 * @param {{ operator?: (klic: string) => string | undefined }} [volby]
 *   operator  deklarace operátora (`.env-prod-backup`) — když je po ruce, port
 *             stanoviště se s ní musí shodovat (jinak je to ozvěna starého literálu)
 * @returns {{ deklarovano: boolean, vady: string[], zavrenyEdgeBezDveri: boolean }}
 *   zavrenyEdgeBezDveri  strukturovaný příznak pro FATAL — edge v `enforce` bez
 *                        deklarovaných dveří; volající ho NEODVOZUJE z textu vad
 */
export function vadyDveri(cti, { operator } = {}) {
  const deklarovano = dvereDeklarovane(cti);
  const vady = [];
  const roster = neprazdne(cti("SPA_OPERATORS_B64"));
  const rosterZAdresy = neprazdne(cti("SPA_OPERATORS_URL"));
  const diagnose = String(cti("SPA_DIAGNOSE") ?? "").trim();
  const rezimEdge = String(cti("EDGE_DOOR_MODE") ?? "").trim();

  // ⛔ Zavřený edge bez vrátného. `enforce` pošle KAŽDÝ požadavek edge na
  // `forward_auth` do svc-knock — a ten na instanci bez deklarace neběží.
  // Edge to sice pozná jen u prázdného KNOCK_UPSTREAM; s neprázdným by zavřel
  // všechno i majiteli. Přepínač patří jen k deklarovaným dveřím.
  const zavrenyEdgeBezDveri = rezimEdge === "enforce" && !deklarovano;
  if (zavrenyEdgeBezDveri) {
    vady.push(
      "EDGE_DOOR_MODE=enforce, ale dveře NEJSOU deklarované — edge by se zavřel a verdikt by neměl kdo dát. " +
        "Buď deklaruj dveře v profilu instance (edge_profiles: [\"knock\"]), nebo EDGE_DOOR_MODE=off",
    );
  }

  if (deklarovano) {
    const prefix = String(cti("APP_NAME_PREFIX") ?? "").trim();
    const upstream = String(cti("KNOCK_UPSTREAM") ?? "").trim();
    if (!prefix) {
      vady.push("APP_NAME_PREFIX chybí — adresa dveří (KNOCK_UPSTREAM) nemá identitu instance");
    } else if (upstream !== knockUpstream(prefix)) {
      vady.push(
        `KNOCK_UPSTREAM nemíří na alias držitele s identitou instance (<prefix>-${KNOCK_ALIAS_PRIPONA}:${KNOCK_HTTP_PORT}) — ` +
          "vydává ho derivace; holé `svc-knock` ze staré výchozí hodnoty se v netns držitele nepřeloží " +
          "a s EDGE_DOOR_MODE=enforce by edge zamkl všechny",
      );
    }
    // ⛔ Port je RUČNÍ deklarace operátora (rozhodnutí majitele 2026-09-15), ne
    // literál: compose ho nese `${SPA_KNOCK_PUBLIC_PORT?…}` a prázdná hodnota při
    // zapnutém profilu by Dockeru dovolila publikovat NÁHODNÝ port — naměřeno,
    // `docker compose config` s prázdnou hodnotou vydá mapování bez `published`.
    const port = cti("SPA_KNOCK_PUBLIC_PORT");
    if (!jePort(port)) {
      vady.push(
        "SPA_KNOCK_PUBLIC_PORT chybí nebo není port — veřejný UDP port dveří je RUČNÍ deklarace operátora " +
          "(.env-prod-backup, forward na firewallu); s prázdnou hodnotou by Docker publikoval náhodný port",
      );
    } else if (operator) {
      const deklarovanyPort = String(operator("SPA_KNOCK_PUBLIC_PORT") ?? "").trim();
      if (deklarovanyPort === "") {
        vady.push(
          "SPA_KNOCK_PUBLIC_PORT není deklarovaný v .env-prod-backup — hodnota na stanovišti je ozvěna, " +
            "ne rozhodnutí operátora (dřív ji dosazoval literál)",
        );
      } else if (deklarovanyPort !== String(port).trim()) {
        vady.push("SPA_KNOCK_PUBLIC_PORT se liší od deklarace operátora v .env-prod-backup — nasadil by se jiný port, než na který míří forward");
      }
    }
    if (diagnose !== "0" && diagnose !== "1") {
      vady.push(
        `SPA_DIAGNOSE není 0 ani 1 — režim dveří vydává derivace z profilu instance (knock.mode); ` +
          `nedoručený režim svc-knock vyloží jako ostrý, nikdo o tom nerozhodl`,
      );
    } else if (diagnose === "1" && (roster || rosterZAdresy)) {
      vady.push(
        "SPA_DIAGNOSE=1 (měřicí režim) a zároveň roster operátorů — svc-knock takový start ODMÍTNE " +
          "(configDefects) a stáhne s sebou edge. Rozhodni v profilu instance: knock.mode: live, " +
          "nebo roster odeber",
      );
    } else if (diagnose === "0" && !roster && !rosterZAdresy) {
      vady.push(
        "SPA_DIAGNOSE=0 (ostrý režim) bez rosteru operátorů — fail-closed svc-knock NENASTARTUJE. " +
          "Roster založí: node scripts/knock-provision.mjs",
      );
    }
  }

  return { deklarovano, vady, zavrenyEdgeBezDveri };
}

/** Čtenář nad souborem; prázdné klíče zůstávají (rozdíl „chybí" × „prázdné"). */
export function ctenarSouboru(cesta) {
  if (!existsSync(cesta)) throw new Error(`env soubor ${cesta} neexistuje — není proti čemu měřit`);
  const hodnoty = parseEnvFile(cesta, { keepTemplates: true, keepEmpty: true });
  return (k) => hodnoty[k];
}

// ── Na aplikaci a na serveru ─────────────────────────────────────────────────

/**
 * Interpolace compose hodnoty nad čtenářem — `$$`, `${X}`, `${X:-d}`, `${X-d}`,
 * `${X:?m}`, `${X?m}`, `$X`. Povinná proměnná bez hodnoty = výjimka (compose by
 * taky spadl; měřit nad tím nejde).
 */
export function interpoluj(text, cti) {
  return String(text).replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)([-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (cele, jmeno, dvojtecka, op, arg, holy) => {
    if (cele === "$$") return "$";
    if (holy) return String(cti(holy) ?? "");
    const v = cti(jmeno);
    const chybi = v === undefined || (dvojtecka === ":" && String(v) === "");
    if (op === "-") return chybi ? arg : String(v);
    if (op === "?") {
      if (chybi) throw new Error(`povinná ${jmeno} bez hodnoty`);
      return String(v);
    }
    if (op === "+") return chybi ? "" : arg;
    return String(v ?? "");
  });
}

/** `"a-b"` / `"a"` → [od, do], jinak null. */
function rozsah(t) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(t).trim());
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}

/**
 * Publikované UDP porty compose dokumentu nad hodnotami aplikace.
 * Služba za profilem se počítá, jen když ji `COMPOSE_PROFILES` aplikace zapíná.
 * Port bez hostitelské strany (efemérní) se nepočítá — o ten se nikdo nepře.
 *
 * @returns {{ sluzba: string, od: number, do: number }[]}
 */
export function udpPortyCompose(text, cti) {
  const { parse } = createRequire(import.meta.url)(join(REPO_ROOT, "node_modules/yaml/dist/index.js"));
  const dok = parse(text);
  const zapnute = new Set(profily(cti("COMPOSE_PROFILES")));
  const out = [];
  for (const [sluzba, s] of Object.entries(dok?.services ?? {})) {
    const prof = Array.isArray(s?.profiles) ? s.profiles : [];
    if (prof.length && !prof.some((p) => zapnute.has(p))) continue;
    for (const p of s?.ports ?? []) {
      let host = null;
      if (typeof p === "string") {
        // Protokol se pozná ze ZÁPISU, dřív než se interpoluje: TCP mapování
        // s povinnou proměnnou, kterou aplikace nemá, by jinak shodilo měření UDP.
        if (!/\/udp$/.test(p)) continue;
        const hodnota = interpoluj(p, cti);
        const casti = hodnota.replace(/\/udp$/, "").split(":");
        if (casti.length < 2) continue;
        host = rozsah(casti[casti.length - 2]);
        if (!host) throw new Error(`${sluzba}: hostitelská strana UDP portu není port ("${casti[casti.length - 2]}")`);
      } else if (p && typeof p === "object" && p.protocol === "udp" && p.published !== undefined) {
        host = rozsah(interpoluj(String(p.published), cti));
      }
      if (host) out.push({ sluzba, od: host[0], do: host[1] });
    }
  }
  return out;
}

/** `ports_mappings` ne-compose aplikace („8080:80,5000:5000/udp") → UDP porty. */
export function udpPortyMapovani(mapovani) {
  const out = [];
  for (const kus of String(mapovani ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!/\/udp$/.test(kus)) continue;
    const casti = kus.replace(/\/udp$/, "").split(":");
    const host = casti.length >= 2 ? rozsah(casti[casti.length - 2]) : null;
    if (host) out.push({ sluzba: "ports_mappings", od: host[0], do: host[1] });
  }
  return out;
}

/**
 * Změří dveře NA APLIKACI a veřejné UDP porty instance proti cizím projektům.
 * Jen čtení Coolify API. Hodnoty envů se nevracejí — jen jména a čísla portů.
 *
 * @param {{ coolify: (path: string) => Promise<any>, inProject: (app: any) => boolean,
 *   prefix: string, sot: (k: string) => string | undefined,
 *   operator?: (k: string) => string | undefined, koren?: string }} vstup
 * @returns {Promise<{ deklarovano: boolean, edge: string | null, vady: string[], kolize: string[], nezmereno: string[],
 *   zavrenyEdgeBezDveri: boolean }>}
 */
export async function zmerDvereNaAplikaci({ coolify, inProject, prefix, sot, operator, koren = REPO_ROOT }) {
  const deklarovano = dvereDeklarovane(sot);
  const vysledek = { deklarovano, edge: null, vady: [], kolize: [], nezmereno: [], zavrenyEdgeBezDveri: false };
  // Co nasazení z envů aplikace UVIDÍ, určuje jeden domov (povinne-promenne);
  // import až tady — derivace tenhle modul načítá a parser compose nepotřebuje.
  const { hodnotyZCoolifyEnvs } = await import("./povinne-promenne.mjs");
  const vsechny = await coolify("/applications");
  if (!Array.isArray(vsechny)) throw new Error("výpis aplikací není pole — Coolify ho nevydal");
  const nase = vsechny.filter((a) => inProject(a) && String(a?.name ?? "").startsWith(`${prefix}-`));
  const compose = (a) => String(a?.docker_compose_location ?? "").replace(/^\/+/, "");
  const envyCache = new Map();
  const envy = async (a) => {
    if (!envyCache.has(a.uuid)) envyCache.set(a.uuid, hodnotyZCoolifyEnvs(await coolify(`/applications/${a.uuid}/envs`)));
    return envyCache.get(a.uuid);
  };

  // 1. Soulad dveří na aplikaci edge. Deklarace je SoT (aplikace klíč nemá —
  //    compose ho nečte), hodnoty jsou ty, které nasazení UVIDÍ.
  const edge = nase.find((a) => compose(a) === EDGE_COMPOSE) ?? null;
  if (!edge) {
    if (deklarovano) vysledek.vady.push(`dveře deklarované, ale aplikace s ${EDGE_COMPOSE} v projektu instance NENÍ`);
  } else {
    vysledek.edge = edge.name;
    try {
      const e = await envy(edge);
      const naAplikaci = profily(e.get("COMPOSE_PROFILES")).includes(PROFIL_DVERI);
      if (deklarovano && !naAplikaci) {
        vysledek.vady.push(`${edge.name}: dveře deklarované, ale COMPOSE_PROFILES aplikace „${PROFIL_DVERI}“ nemá — nasazení je nespustí (sync: coolify-sync-envs.sh)`);
      }
      if (!deklarovano && naAplikaci) {
        vysledek.vady.push(`${edge.name}: COMPOSE_PROFILES aplikace drží „${PROFIL_DVERI}“, ale instance dveře NEDEKLARUJE — starý profil (sync ho odebere)`);
      }
      const cti = (k) => (k === KLIC_DEKLARACE ? sot(k) : e.get(k));
      const naEdge = vadyDveri(cti, { operator });
      for (const v of naEdge.vady) vysledek.vady.push(`${edge.name}: ${v}`);
      vysledek.zavrenyEdgeBezDveri = naEdge.zavrenyEdgeBezDveri;
    } catch (err) {
      vysledek.nezmereno.push(`${edge.name}: envy (${String(err.message).split("\n")[0]})`);
    }
  }

  // 2. Veřejné UDP porty NAŠICH aplikací (compose z tohoto stromu, hodnoty z aplikace).
  const nasePorty = [];
  for (const a of nase) {
    const soubor = compose(a);
    if (!soubor || !existsSync(join(koren, soubor))) continue;
    const text = readFileSync(join(koren, soubor), "utf8");
    if (!/\/udp/.test(text)) continue;
    try {
      const e = await envy(a);
      for (const p of udpPortyCompose(text, (k) => e.get(k))) nasePorty.push({ ...p, app: a.name, server: serverIdOf(a) });
    } catch (err) {
      vysledek.nezmereno.push(`${a.name}: UDP porty (${String(err.message).split("\n")[0]})`);
    }
  }

  // 3. Cizí projekty na TÉMŽE serveru — compose, který Coolify drží, nad jejich envy.
  const servery = new Set(nasePorty.map((p) => String(p.server)));
  if (nasePorty.length) {
    for (const a of vsechny) {
      if (!a?.uuid || inProject(a)) continue;
      const s = serverIdOf(a);
      if (s != null && !servery.has(String(s))) continue;
      let cizi = [];
      try {
        if (a.build_pack === "dockercompose") {
          const raw = a.docker_compose_raw ?? a.docker_compose;
          if (typeof raw !== "string" || !raw.trim()) {
            vysledek.nezmereno.push(`${a.name} (${a.uuid}): compose aplikace Coolify nevydal`);
            continue;
          }
          if (!/\/udp|protocol:\s*udp/.test(raw)) continue;
          const e = /\$\{?[A-Za-z_]/.test(raw) ? await envy(a) : new Map();
          cizi = udpPortyCompose(raw, (k) => e.get(k));
        } else {
          cizi = udpPortyMapovani(a.ports_mappings);
        }
      } catch (err) {
        vysledek.nezmereno.push(`${a.name} (${a.uuid}): ${String(err.message).split("\n")[0]}`);
        continue;
      }
      for (const c of cizi) {
        for (const n of nasePorty) {
          if (s != null && n.server != null && String(s) !== String(n.server)) continue;
          if (c.od <= n.do && n.od <= c.do) {
            vysledek.kolize.push(
              `UDP ${n.od}${n.do !== n.od ? `-${n.do}` : ""} (${n.app}/${n.sluzba}) × ${a.name} [${a.uuid}, environment ${a.environment_id ?? "?"}] ` +
                `${c.od}${c.do !== c.od ? `-${c.do}` : ""}/${c.sluzba}`,
            );
          }
        }
      }
    }
  }
  return vysledek;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const za = (p) => {
    const i = argv.indexOf(p);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let kod = 2;
  try {
    const soubor = za("--env-file");
    const cti = soubor ? ctenarSouboru(soubor) : (k) => process.env[k];
    if (argv.includes("--coolify")) {
      const prefix = za("--prefix");
      if (!prefix || !soubor) throw new Error("--coolify potřebuje --prefix <prefix instance> a --env-file <SoT>");
      const { readConfigKeyAny } = await import("./config-env-files.mjs");
      const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL || readConfigKeyAny(["COOLIFY_BASE_URL", "COOLIFY_URL"]);
      const token = process.env.COOLIFY_API_TOKEN || process.env.COOLIFY_API_KEY || readConfigKeyAny(["COOLIFY_API_TOKEN", "COOLIFY_API_KEY"]);
      if (!baseUrl || !token) throw new Error("chybí COOLIFY_URL nebo COOLIFY_API_TOKEN — aplikace NEJDE přečíst");
      const { createCoolifyClient } = await import("./coolify-http.mjs");
      const { createProjectScope } = await import("./coolify-project-scope.mjs");
      const coolify = createCoolifyClient({ baseUrl, token, timeoutMs: 120_000 });
      const scope = await createProjectScope(coolify);
      const operatorFile = za("--operator-file");
      const r = await zmerDvereNaAplikaci({
        coolify,
        inProject: scope.inProject,
        prefix,
        sot: cti,
        operator: operatorFile ? ctenarSouboru(operatorFile) : undefined,
      });
      const kde = r.edge ?? "(edge nenalezen)";
      if (!r.vady.length && !r.kolize.length) {
        console.log(`✓ dveře na aplikaci ${kde}: ${r.deklarovano ? "deklarované a v souladu" : "nedeklarované a aplikace je nemá"}; kolize UDP portů s cizími projekty: žádná`);
      }
      for (const v of r.vady) console.log(`✗ vada: ${v}`);
      for (const k of r.kolize) console.log(`✗ kolize: ${k}`);
      for (const n of r.nezmereno) console.log(`? NEMĚŘENO: ${n}`);
      kod = r.zavrenyEdgeBezDveri ? KOD_ZAVRENY_EDGE : r.vady.length || r.kolize.length ? 1 : r.nezmereno.length ? 3 : 0;
    } else if (argv.includes("--deklarovano")) {
      kod = dvereDeklarovane(cti) ? 0 : 1;
    } else if (argv.includes("--soulad")) {
      const operatorFile = za("--operator-file");
      // Předaný soubor deklarací, který nejde přečíst, je NEMĚŘENO — ne „bez deklarací".
      const operator = operatorFile ? ctenarSouboru(operatorFile) : undefined;
      const { deklarovano, vady, zavrenyEdgeBezDveri } = vadyDveri(cti, { operator });
      if (vady.length === 0) {
        console.log(`✓ dveře: ${deklarovano ? "deklarované a v souladu" : "nedeklarované, nic nezapíná"}`);
        kod = 0;
      } else {
        console.log(`✗ dveře (${deklarovano ? "deklarované" : "nedeklarované"}): ${vady.length} rozpor(ů)`);
        for (const v of vady) console.log(`    - ${v}`);
        kod = zavrenyEdgeBezDveri ? KOD_ZAVRENY_EDGE : 1;
      }
    } else {
      throw new Error("použití: --deklarovano | --soulad [--env-file <soubor>] [--operator-file <soubor>] | --coolify --prefix <p> --env-file <SoT>");
    }
  } catch (e) {
    console.error(`dvere-soulad: NEMĚŘENO — ${e.message}`);
    kod = 2;
  }
  process.exit(kod);
}
