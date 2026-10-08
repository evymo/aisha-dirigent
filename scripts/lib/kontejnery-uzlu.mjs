#!/usr/bin/env node
/**
 * kontejnery-uzlu.mjs — co na uzlu s firewallem hostitele BĚŽÍ a PUBLIKUJE: nezávislá
 * kontrola deklarace „proxy none" (a obecně „uzel nic veřejně nevystavuje"), která
 * nepotřebuje API Coolify.
 *
 * PROČ: typ proxy v API Coolify je deklarace, ne stav. Zápis `none` uloží typ do
 * databáze, ale běžící kontejner proxy nezastaví (past u POLE_PROXY v
 * scripts/coolify-server-proxy.mjs) — API pak hlásí NONE a proxy dál publikuje
 * 80/443. Firewall hostitele ji v `enforce` zakryje, takže vnější sonda projde;
 * jakmile firewall ustoupí (measure, VRACENO, pád kontejneru), je proxy zase
 * veřejná. Jediné místo, kde je to vidět bez ohledu na firewall, je výpis
 * kontejnerů NA UZLU.
 *
 * CO SE MĚŘÍ (jen čtení, kanálem doktora `docker -H ssh://<hostname slotu>`):
 *   1. `docker ps --all` → KAŽDÝ port publikovaný na adrese mimo loopback, který
 *      není v deklaraci portů uzlu (jediná výjimka: UDP port meshe, viz
 *      jeDeklarovanyPort), je NÁLEZ — TCP i UDP, bez ohledu na režim firewallu
 *      i na JMÉNO kontejneru. Kontejner proxy serveru (JMENA_PROXY) má jen
 *      zvláštní druh a hlášku (DRUH_NALEZU_PROXY); každý jiný DRUH_NALEZU_PORTU.
 *      ⛔ NAMĚŘENO 2026-10-05 (re-recenze d8, R1, sonda nad touto kontrolou): dřív se
 *      poznávala jen proxy PODLE JMÉNA — kontejner jiného jména s `0.0.0.0:80,443`,
 *      aplikace s `0.0.0.0:443` i `coolify-proxy-2` vyšly `ok`. Ve stavu VYNUCENO je
 *      cokoli publikovaného zakryté firewallem a vnější sonda to nevidí (táž třída
 *      jako F1); pravidlo UDP ve vnější sondě bere porty z aplikací Coolify, takže
 *      kontejner MIMO Coolify s UDP portem neviděl nikdo. Výpis uzlu přitom porty
 *      všech kontejnerů nese.
 *   1b. Běžící kontejner v SÍTI HOSTITELE (`Networks` = host) je NÁLEZ, pokud to
 *      není služba s pojmenovaným důvodem `sit_hostitele` v katalogu (firewall
 *      hostitele). V síti hostitele naslouchá přímo na rozhraních stroje a výpis
 *      u něj porty NEUKÁŽE — „bez portů" tu neznamená „nic nevystavuje".
 *      ⛔ NAMĚŘENO 2026-10-05 (re-recenze 2 d8, F1, sonda): `vllm-host` v síti
 *      hostitele s prázdnými Ports vyšel `ok`; jakmile firewall ustoupí, je veřejný.
 *   2. KOTVA: v TÉMŽE výpisu musí být kontejner firewallu hostitele (jméno z compose
 *      jeho služby). Tvrzení „proxy tu není" splní i prázdný nebo cizí výpis —
 *      kotva je důkaz, že výpis je čitelný a patří uzlu, kam se nasazuje. Bez kotvy
 *      a při rc ≠ 0 výpisu je výsledek NEZMĚŘENO s důvodem, nikdy ok.
 *   3. `docker inspect` kontejneru firewallu → STAV, který hostfw zapisuje a jeho
 *      healthcheck vypisuje (STAVY_FIREWALLU). Čte ho pravidlo o UDP ve vnější
 *      sondě (lib/vnejsi-expozice.mjs): deklarovaný režim není stav.
 *
 * Kontejner proxy se tu NEZASTAVUJE — kdo ho zastaví, je rozhodnutí majitele.
 * Tahle kontrola jen měří a hlásí.
 *
 * Které uzly: sloty, kam katalog umisťuje firewall hostitele a jeho lane je
 * otevřená (slotyFirewallu). Před prvním nasazením firewallu kotva chybí — proto
 * cold-start měří až ZA vlnami.
 *
 * CO JE ZMĚŘENO PROTI SKUTEČNOSTI (2026-10-04, GPU uzel, jen čtení):
 *   • `docker ps -a --format '{{json .}}'` vydává jeden objekt JSON na řádek
 *     s klíči Command, CreatedAt, HealthStatus, ID, Image, Labels, LocalVolumes,
 *     Mounts, Names, Networks, Platform, Ports, RunningFor, Size, State, Status.
 *     Tenhle modul volá TÝŽ příkaz (PRIKAZ_VYPISU) a čte z něj Names, Networks,
 *     Ports a State. (Hodnota Networks ze skutečného uzlu změřená není — měření
 *     uvedlo jen klíč; tvar „jména sítí oddělená čárkou, `host` pro síť hostitele"
 *     je tvar, který docker tiskne. Chybějící nebo jiný typ = NEZMĚŘENO.)
 *   • `Ports` je řetězec položek oddělených `, `: publikovaná `0.0.0.0:80->80/tcp`
 *     a její IPv6 dvojče `[::]:80->80/tcp` (šipka ASCII, cíl i protokol vždy), UDP
 *     jako `…->443/udp`; kontejner bez portů má prázdný řetězec. `State` je
 *     `running` / `created`. Kontejner proxy se jmenuje `coolify-proxy`.
 *   • Položka portu v jiném tvaru se NEVYKLÁDÁ — u kteréhokoli kontejneru výpisu
 *     je to NEZMĚŘENO s důvodem (publikovanePorty).
 * ⛔ NEZMĚŘENO proti skutečnosti (tvar je z toho, co tiskne docker a hostfw, ne
 * z uzlu): výstup `docker inspect` kontejneru firewallu (bod 3 — kontejner na uzlu
 * v době měření ještě nebyl; čte se, co vypisuje `hostfw.sh --zdravi`), položka jen
 * vystaveného portu (`8000/tcp`), rozsah portů (`…:3000-3002->3000-3002/tcp`) a
 * jméno proxy ve swarmu.
 *
 * CLI:
 *   node kontejnery-uzlu.mjs [--env-soubor <soubor>] [--json]
 *   kód 0 = změřeno, žádný kontejner nepublikuje port mimo loopback a deklaraci ·
 *   1 = nález · 2 = NEZMĚŘENO · 3 = změřeno jen zčásti
 *   Řádky výstupu: `✓ ` shoda · `✗ ` nález · `? ` neměřeno · `· ` informace.
 *   Nález nese druh: `✗ proxy na uzlu: <slot>: …` (DRUH_NALEZU_PROXY, kontejner proxy
 *   serveru) nebo `✗ port na uzlu: <slot>: …` (DRUH_NALEZU_PORTU, každý jiný kontejner).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { ctenarHodnot, nactiKatalog } from "./provision-gate.mjs";
import { nactiSloty } from "./sloty-serveru.mjs";
import { SLUZBA_FIREWALLU, portMeshe, slotyFirewallu } from "./vnejsi-expozice.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Kontejner proxy serveru, jak ho Coolify jmenuje: samostatný uzel / služba ve swarmu. */
export const JMENA_PROXY = Object.freeze(["coolify-proxy", "coolify-proxy_traefik"]);

