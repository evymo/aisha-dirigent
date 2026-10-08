#!/usr/bin/env node
/**
 * umisteni-slotu.mjs — smí služba bydlet na slotu, kam ji topologie posílá?
 *
 * `umisteni-souhlasi.sh` měří, že manifest a profil říkají TOTÉŽ. Neměří, jestli
 * to, co oba říkají, dává smysl. Tohle je druhá polovina téže otázky a běží na
 * stejném místě (doktor krok 0, suchý běh), tedy DŘÍV než cokoli zapíše.
 *
 * Pravidla (kontrakty d8 U5/U6/U8 a 0c C2/O8, rozhodnutí 10-05 „varianta C"):
 *
 *   1. Umístění je slot registru (`coolify/servers.json`, `slotyUmisteni`).
 *      Neznámý slot je NEMĚŘENO (kód 2), ne „výchozí server". Derivace domén
 *      neznámé umístění dnes tiše přijme a vydá pod ním jméno.
 *
 *   2. Na slotu s GPU (`has_gpu`, týž příznak, podle kterého discovery slot
 *      nehádá) nesmí být nic z HLAVNÍHO meshe forku. GPU stroj je sdílený mezi
 *      forky a fork na něj vstupuje jen svým MODELOVÝM meshem. Peer hlavního meshe
 *      na sdíleném stroji by kompromitaci stroje rozlil do celé sítě forku.
 *      Stopa hlavního meshe v compose = zápis agenta klíčem stacku
 *      (`$NETBIRD_STACK_KEY_*`, se závorkami i bez) nebo síť resolveru hlavního
 *      meshe (`$MESH_DNS_NETWORK`). Porušení je rozpor (kód 1). Totéž platí pro
 *      `network_mode: host` (síť hostitele sdílí všechny forky) a
 *      `network_mode: container:<…>` (jmenný prostor kontejneru mimo stack —
 *      typicky agenta hlavního meshe). `service:<…>` zůstává uvnitř stacku a smí.
 *      Jediná výjimka pro `host`: služba, která má v katalogu pojmenovaný důvod
 *      `sit_hostitele` — operátorský firewall uzlu (accel-hostfw) píše pravidla
 *      hostitele. Tenký stack forku ji nemá nikdy (brána v testu).
 *      `env_file` text compose neprozradí (proměnné přijdou ze souboru), takže
 *      služba s ním je NEMĚŘENO (2), ne čistá. (Čtení d8 450548e, N1–N3.)
 *
 *   2b. Na slotu s GPU se nevstupuje do sítě sdílené mezi forky (`coolify`,
 *      ingress Traefiku). Kontrakt 0c (c): žádná docker síť společná stackům dvou
 *      forků. Na GPU uzlu Traefik neběží, takže tam ta síť nemá co dělat.
 *
 *   3. Na slotu s GPU nevzniká veřejná tvář. Majitel 5. 10.: „nikdy modely
 *      nevystavujeme přímo, ten model je pro venek Aisha jako taková".
 *
 * Kód 0 = v pořádku · 1 = rozpor (STOP) · 2 = NEMĚŘENO (≠ shoda).
 *
 * CLI: node scripts/lib/umisteni-slotu.mjs
 *   Topologie se staví z AISHA_PROFILE (týmiž dveřmi jako derive-domains), takže
 *   vidí přepis umístění z profilu instance i zavřené lane.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { isDirectRun } from "./cli-entry.mjs";
import { nactiKatalog } from "./provision-gate.mjs";
import { nactiSloty, slotyUmisteni, vyzadujeVyslovnouVazbu } from "./sloty-serveru.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Stopy HLAVNÍHO meshe forku v compose. Klíč stacku zapisuje peer do hlavního meshe, mesh-dns je jeho resolver. */
export const STOPY_HLAVNIHO_MESHE = Object.freeze([/\$\{?NETBIRD_STACK_KEY_[A-Z0-9_]+\}?/, /\$\{?MESH_DNS_NETWORK\b\}?/]);

/** Sítě sdílené mezi forky ZÁMĚRNĚ (ingress Traefiku) — jinde výjimka, na GPU slotu rozpor. */
export const SITE_SDILENE_MEZI_FORKY = Object.freeze(["coolify"]);

/** Compose jako objekt; nečitelný YAML = `null`. */
function nactiCompose(text) {
  try {
    // `merge: true`: idiom repa je `<<: *x-svc-common` — bez rozbalení by síť hostitele,
    // env_file nebo `coolify` schované v kotvě prošly (revize accel-1, 10-05, bod 3).
    return parse(text, { merge: true }) ?? {};
  } catch {
    return null;
  }
}

/**
 * Konstrukce, které text JEDNOHO souboru nevyloží: `include` (jiný soubor) a
 * `extends` (služba z jiného souboru nebo jiná služba). Výsledek nejde změřit = NEZMĚŘENO.
 * @returns {string[]|null} popisy konstrukcí; nečitelný YAML = `null`
 */
export function nemeritelneKonstrukce(text) {
  const doc = nactiCompose(text);
  if (doc === null) return null;
  const out = [];
  if (doc.include !== undefined) out.push("include");
  for (const [jmeno, sluzba] of Object.entries(doc.services ?? {})) if (sluzba?.extends !== undefined) out.push(`${jmeno} (extends)`);
  return out;
}

/**
 * Služby, které obcházejí vlastní síť stacku: `network_mode: host` (síť hostitele,
 * sdílená všemi forky) nebo `container:<…>` (jmenný prostor kontejneru mimo stack).
 * @returns {string[]|null} `služba (režim)`; nečitelný YAML = `null`
 */
export function ciziSitovyRezim(text) {
  const doc = nactiCompose(text);
  if (doc === null) return null;
  return Object.entries(doc.services ?? {})
    .filter(([, s]) => /^(host|container:)/.test(String(s?.network_mode ?? "")))
    .map(([jmeno, s]) => `${jmeno} (${s.network_mode})`);
}

/**
 * Cesty, přes které kontejner ovládne UZEL (a tím všechny nájemce sdíleného GPU stroje):
 * sokety démonů, úložiště Dockeru/containerd a pseudosoubory jádra. Zdroj bindu je
 * kritický, když je takovou cestou, leží v ní, NEBO je jejím předkem (`/`, `/run`, `/var/run`:
 * nadřazený adresář dá socket taky — revize accel-1, 3. kolo).
 */
export const KRITICKE_CESTY = Object.freeze(["/var/run/docker.sock", "/run/docker.sock", "/run/containerd", "/var/run/containerd", "/var/lib/docker", "/var/lib/containerd", "/proc", "/sys", "/dev", "/etc", "/root", "/boot"]);
/** Schopnosti, se kterými kontejner opustí svůj jmenný prostor (klasické úniky). */
/**
 * Schopnosti, které smí služba na GPU slotu PŘIDAT (revize accel-2): jen NET_ADMIN (rozhraní
 * WireGuardu agenta meshe, firewall ve vlastním netns). Výčet povolených, ne zakázaných: každá
 * další schopnost sahá na sdílený uzel (SYS_TIME hodiny všem nájemcům, SYS_MODULE jádro, …).
 */
export const POVOLENE_SCHOPNOSTI = Object.freeze(["NET_ADMIN"]);
/**
 * Schopnosti, které neotevře ani pojmenovaná výjimka katalogu (`schopnosti`): sahají na jádro,
 * hodiny, paměť nebo procesy celého uzlu. Ostatní mimo POVOLENE_SCHOPNOSTI smí jen s důvodem
 * v katalogu a s compose z katalogu (např. NET_RAW firewallu uzlu pro backend iptables-legacy).
 */
export const NIKDY_SCHOPNOSTI = Object.freeze(["ALL", "SYS_ADMIN", "SYS_MODULE", "SYS_PTRACE", "SYS_RAWIO", "SYS_BOOT", "SYS_TIME", "DAC_READ_SEARCH", "MAC_ADMIN", "MAC_OVERRIDE", "BPF", "PERFMON"]);
/**
 * Pevné jméno svazku složené z identity instance nebo vlastníka uzlu je vlastní (trvalé svazky
 * vah). Jen holé nebo povinné (`:?`) rozbalení — výchozí hodnota (`:-`) by při chybějící identitě
 * pojmenovala svazek jinak, třeba po cizí instanci.
 */