/**
 * DRUH nálezu „kontejner proxy publikuje porty" — pevný prefix řádku
 * (`✗ proxy na uzlu: <slot>: …`). Doktor podle něj (ne podle věty za ním) pozná
 * nález fáze V NA UZLU, který v předletu cold-startu nezastavuje — spolu
 * s DRUH_NALEZU_PORTU níž jediné dva (vnejsi_expozice_verdikt v
 * scripts/cold-start-doctor.sh nese TÝŽ prefix; brána proxy-none-se-vynucuje
 * to měří chováním nad skutečným výstupem).
 */
export const DRUH_NALEZU_PROXY = "proxy na uzlu";

/**
 * DRUH nálezu „kontejner (jiný než proxy serveru) publikuje port mimo loopback
 * a mimo deklaraci" — pevný prefix řádku (`✗ port na uzlu: <slot>: …`). Je to
 * stav sdíleného uzlu téže třídy jako proxy: doktor ho v předletu cold-startu
 * hlásí jako hlasité varování a produkční běh ho na konci změří znovu
 * (vnejsi_expozice_verdikt v scripts/cold-start-doctor.sh nese TÝŽ prefix).
 */
export const DRUH_NALEZU_PORTU = "port na uzlu";

/**
 * Adresa hostitele, na které publikovaný port ven NEVEDE: loopback IPv4
 * (127.0.0.0/8) a IPv6 (`[::1]`, tak ho docker tiskne). Cokoli jiného — i adresa
 * meshe nebo LAN — je mimo loopback: publikovaný port tam je vystavený té síti.
 */
export function jeLoopback(adresa) {
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(adresa)) || adresa === "[::1]";
}

/**
 * DEKLARACE portů, které smí kontejner na uzlu publikovat mimo loopback. Jediná
 * výjimka je DEKLAROVANÝ UDP port meshe (ACCEL_FW_UDP_MESH_PORT): jen ten firewall
 * hostitele propouští (infra/accel/hostfw.sh, řetězce AISHA-HOSTFW-IN i -FWD). Výklad
 * má jeden domov — udpPortMeshe v lib/accel-deklarace.mjs (přes portMeshe
 * v lib/vnejsi-expozice.mjs), podle téhož dělá výjimku pravidlo UDP a firewall. Výjimka je PRÁVĚ ten port: rozsah kolem něj vystavuje
 * i sousedy. Bez deklarace (UDP na uzlu zavřeno — nejmenší oprávnění) žádná výjimka.
 *
 * @param {{ port: string, proto: string }} p publikovaný port z výpisu
 * @param {number|null} meshPort
 */
export function jeDeklarovanyPort(p, meshPort) {
  return meshPort !== null && p.proto === "udp" && p.port === String(meshPort);
}

/**
 * Stavy, které hostfw zapisuje (`zapis_stav` v infra/accel/hostfw.sh) a jeho
 * healthcheck (`--zdravi`) vypisuje jako `stav <STAV>[: důvod]`. Opis — test ho
 * měří proti skriptu, aby nový stav nezůstal „neznámý".
 */
export const STAVY_FIREWALLU = Object.freeze(["STARTUJE", "NAHLED", "CEKA_NA_POTVRZENI", "MERENI", "VYNUCENO", "VRACENO", "SELHALO"]);

/** Stavy kontejneru, ve kterých neběží a nic nepublikuje. Cokoli jiného (i neznámé) se bere jako běžící. */
const NEBEZI = Object.freeze(["exited", "created", "dead"]);

/**
 * Výpis kontejnerů uzlu — jen čtení; přesně příkaz, jehož výstup je změřený
 * (`docker ps -a --format '{{json .}}'`, `--all` je dlouhý zápis `-a`). I zastavený
 * firewall je tak kotva (a jeho stav se pak přizná jako neměřený).
 */
export const PRIKAZ_VYPISU = Object.freeze(["ps", "--all", "--format", "{{json .}}"]);
/** Stav kontejneru včetně výstupů healthchecku — jen čtení. */
export const prikazInspekce = (jmeno) => ["inspect", "--type", "container", "--format", "{{json .State}}", jmeno];

/** Strop jednoho volání dockeru přes SSH — zaseknuté spojení je NEZMĚŘENO, ne čekání bez konce. */
const STROP_DOCKER_MS = 30_000;

const prvniRadek = (t) => String(t ?? "").trim().split("\n")[0].slice(0, 160);