const JMENO_Z_IDENTITY = /^\$\{(APP_NAME_PREFIX|ACCEL_OWNER_PREFIX)(:\?[^}]*)?\}-[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** Zařízení hostitele, která tenký stack potřebuje (agent meshe). CDI (`nvidia.com/gpu=all`) není cesta. */
const POVOLENA_ZARIZENI = new Set(["/dev/net/tun"]);

/** Socket démona Dockeru (zdroj bindu). Výjimku má jen proxy pojmenovaná v katalogu (`socket_dockeru`). */
const SOKETY_DOCKERU = Object.freeze(["/var/run/docker.sock", "/run/docker.sock"]);

/** Služby compose, které svazek `klic` připojují jinak než jen pro čtení. */
function zapisoveSluzby(doc, klic) {
  const ven = [];
  for (const [jmeno, s] of Object.entries(doc?.services ?? {})) {
    for (const v of Array.isArray(s?.volumes) ? s.volumes : []) {
      const zdroj = typeof v === "string" ? v.split(":")[0] : v?.source;
      if (zdroj !== klic) continue;
      const jenCteni = typeof v === "string" ? v.split(":").slice(2).join(":").split(",").includes("ro") : v?.read_only === true;
      if (!jenCteni) ven.push(jmeno);
    }
  }
  return ven;
}

/** Smí služba připojit socket démona? Pojmenovaná v katalogu, jen pro čtení, bez sítě, bez schopností. */
function soketSmi(jmeno, s, v, povolenySoket) {
  const duvod = povolenySoket[jmeno];
  if (typeof duvod !== "string" || duvod.trim() === "") return false;
  const jenCteni = typeof v === "string" ? v.split(":").slice(2).join(":").split(",").includes("ro") : v?.read_only === true;
  const bezCap = !Array.isArray(s.cap_add) || s.cap_add.length === 0;
  return jenCteni && s.network_mode === "none" && bezCap;
}

function kritickaCesta(zdroj) {
  const z = posix.normalize(zdroj).replace(/\/+$/, "") || "/";
  return z.endsWith(".sock") || KRITICKE_CESTY.some((k) => z === k || z.startsWith(`${k}/`) || (z === "/" ? true : k.startsWith(`${z}/`)));
}

/** Zdroj připojení, který je cestou na hostiteli (absolutní, relativní ke compose, domovská). */
const jeCestaHostitele = (zdroj) => typeof zdroj === "string" && /^(\/|\.{1,2}(\/|$)|~)/.test(zdroj);

/** Zdroj krátkého zápisu svazku `zdroj:cíl[:režim]`; anonymní svazek (bez `:`) zdroj nemá. */
function zdrojSvazku(v) {
  if (typeof v === "string") return v.includes(":") ? v.split(":")[0] : undefined;
  if (v && typeof v === "object") return v.type === "bind" || jeCestaHostitele(v.source) ? v.source : undefined;
  return undefined;
}

/**
 * Cesty z kontejneru na HOSTITELE (a odtud k ostatním nájemcům sdíleného uzlu). Na slotu
 * s GPU (revize accel-1, 2. a 3. kolo — podmínka před prvním tenkým stackem forku):
 *   rozpor (1): privileged; pid/ipc/userns/uts/cgroup host; pid/ipc `container:`; volumes_from;
 *     cgroup_parent; device_cgroup_rules; cap_add mimo POVOLENE_SCHOPNOSTI; `ports:` (veřejná
 *     tvář mimo edge); security_opt unconfined /
 *     label disable; zařízení /dev/* (kromě /dev/net/tun); DOCKER_HOST; bind kritické cesty
 *     nebo jejího předka, soket; svazek s driver_opts `device` na kritickou cestu;
 *   nezměřeno (2): jakýkoli jiný bind z hostitele, který katalog nepojmenuje
 *     (`cesty_hostitele`); svazek `external` nebo s pevným `name:`, které nenese identitu
 *     instance ani vlastníka (čí je?); secrets/configs
 *     ze souboru; hodnota s `${…}` v čemkoli z výše uvedeného.
 * Dvě měřené výjimky (obě jen s compose z katalogu, viz overCompose):
 *   - socket démona smí služba pojmenovaná v katalogu (`socket_dockeru`, důvod = text), a jen
 *     JEN PRO ČTENÍ, bez sítě (`network_mode: none`) a bez přidaných schopností — proxy socketu,
 *     přes kterou hlídač členství čte Docker API (GET vyjmenovaných cest, accel-docker-proxy.test);
 *   - `external` svazek se jménem z identity vlastníka je změřený, když ho (bez `external`, týmž
 *     jménem) zakládá compose jiné služby katalogu na GPU slotu (`vlastniSvazky`) A každá služba ho
 *     připojuje JEN PRO ČTENÍ: svazek vah vrstvy, který engine čte. Zápis do cizího svazku vrstvy
 *     je rozpor (přepsané váhy = jiný model pro všechny nájemce).
 * @param {{ povoleneCesty?: Record<string, string>, povoleneSchopnosti?: Record<string, string>, povolenySoket?: Record<string, string>, vlastniSvazky?: Set<string> }} [opts]
 *   pojmenované výjimky bindů, schopností a socketu z katalogu (důvod = neprázdný text)
 * @returns {{ rozpory: string[], nezmereno: string[] } | null} nečitelný YAML = `null`
 */
export function cestyNaHostitele(text, { povoleneCesty = {}, povoleneSchopnosti = {}, povolenySoket = {}, vlastniSvazky = new Set() } = {}) {
  const doc = nactiCompose(text);
  if (doc === null) return null;
  const rozpory = [];
  const nezmereno = [];
  const promenna = (v) => typeof v === "string" && v.includes("$");
  const bind = (kde, zdroj) => {
    if (promenna(zdroj)) nezmereno.push(`${kde} (${zdroj})`);
    else if (kritickaCesta(zdroj)) rozpory.push(`${kde} (${/\.sock$/.test(zdroj) ? "soket" : "kritická cesta hostitele"}: ${zdroj})`);
    else if (!Object.hasOwn(povoleneCesty, zdroj)) nezmereno.push(`${kde} (cesta hostitele ${zdroj} bez pojmenované výjimky)`);
  };
  for (const [jmeno, s] of Object.entries(doc.services ?? {})) {
    if (!s || typeof s !== "object") continue;
    for (const klic of ["pid", "ipc", "userns_mode", "uts", "cgroup", "network_mode"]) {
      const v = s[klic];
      if (promenna(v)) nezmereno.push(`${jmeno} (${klic}: ${v})`);
      else if (klic !== "network_mode" && v === "host") rozpory.push(`${jmeno} (${klic}: host)`);
      else if ((klic === "pid" || klic === "ipc") && typeof v === "string" && v.startsWith("container:")) rozpory.push(`${jmeno} (${klic}: ${v})`);
    }
    if (s.privileged === true || (typeof s.privileged === "string" && s.privileged !== "false")) rozpory.push(`${jmeno} (privileged)`);
    if (s.volumes_from !== undefined) rozpory.push(`${jmeno} (volumes_from)`);
    if (s.cgroup_parent !== undefined) rozpory.push(`${jmeno} (cgroup_parent)`);
    if (s.device_cgroup_rules !== undefined) rozpory.push(`${jmeno} (device_cgroup_rules)`);
    for (const c of Array.isArray(s.cap_add) ? s.cap_add : []) {
      if (promenna(c)) nezmereno.push(`${jmeno} (cap_add ${c})`);
      else {
        const cap = String(c).toUpperCase().replace(/^CAP_/, "");
        const duvod = Object.entries(povoleneSchopnosti).find(([k]) => k.toUpperCase().replace(/^CAP_/, "") === cap)?.[1];
        const pojmenovana = typeof duvod === "string" && duvod.trim() !== "" && !NIKDY_SCHOPNOSTI.includes(cap);
        if (!POVOLENE_SCHOPNOSTI.includes(cap) && !pojmenovana) rozpory.push(`${jmeno} (cap_add ${c})`);
      }
    }
    if (s.ports !== undefined && !(Array.isArray(s.ports) && s.ports.length === 0)) rozpory.push(`${jmeno} (ports — publikace na hostiteli GPU uzlu mimo edge)`);
    for (const o of Array.isArray(s.security_opt) ? s.security_opt : []) {
      if (promenna(o)) nezmereno.push(`${jmeno} (security_opt ${o})`);
      else if (/unconfined|label[:=]disable/i.test(String(o))) rozpory.push(`${jmeno} (security_opt ${o})`);
    }
    for (const d of Array.isArray(s.devices) ? s.devices : []) {
      const zdroj = typeof d === "string" ? d.split(":")[0] : d?.source;
      if (promenna(zdroj)) nezmereno.push(`${jmeno} (zařízení ${zdroj})`);
      else if (typeof zdroj === "string" && zdroj.startsWith("/") && !POVOLENA_ZARIZENI.has(posix.normalize(zdroj))) rozpory.push(`${jmeno} (zařízení ${zdroj})`);
    }
    const env = s.environment;
    const dockerHost = Array.isArray(env) ? env.some((e) => /^DOCKER_HOST(=|$)/.test(String(e))) : env && typeof env === "object" && Object.hasOwn(env, "DOCKER_HOST");
    if (dockerHost) rozpory.push(`${jmeno} (DOCKER_HOST)`);
    for (const v of Array.isArray(s.volumes) ? s.volumes : []) {
      const zdroj = zdrojSvazku(v);
      if (zdroj !== undefined && SOKETY_DOCKERU.includes(zdroj) && soketSmi(jmeno, s, v, povolenySoket)) continue;
      if (zdroj !== undefined && (jeCestaHostitele(zdroj) || promenna(zdroj))) bind(`${jmeno} svazek`, zdroj);
    }
  }
  for (const [jmeno, v] of Object.entries(doc.volumes ?? {})) {
    if (!v || typeof v !== "object") continue;
    const zarizeni = v.driver_opts?.device;
    if (zarizeni !== undefined) bind(`svazek ${jmeno} (driver_opts device)`, String(zarizeni));
    const vlastniJmeno = typeof v.name === "string" && JMENO_Z_IDENTITY.test(v.name);
    const zalozenyVrstvou = vlastniJmeno && vlastniSvazky.has(v.name);
    if (zalozenyVrstvou && (v.external === true || v.external === "true")) {
      const zapis = zapisoveSluzby(doc, jmeno);
      if (zapis.length > 0) rozpory.push(`svazek ${jmeno} (${v.name} — svazek vrstvy jen pro čtení, zápis: ${zapis.join(", ")})`);
    }
    if (((v.external === true || v.external === "true") && !zalozenyVrstvou) || (v.name !== undefined && !vlastniJmeno)) nezmereno.push(`svazek ${jmeno} (${v.external ? "external" : `name: ${v.name}`} — čí je, text nevyloží)`);
  }
  for (const sekce of ["secrets", "configs"]) {
    for (const [jmeno, v] of Object.entries(doc[sekce] ?? {})) if (v?.file !== undefined) bind(`${sekce} ${jmeno} (file)`, String(v.file));
  }
  return { rozpory, nezmereno };
}

/** Služby s `env_file` — jejich proměnné text compose neprozradí. Nečitelný YAML = `null`. */
export function sluzbySEnvFile(text) {
  const doc = nactiCompose(text);
  if (doc === null) return null;
  return Object.entries(doc.services ?? {})
    .filter(([, s]) => s?.env_file !== undefined)
    .map(([jmeno]) => jmeno);
}

/** Služby compose, které vstupují do sítě sdílené mezi forky; nečitelný YAML = `null`. */
export function vstupyDoSdileneSite(text) {
  const doc = nactiCompose(text);
  if (doc === null) return null;
  const sdilene = new Set(
    Object.entries(doc?.networks ?? {})
      .filter(([klic, def]) => SITE_SDILENE_MEZI_FORKY.includes(def?.name ?? klic))
      .map(([klic]) => klic),
  );
  const vstupy = [];
  for (const [jmeno, sluzba] of Object.entries(doc?.services ?? {})) {
    const site = Array.isArray(sluzba?.networks) ? sluzba.networks : Object.keys(sluzba?.networks ?? {});
    if (site.some((n) => sdilene.has(n))) vstupy.push(jmeno);
  }
  return vstupy;
}

/** Čtení compose z kořene repa; nečitelný soubor je `null`, ne prázdný text. */
export function ctenarCompose(koren = REPO_ROOT) {
  return (soubor) => {
    try {
      return readFileSync(join(koren, soubor), "utf8");
    } catch {
      return null;
    }
  };
}

/**
 * Jména svazků, které na GPU slotu ZAKLÁDÁ compose služby z katalogu (bez `external`, jméno z identity):
 * čí jsou, je změřené, takže je jiný compose vrstvy smí připojit jako `external` (svazek vah enginů).
 */
function svazkyVrstvy(katalog, cteniCompose) {
  const jmena = new Set();
  for (const s of Object.values(katalog ?? {})) {
    if (s?.placement !== "gpu" || !s.compose) continue;
    const doc = nactiCompose(cteniCompose(s.compose) ?? "");
    for (const v of Object.values(doc?.volumes ?? {})) {
      if (v && typeof v === "object" && v.external !== true && v.external !== "true" && typeof v.name === "string" && JMENO_Z_IDENTITY.test(v.name)) jmena.add(v.name);
    }
  }
  return jmena;
}

/**
 * Pravidla GPU slotu nad JEDNÍM compose. Volá se pro službu topologie i pro aplikaci
 * manifestu (story-init zakládá podle manifestu — revize accel-1, bod 1).
 */
function overCompose(id, slot, compose, { cteniCompose, katalog }) {
  const nalezy = [];
  if (!compose) return [{ kod: 2, id, zprava: `na GPU slotu '${slot}' bez compose — není co změřit` }];
  // Služba s tenkým stackem pro GPU slot (`compose_gpu`) smí na něm nasazovat JEN ten:
  // obsah pro vlastní uzel instance (CPU model, agent hlavního meshe) na sdílený uzel nepatří.
  const tenky = katalog?.[id]?.compose_gpu;
  if (tenky && compose !== tenky) {
    nalezy.push({ kod: 1, id, zprava: `na GPU slotu '${slot}' smí '${id}' nasazovat JEN tenký compose ${tenky} (je ${compose})` });
  }
  const text = cteniCompose(compose);
  if (text == null) return [{ kod: 2, id, zprava: `compose ${compose} nejde přečíst — stopa hlavního meshe NEZMĚŘENA` }];
  const nemeritelne = nemeritelneKonstrukce(text);
  if (nemeritelne === null) return [{ kod: 2, id, zprava: `compose ${compose} není platný YAML — sítě NEZMĚŘENY` }];
  if (nemeritelne.length > 0) {
    nalezy.push({ kod: 2, id, zprava: `compose ${compose} skládá jiné soubory (${nemeritelne.join(", ")}) — text jednoho souboru je nevyloží, NEZMĚŘENO` });
  }
  const vstupy = vstupyDoSdileneSite(text) ?? [];
  if (vstupy.length > 0) {
    nalezy.push({ kod: 1, id, zprava: `na GPU slotu '${slot}' vstupuje do sítě sdílené mezi forky (${SITE_SDILENE_MEZI_FORKY.join(", ")}: ${vstupy.join(", ")} v ${compose})` });
  }
  // Síť hostitele smí jen služba s pojmenovaným důvodem v katalogu, a jen s compose
  // Z KATALOGU — výjimka patří obsahu, ne jménu (revize accel-1, 2. kolo: `app:
  // accel-hostfw:gpu:<cizí compose>` s host + privileged prošla). container: nikdy.
  const smiHost =
    typeof katalog?.[id]?.sit_hostitele === "string" && katalog[id].sit_hostitele.trim() !== "" && katalog[id].compose === compose;
  const rezimy = (ciziSitovyRezim(text) ?? []).filter((r) => !(smiHost && r.endsWith("(host)")));
  if (rezimy.length > 0) {
    nalezy.push({ kod: 1, id, zprava: `na GPU slotu '${slot}' obchází síť stacku (${rezimy.join(", ")} v ${compose}) — host sdílí všechny forky, container: běží v cizím jmenném prostoru` });
  }
  // Bind z hostitele smí jen s pojmenovaným důvodem v katalogu, a jen s compose Z KATALOGU (jako síť hostitele).
  const vyjimkyCest = katalog?.[id]?.compose === compose && katalog?.[id]?.cesty_hostitele && typeof katalog[id].cesty_hostitele === "object" ? katalog[id].cesty_hostitele : {};
  const vyjimkySchopnosti = katalog?.[id]?.compose === compose && katalog?.[id]?.schopnosti && typeof katalog[id].schopnosti === "object" ? katalog[id].schopnosti : {};
  // Obě výjimky vrstvy (socket proxy, svazek vah) jen s compose Z KATALOGU, jako ostatní výjimky:
  // řádek manifestu s cizím compose na GPU slotu je nedostane, ať se jmenuje jakkoli.
  const zKatalogu = katalog?.[id]?.compose === compose;
  const vyjimkaSoketu = katalog?.[id]?.compose === compose && katalog?.[id]?.socket_dockeru && typeof katalog[id].socket_dockeru === "object" ? katalog[id].socket_dockeru : {};
  const hostitel =
    cestyNaHostitele(text, { povoleneCesty: vyjimkyCest, povoleneSchopnosti: vyjimkySchopnosti, povolenySoket: vyjimkaSoketu, vlastniSvazky: zKatalogu ? svazkyVrstvy(katalog, cteniCompose) : new Set() }) ??
    { rozpory: [], nezmereno: [] };
  if (hostitel.rozpory.length > 0) {
    nalezy.push({ kod: 1, id, zprava: `na GPU slotu '${slot}' má cestu na hostitele (${hostitel.rozpory.join(", ")} v ${compose}) — odtud k ostatním nájemcům sdíleného uzlu` });
  }
  if (hostitel.nezmereno.length > 0) {
    nalezy.push({ kod: 2, id, zprava: `na GPU slotu '${slot}' nezměřitelný přístup k hostiteli (${hostitel.nezmereno.join(", ")} v ${compose}) — text ho nevyloží nebo ho katalog nepojmenoval, NEZMĚŘENO` });
  }
  const sEnvFile = sluzbySEnvFile(text) ?? [];
  if (sEnvFile.length > 0) {
    nalezy.push({ kod: 2, id, zprava: `na GPU slotu '${slot}' služby s env_file (${sEnvFile.join(", ")} v ${compose}) — proměnné ze souboru text compose neprozradí, stopa hlavního meshe NEZMĚŘENA` });
  }
  const stopy = STOPY_HLAVNIHO_MESHE.map((re) => text.match(re)?.[0]).filter(Boolean);
  if (stopy.length > 0) {
    nalezy.push({
      kod: 1,
      id,
      zprava: `na GPU slotu '${slot}' vstupuje do HLAVNÍHO meshe forku (${stopy.join(", ")} v ${compose}) — na sdíleném GPU stroji smí být jen klient modelového meshe forku (varianta C)`,
    });
  }
  return nalezy;
}

/**
 * Služby TOPOLOGIE (derive-domains): umístění v registru, na GPU slotu pravidla compose
 * z katalogu a žádná veřejná tvář (veřejnou tvář zná jen topologie).
 * @param {Record<string, {placement?: string, compose?: string, urls?: {public?: unknown[]}}>} sluzby služby topologie (buildTopology().services)
 * @returns {{kod: 1|2, id: string, zprava: string}[]}
 */
export function overUmisteniSlotu(sluzby, { servers = nactiSloty(), cteniCompose = ctenarCompose(), katalog = nactiKatalog() } = {}) {
  const nalezy = [];
  const umisteni = new Set(slotyUmisteni(servers));
  for (const [id, s] of Object.entries(sluzby ?? {})) {
    const slot = s?.placement;
    if (!umisteni.has(slot)) {
      nalezy.push({ kod: 2, id, zprava: `umístění '${slot}' registr slotů (coolify/servers.json) nezná — výchozí server se nedosazuje` });
      continue;
    }
    if (!vyzadujeVyslovnouVazbu(servers[slot])) continue;
    if (Array.isArray(s.urls?.public) && s.urls.public.length > 0) {
      nalezy.push({ kod: 1, id, zprava: `veřejná tvář na GPU slotu '${slot}' — modely se nevystavují přímo, jen přes Aishu forku` });
    }
    nalezy.push(...overCompose(id, slot, s.compose, { cteniCompose, katalog }));
  }
  return nalezy;
}

/**
 * Aplikace MANIFESTU (`app: <id>:<slot>:<compose>`, jen ty, které se nasazují) —
 * přesně to, co story-init založí. Slot musí být v registru; na GPU slotu platí
 * pravidla compose Z MANIFESTU (revize accel-1, bod 1: `app: pgadmin:gpu:…` s profilem,
 * který o gpu neví, prošel kontrolou topologie s kódem 0).
 * @param {{id: string, slot: string, compose: string}[]} aplikace
 */
export function overManifest(aplikace, { servers = nactiSloty(), cteniCompose = ctenarCompose(), katalog = nactiKatalog() } = {}) {
  const nalezy = [];
  const umisteni = new Set(slotyUmisteni(servers));
  for (const a of aplikace) {
    if (!umisteni.has(a.slot)) {
      nalezy.push({ kod: 2, id: a.id, zprava: `manifest posílá na slot '${a.slot}', který registr slotů nezná — výchozí server se nedosazuje` });
      continue;
    }
    if (!vyzadujeVyslovnouVazbu(servers[a.slot])) continue;
    nalezy.push(...overCompose(a.id, a.slot, a.compose, { cteniCompose, katalog }));
  }
  return nalezy;
}

/** Mapa aplikací manifestu z TSV (`id<TAB>slot<TAB>compose` na řádek; tvar load_app_compose_map). */
export function parsujMapuManifestu(text) {
  return String(text)
    .split("\n")
    .filter((r) => r.trim() !== "")
    .map((r) => {
      const [id, slot, compose] = r.split("\t");
      if (!id || !slot) throw new Error(`řádek mapy manifestu bez id nebo slotu: '${r.slice(0, 80)}'`);
      return { id, slot, compose: compose ?? "" };
    });
}

/** Kód běhu: jistý rozpor (1) má přednost před nezměřeným (2) — hláška má jmenovat to, co víme. */
export function kodZNalezu(nalezy) {
  return nalezy.some((n) => n.kod === 1) ? 1 : nalezy.some((n) => n.kod === 2) ? 2 : 0;
}

if (isDirectRun(import.meta.url)) {
  let sluzby;
  try {
    const { buildTopology } = await import("./derive-domains.mjs");
    sluzby = buildTopology({}).services;
  } catch (e) {
    const prvni = String(e?.message ?? e).split("\n")[0];
    console.error(`umisteni-slotu: topologii nejde sestavit (${prvni}) — umístění NEZMĚŘENO`);
    process.exit(2);
  }
  let nalezy;
  try {
    nalezy = overUmisteniSlotu(sluzby);
    const i = process.argv.indexOf("--manifest-mapa");
    if (i >= 0) {
      const zdroj = process.argv[i + 1];
      const { readFileSync: cti } = await import("node:fs");
      const aplikace = parsujMapuManifestu(cti(zdroj === "-" || !zdroj ? 0 : zdroj, "utf8"));
      if (aplikace.length === 0) throw new Error("mapa manifestu je prázdná — není co změřit");
      // Jeden nález jednou: aplikace manifestu a služba topologie mohou ukazovat na tentýž compose.
      const videne = new Set(nalezy.map((n) => `${n.kod}|${n.id}|${n.zprava}`));
      for (const n of overManifest(aplikace)) if (!videne.has(`${n.kod}|${n.id}|${n.zprava}`)) nalezy.push(n);
    }
  } catch (e) {
    console.error(`umisteni-slotu: registr slotů nebo mapu manifestu nejde přečíst (${e.message}) — NEZMĚŘENO`);
    process.exit(2);
  }
  for (const n of nalezy) console.error(`${n.kod === 1 ? "ROZPOR" : "NEZMĚŘENO"} ${n.id}: ${n.zprava}`);
  const kod = kodZNalezu(nalezy);
  if (kod === 0) console.log(`umístění slotů v pořádku: ${Object.keys(sluzby).length} služeb, sloty registru, na GPU slotu nic z hlavního meshe`);
  process.exit(kod);
}