/** Je to kontejner proxy serveru? Ve swarmu nese úloha služby příponu `.<pořadí>.<id>`. */
export function jeProxyServeru(jmeno) {
  const j = String(jmeno ?? "").replace(/^\//, "");
  return JMENA_PROXY.some((p) => j === p || j.startsWith(`${p}.`));
}

/**
 * Sloupec `Ports` z `docker ps` („0.0.0.0:80->80/tcp, [::]:80->80/tcp, 8000/tcp")
 * na publikované porty. Čte se PŘESNĚ tvar, který docker tiskne (viz hlavička):
 *   publikovaná položka   `<adresa hostitele>:<port>-><cíl>/<protokol>`
 *                         (adresa IPv4, nebo IPv6 v hranatých závorkách)
 *   jen vystavená položka `<port>/<protokol>` — bez adresy a šipky, publikovaná není
 * Cokoli jiného (šipka jiným znakem, položka bez cíle nebo bez protokolu, adresa
 * v jiném zápisu) je výjimka: neznámý tvar se nehádá ani tiše nezahazuje —
 * zahozený by z nálezu udělal „nic nepublikuje".
 */
export function publikovanePorty(text) {
  const out = [];
  for (const kus of String(text ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (/^\d+(?:-\d+)?\/[a-z]+$/.test(kus)) continue;
    const m = /^(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]):(\d+(?:-\d+)?)->\d+(?:-\d+)?\/([a-z]+)$/.exec(kus);
    if (!m) throw new Error(`zápisu portu '${kus}' nerozumím`);
    out.push({ adresa: m[1], port: m[2], proto: m[3] });
  }
  return out;
}

/**
 * Výpis `docker ps --format '{{json .}}'` (řádek = kontejner) → kontejnery.
 * Řádek, který není objekt JSON s poli Names, Ports a State jako řetězci (tak je
 * docker vydává — prázdné porty jsou prázdný řetězec), je výjimka: stav ani porty
 * se z jiných polí neodvozují.
 */
export function rozeberVypis(text) {
  const out = [];
  for (const radek of String(text ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) {
    let z;
    try {
      z = JSON.parse(radek);
    } catch {
      throw new Error(`řádek výpisu není JSON ('${radek.slice(0, 60)}')`);
    }
    if (z === null || typeof z !== "object" || typeof z.Names !== "string" || z.Names.trim() === "") {
      throw new Error("řádek výpisu nenese jméno kontejneru (Names)");
    }
    if (typeof z.Ports !== "string") throw new Error(`řádek kontejneru '${z.Names}' nenese porty (Ports) jako řetězec`);
    if (typeof z.State !== "string" || z.State.trim() === "") throw new Error(`řádek kontejneru '${z.Names}' nenese stav (State)`);
    // Sítě: bez nich nejde poznat síť hostitele, kde výpis porty neukáže (F1) — chybějící = výjimka.
    if (typeof z.Networks !== "string") throw new Error(`řádek kontejneru '${z.Names}' nenese sítě (Networks) jako řetězec`);
    out.push({
      jmena: z.Names.split(",").map((x) => x.trim().replace(/^\//, "")).filter(Boolean),
      porty: publikovanePorty(z.Ports),
      stav: z.State.trim().toLowerCase(),
      site: z.Networks.split(",").map((x) => x.trim()).filter(Boolean),
    });
  }
  return out;
}

/**
 * Stav firewallu z `docker inspect --format '{{json .State}}'` jeho kontejneru:
 * poslední výstup healthchecku (`hostfw.sh --zdravi` → `stav <STAV>[: důvod]`).
 * Co z něj nejde přečíst (kontejner neběží, healthcheck ještě neproběhl, neznámý
 * stav, jiná hláška healthchecku), je `stav: null` s důvodem — nikdy odhad.
 *
 * @param {{ rc: number, vystup: string, chyba?: string }|null|undefined} inspekce
 * @returns {{ stav: string|null, duvod: string|null }}
 */
export function stavFirewalluZInspekce(inspekce) {
  if (!inspekce) return { stav: null, duvod: "stav kontejneru firewallu nikdo nečetl" };
  if (inspekce.rc !== 0) {
    return { stav: null, duvod: `docker inspect kontejneru firewallu skončil kódem ${inspekce.rc} (${prvniRadek(inspekce.chyba || inspekce.vystup) || "bez výstupu"})` };
  }
  let s;
  try {
    s = JSON.parse(String(inspekce.vystup).trim());
  } catch {
    return { stav: null, duvod: "výstup docker inspect kontejneru firewallu není JSON" };
  }
  if (s === null || typeof s !== "object") return { stav: null, duvod: "docker inspect nevydal stav kontejneru firewallu" };
  if (s.Status !== "running") {
    return { stav: null, duvod: `kontejner firewallu neběží (${s.Status ?? "stav neznámý"}) — pravidla po jeho ukončení zůstávají, z kontejneru je nejde přečíst` };
  }
  const log = s.Health?.Log;
  if (!Array.isArray(log) || log.length === 0) return { stav: null, duvod: "healthcheck kontejneru firewallu ještě neproběhl" };
  const hlaska = prvniRadek(log[log.length - 1]?.Output);
  const m = /^stav ([A-Z_]+)(?::|$)/.exec(hlaska);
  if (!m || !STAVY_FIREWALLU.includes(m[1])) return { stav: null, duvod: `healthcheck firewallu nehlásí známý stav ('${hlaska}')` };
  return { stav: m[1], duvod: null };
}

/**
 * Posudek výpisu kontejnerů jednoho uzlu. ČISTÁ funkce: vstupem je, co vrátil
 * docker (kód + text) a deklarace portů uzlu (port meshe), výstupem řádky
 * protokolu a měřený stav firewallu.
 *
 * Nález = port publikovaný mimo loopback a mimo deklaraci (jeDeklarovanyPort),
 * u KTERÉHOKOLI kontejneru výpisu — jméno rozhoduje jen o druhu a hlášce. A běžící
 * kontejner v síti hostitele, který není mezi `sitHostitele` (jména kontejnerů
 * služeb s katalogovým `sit_hostitele` — firewall hostitele).
 *
 * @param {{ slot: string, jmenoFirewallu: string,
 *   vypis: { rc: number, vystup: string, chyba?: string },
 *   inspekce?: { rc: number, vystup: string, chyba?: string }|null,
 *   meshPort?: number|null, sitHostitele?: string[] }} vstup
 * @returns {{ vysledek: "ok"|"nalez"|"nemereno", radky: string[], firewall: { stav: string|null, duvod: string|null } }}
 */
export function posudUzel({ slot, jmenoFirewallu, vypis, inspekce = null, meshPort = null, sitHostitele = [] }) {
  const nemereno = (duvod) => ({
    vysledek: "nemereno",
    radky: [`? ${slot}: proxy na uzlu NEZMĚŘENA — ${duvod}`],
    firewall: { stav: null, duvod },
  });
  if (!vypis || vypis.rc !== 0) {
    return nemereno(`výpis kontejnerů uzlu skončil kódem ${vypis?.rc ?? "?"} (${prvniRadek(vypis?.chyba || vypis?.vystup) || "bez výstupu"})`);
  }
  let kontejnery;
  try {
    kontejnery = rozeberVypis(vypis.vystup);
  } catch (e) {
    return nemereno(`výpis kontejnerů uzlu nejde přečíst: ${e.message}`);
  }
  const proxy = kontejnery.filter((k) => k.jmena.some(jeProxyServeru));
  const publikuje = proxy.filter((k) => k.porty.length > 0);
  const popisPortu = (k) => [...new Set(k.porty.map((p) => `${p.port}/${p.proto}`))].join(", ");

  // KOTVA: bez kontejneru firewallu výpis nedokazuje nic — ani „proxy tu není".
  if (!kontejnery.some((k) => k.jmena.includes(jmenoFirewallu))) {
    const videno = publikuje.length ? `; proxy '${publikuje[0].jmena[0]}' ve výpisu JE a publikuje ${popisPortu(publikuje[0])}` : "";
    return nemereno(
      `ve výpisu (${kontejnery.length} kontejnerů) chybí kotva, kontejner firewallu hostitele '${jmenoFirewallu}' — ` +
        `bez ní výpis nedokazuje, že patří uzlu, kam se nasazuje (před prvním nasazením firewallu je to očekávané)${videno}`,
    );
  }
  const firewall = stavFirewalluZInspekce(inspekce);
  const radky = [
    `· ${slot}: firewall hostitele '${jmenoFirewallu}' — ${firewall.stav ? `stav ${firewall.stav} (měřeno: healthcheck kontejneru)` : `stav NEZMĚŘEN (${firewall.duvod})`}`,
  ];
  const deklarace = meshPort !== null
    ? `deklarace uzlu: jediná výjimka UDP ${meshPort} meshe (ACCEL_FW_UDP_MESH_PORT)`
    : "deklarace uzlu: žádná výjimka — UDP port meshe (ACCEL_FW_UDP_MESH_PORT) nedeklarován, UDP zavřeno";
  const popis = (porty) => [...new Set(porty.map((p) => `${p.port}/${p.proto}`))].join(", ");
  let nalez = false;
  // KAŽDÝ kontejner výpisu, ne jen proxy podle jména (R1): co je publikované mimo
  // loopback a mimo deklaraci, je vystavené, jakmile firewall ustoupí.
  for (const k of kontejnery) {
    // F1: síť hostitele — naslouchá přímo na rozhraních stroje, porty výpis neukáže.
    if (k.site.includes("host") && !NEBEZI.includes(k.stav) && !k.jmena.some((j) => sitHostitele.includes(j))) {
      nalez = true;
      radky.push(
        k.jmena.some(jeProxyServeru)
          ? `✗ ${DRUH_NALEZU_PROXY}: ${slot}: kontejner proxy serveru '${k.jmena[0]}' běží v SÍTI HOSTITELE — naslouchá přímo na rozhraních stroje a výpis porty neukáže; ` +
              "proxy je vystavená, jakmile firewall ustoupí (typ 'none' v API Coolify kontejner nezastaví)"
          : `✗ ${DRUH_NALEZU_PORTU}: ${slot}: kontejner '${k.jmena[0]}' běží v SÍTI HOSTITELE — naslouchá přímo na rozhraních stroje a výpis porty neukáže; ` +
              "není služba s pojmenovaným důvodem `sit_hostitele` v katalogu — vystavený, jakmile firewall ustoupí, bez ohledu na režim firewallu",
      );
    }
    const venku = k.porty.filter((p) => !jeLoopback(p.adresa));
    const mesh = venku.filter((p) => jeDeklarovanyPort(p, meshPort));
    const mimo = venku.filter((p) => !jeDeklarovanyPort(p, meshPort));
    if (mesh.length > 0) {
      radky.push(`· ${slot}: kontejner '${k.jmena[0]}' publikuje UDP ${meshPort} — deklarovaný port meshe (ACCEL_FW_UDP_MESH_PORT), jediná výjimka: firewall ho propouští v každém režimu`);
    }
    if (mimo.length === 0) continue;
    nalez = true;
    if (k.jmena.some(jeProxyServeru)) {
      radky.push(
        `✗ ${DRUH_NALEZU_PROXY}: ${slot}: kontejner proxy serveru '${k.jmena[0]}' publikuje ${popis(mimo)} — proxy BĚŽÍ a je vystavená, ` +
          "jakmile firewall ustoupí; nález platí bez ohledu na režim firewallu (typ 'none' v API Coolify kontejner nezastaví, shoda typu v API nestačí)",
      );
    } else {
      radky.push(
        `✗ ${DRUH_NALEZU_PORTU}: ${slot}: kontejner '${k.jmena[0]}' publikuje ${popis(mimo)} na ${[...new Set(mimo.map((p) => p.adresa))].join(", ")} ` +
          `mimo loopback a mimo deklaraci (${deklarace}) — vystavený, jakmile firewall ustoupí; nález platí bez ohledu na režim firewallu i na jméno kontejneru`,
      );
    }
  }
  // Běžící proxy bez publikovaných portů: dřív NEZMĚŘENO (síť hostitele výpis neukazoval).
  // Síť hostitele se teď čte z Networks (F1 výš) — mimo ni bez portů nic nevystavuje.
  if (nalez) return { vysledek: "nalez", radky, firewall };
  radky.push(
    `✓ ${slot}: žádný kontejner proxy serveru (${JMENA_PROXY.join(", ")}) ani jiný kontejner nepublikuje port mimo loopback a mimo deklaraci ` +
      `(${deklarace}) a v síti hostitele běží jen služby s důvodem sit_hostitele — výpis ${kontejnery.length} kontejnerů, kotva '${jmenoFirewallu}'`,
  );
  return { vysledek: "ok", radky, firewall };
}

/** Proměnné, které šablona compose čte (`${X}`, `${X:-d}`, `$X`). */
function promenneSablony(sablona) {
  return [...String(sablona).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
}

/**
 * Jméno kontejneru firewallu hostitele: `container_name` jeho služby v compose,
 * který katalog u služby vede, nad hodnotami instance. Nesloží-li se (chybí
 * identita vrstvy), je to `jmeno: null` s důvodem — kotva se nehádá.
 *
 * @returns {Promise<{ jmeno: string|null, duvod: string|null }>}
 */
export async function jmenoKontejneruFirewallu({ cti, sluzby, koren = REPO_ROOT }) {
  return jmenoKontejneruSluzby({ id: SLUZBA_FIREWALLU, cti, sluzby, koren });
}

/**
 * Jméno kontejneru služby katalogu: `container_name` služby téhož id v compose, který
 * katalog u služby vede, nad hodnotami instance. Nesloží-li se, `jmeno: null` s důvodem.
 *
 * @returns {Promise<{ jmeno: string|null, duvod: string|null }>}
 */
export async function jmenoKontejneruSluzby({ id, cti, sluzby, koren = REPO_ROOT }) {
  const kdo = id === SLUZBA_FIREWALLU ? "firewallu" : `služby ${id}`;
  const compose = sluzby?.[id]?.compose;
  if (!compose) return { jmeno: null, duvod: `katalog u služby ${id} nevede compose — jméno jejího kontejneru neznám` };
  let sablona;
  try {
    const { parse } = await import("yaml");
    sablona = parse(readFileSync(join(koren, compose), "utf8"))?.services?.[id]?.container_name;
  } catch (e) {
    return { jmeno: null, duvod: `compose ${compose} nejde přečíst (${prvniRadek(e.message)})` };
  }
  if (typeof sablona !== "string" || sablona.trim() === "") {
    return { jmeno: null, duvod: `služba ${id} v ${compose} nemá container_name — kontejner ${kdo} nemá čím poznat` };
  }
  const chybi = promenneSablony(sablona).filter((k) => String(cti(k) ?? "").trim() === "");
  if (chybi.length > 0) return { jmeno: null, duvod: `jméno kontejneru ${kdo} (${sablona}) nejde složit — bez hodnoty: ${chybi.join(", ")}` };
  const { interpoluj } = await import("./dvere-soulad.mjs");
  const jmeno = interpoluj(sablona, cti).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(jmeno)) return { jmeno: null, duvod: `'${jmeno}' (z ${sablona}) není jméno kontejneru` };
  return { jmeno, duvod: null };
}

/**
 * Kam se na uzel slotu sahá přes SSH: `hostname` slotu v registru nad hodnotami
 * instance. Kandidáti jako u doktora (`_ssh_docker_target`): jméno tak, jak je
 * deklarované, a malými písmeny — slot nese jméno serveru v Coolify, SSH cíl bývá
 * totéž v jiné velikosti; vezme se ten, který odpoví.
 *
 * @returns {{ kandidati: string[], duvod: string|null }}
 */
export function cileSsh({ slot, servers, cti }) {
  const sablona = servers?.[slot]?.hostname;
  if (typeof sablona !== "string" || sablona.trim() === "") return { kandidati: [], duvod: `slot '${slot}' nemá v registru hostname` };
  const chybi = promenneSablony(sablona).filter((k) => String(cti(k) ?? "").trim() === "");
  if (chybi.length > 0) return { kandidati: [], duvod: `hostname slotu '${slot}' neznám — bez hodnoty: ${chybi.join(", ")}` };
  const jmeno = sablona.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, k) => String(cti(k)).trim());
  // Jméno jde do `ssh://<jméno>` — nic než jméno hostitele (žádný přepínač, mezera ani cesta).
  if (!/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(jmeno)) return { kandidati: [], duvod: `hostname slotu '${slot}' ('${jmeno}') není použitelný jako cíl SSH` };
  return { kandidati: [...new Set([jmeno, jmeno.toLowerCase()])], duvod: null };
}

/** `docker -H ssh://<cíl> …` — jen čtení. Selhání spuštění i vypršení stropu je kód, ne výjimka. */
export function spustDocker(cil, argumenty, { timeoutMs = STROP_DOCKER_MS } = {}) {
  return new Promise((hotovo) => {
    let out = "";
    let err = "";
    let p;
    try {
      p = spawn("docker", ["-H", `ssh://${cil}`, ...argumenty], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      hotovo({ rc: 127, vystup: "", chyba: `docker nejde spustit (${e.message})` });
      return;
    }
    // Po vypršení stropu se odpovídá HNED, ne až po zavření rour: osiřelý potomek
    // (ssh čekající na heslo) by je držel a měření by nikdy neskončilo.
    const strop = setTimeout(() => {
      p.kill("SIGKILL");
      hotovo({ rc: 124, vystup: out, chyba: `bez odpovědi do ${timeoutMs} ms — ukončeno` });
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(strop);
      hotovo({ rc: 127, vystup: out, chyba: `docker nejde spustit (${e.message})` });
    });
    p.on("close", (kod, signal) => {
      clearTimeout(strop);
      hotovo({ rc: kod ?? 1, vystup: out, chyba: signal ? `ukončeno signálem ${signal}` : err });
    });
  });
}

/**
 * Změří JEDEN uzel: výpis kontejnerů (kotva, publikované porty proti deklaraci,
 * proxy) a stav firewallu → posudek. Deklarace portů uzlu (port meshe) se čte
 * z hodnot instance (portMeshe). Co nejde zjistit (jméno kontejneru firewallu,
 * hostname slotu, odpověď dockeru), je NEZMĚŘENO s důvodem.
 *
 * @param {{ slot: string, servers: object, sluzby: object, cti: (k: string) => string|undefined,
 *   docker?: typeof spustDocker, koren?: string }} vstup
 * @returns {Promise<{ vysledek: "ok"|"nalez"|"nemereno", radky: string[], firewall: { stav: string|null, duvod: string|null } }>}
 */
export async function zmerUzel({ slot, servers, sluzby, cti, docker = spustDocker, koren = REPO_ROOT }) {
  const nemereno = (duvod) => ({ vysledek: "nemereno", radky: [`? ${slot}: proxy na uzlu NEZMĚŘENA — ${duvod}`], firewall: { stav: null, duvod } });
  const fw = await jmenoKontejneruFirewallu({ cti, sluzby, koren });
  if (!fw.jmeno) return nemereno(fw.duvod);
  const { kandidati, duvod } = cileSsh({ slot, servers, cti });
  if (kandidati.length === 0) return nemereno(duvod);
  const pokusy = [];
  for (const cil of kandidati) {
    const vypis = await docker(cil, [...PRIKAZ_VYPISU]);
    if (vypis.rc !== 0) {
      pokusy.push(`${cil}: kód ${vypis.rc} (${prvniRadek(vypis.chyba || vypis.vystup) || "bez výstupu"})`);
      continue;
    }
    const inspekce = await docker(cil, prikazInspekce(fw.jmeno));
    return posudUzel({ slot, jmenoFirewallu: fw.jmeno, vypis, inspekce, meshPort: portMeshe(cti), sitHostitele: await kontejneryVSitiHostitele({ cti, sluzby, koren }) });
  }
  return nemereno(`výpis kontejnerů přes \`docker -H ssh://…\` neodpověděl — ${pokusy.join("; ")}`);
}

/**
 * Jména kontejnerů, které smí běžet v síti hostitele: služby katalogu s pojmenovaným
 * důvodem `sit_hostitele` (dnes jen firewall hostitele). Výjimka má jeden domov —
 * katalog; služba, jejíž jméno kontejneru nejde složit, výjimku nedostane (přísněji).
 *
 * @returns {Promise<string[]>}
 */
export async function kontejneryVSitiHostitele({ cti, sluzby, koren = REPO_ROOT }) {
  const out = [];
  for (const [id, s] of Object.entries(sluzby ?? {})) {
    if (typeof s?.sit_hostitele !== "string" || s.sit_hostitele.trim() === "") continue;
    const { jmeno } = await jmenoKontejneruSluzby({ id, cti, sluzby, koren });
    if (jmeno) out.push(jmeno);
  }
  return out;
}

/**
 * Změří všechny uzly s firewallem hostitele.
 *
 * @param {{ servers: object, sluzby: object, cti: (k: string) => string|undefined,
 *   docker?: typeof spustDocker, koren?: string }} vstup
 * @returns {Promise<{ radky: string[], kod: number,
 *   uzly: Record<string, { vysledek: string, firewall: { stav: string|null, duvod: string|null } }> }>}
 */
export async function zmerUzly({ servers, sluzby, cti, docker = spustDocker, koren = REPO_ROOT }) {
  const radky = [];
  const uzly = {};
  const sloty = slotyFirewallu({ sluzby, cti });
  if (sloty.length === 0) {
    radky.push(`· firewall hostitele (${SLUZBA_FIREWALLU}) se nenasazuje (lane zavřená) — žádný uzel, na kterém měřit kontejner proxy`);
    return { radky, kod: 0, uzly };
  }
  for (const slot of sloty) {
    const u = await zmerUzel({ slot, servers, sluzby, cti, docker, koren });
    uzly[slot] = { vysledek: u.vysledek, firewall: u.firewall };
    radky.push(...u.radky);
  }
  const vysledky = Object.values(uzly).map((u) => u.vysledek);
  const mereno = vysledky.filter((v) => v !== "nemereno").length;
  const kod = vysledky.includes("nalez") ? 1 : mereno === 0 ? 2 : mereno < vysledky.length ? 3 : 0;
  return { radky, kod, uzly };
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const hodnota = (p) => {
    const i = argv.indexOf(p);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  (async () => {
    const zname = ["--env-soubor", "--json"];
    const neznamy = argv.find((a, i) => a.startsWith("--") ? !zname.includes(a) : argv[i - 1] !== "--env-soubor");
    if (neznamy !== undefined) {
      console.log(`? proxy na uzlu NEZMĚŘENA: neznámý argument '${neznamy}' (použití: kontejnery-uzlu.mjs [--env-soubor <soubor>] [--json])`);
      return 2;
    }
    const cti = ctenarHodnot(hodnota("--env-soubor"));
    const { radky, kod, uzly } = await zmerUzly({ servers: nactiSloty(), sluzby: nactiKatalog(), cti });
    if (argv.includes("--json")) process.stdout.write(`${JSON.stringify({ kod, radky, uzly }, null, 2)}\n`);
    else for (const r of radky) console.log(r);
    return kod;
  })().then(
    (kod) => process.exit(kod),
    (e) => {
      console.log(`? proxy na uzlu NEZMĚŘENA: ${e.message}`);
      process.exit(2);
    },
  );
}
