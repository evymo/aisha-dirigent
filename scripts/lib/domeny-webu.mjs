#!/usr/bin/env node
/**
 * domeny-webu.mjs — veřejné domény webu instance. JEDEN domov výkladu.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (ostrý cold-start forku s víc značkami): krok 4
 * cold-startu `coolify-domain-doctor.mjs --apply` přepsal službě
 * `web` aplikace `<prefix>-edge` domény na jediné `https://${APP_DOMAIN}`
 * („domain drift: web -> …"). Deklarace instance přitom měla ve `WEB_FQDNS`
 * třináct jmen — a deploy-init je o krok dřív zapsal správně.
 *
 * PŘÍČINA: dva výklady TÉŽE deklarace. Deploy-init skládal
 * `${WEB_FQDNS:-https://${APP_DOMAIN}}` (+ aliasy a apex jen bez WEB_FQDNS),
 * doktor domén `APP_DOMAIN + AISHA_WEB_PUBLIC_ALIASES + apex` a `WEB_FQDNS`
 * neznal vůbec. Doktor běží až po deploy-initu, takže jeho užší výklad vyhrál —
 * a každá instance s víc značkami přišla při každém cold-startu o routy značek
 * (Traefik 404, žádný certifikát). Každé místo samo o sobě vypadalo správně;
 * rozpor žil MEZI nimi.
 *
 * ⭐ PRAVIDLO (sjednoceno na obecnější stranu — žádné jméno, které dnes zapisuje
 * kterýkoli z obou nástrojů, se neztratí):
 *   1. `WEB_FQDNS` (deklarovaný seznam značek, overlay instance) jde PRVNÍ,
 *      v deklarovaném pořadí;
 *   2. pak kanonický `https://${APP_DOMAIN}` (na něj míří i 308 z apexu);
 *   3. pak aliasy `AISHA_WEB_PUBLIC_ALIASES` → `https://<alias>.${PUBLIC_TLD}`;
 *   4. pak apex `https://${PUBLIC_TLD}`, jen v režimu `AISHA_WEB_APEX_MODE=serve`
 *      a jen když se liší od APP_DOMAIN (v režimu redirect patří edge-proxy);
 *   bez duplicit (první výskyt vyhrává), hostitel malými písmeny.
 * Dřív deploy-init při deklarovaném WEB_FQDNS kroky 2–4 vynechal, kdežto doktor
 * je při každém cold-startu přepsal zpět — jména z kroků 2–4 tedy instance
 * dostávala vždy (posledním zapisovatelem byl doktor). Sjednocení nepřidává
 * jméno, které by žádný z nástrojů dřív nezapsal.
 *
 * ⛔ „NEVÍM" NENÍ „NIC". Prázdný `WEB_FQDNS` znamená instanci s jednou značkou;
 * NEPŘÍTOMNÝ (klíč ve čtenáři vůbec není) nebo nerozbalený (`${…}`) znamená, že
 * volající běží bez deklarace instance. Složit z toho užší seznam a zapsat ho by
 * smazalo routy značek; přesně to se stalo. Domov proto v takovém případě nevydá
 * NIC a řekne proč (`znamo: false`). Totéž platí pro chybějící `APP_DOMAIN`
 * a pro `PUBLIC_TLD`, je-li potřeba (aliasy, apex).
 *
 * ⚠️ KDE TO ROZLIŠENÍ OPRAVDU FUNGUJE — a kde ne. „Chybí = nevím" pozná jen
 * čtenář, který dostane SUROVÉ prostředí: doktor domén puštěný bez exportu
 * deklarace (vrstva config/domains.env mu `WEB_FQDNS=${WEB_FQDNS:-}` nechá jako
 * nerozbalenou šablonu). V bashi (cold-start, deploy-init) se chybějící hodnota
 * po `set -a; . config/domains.env` stane PRÁZDNOU — a prázdná znamená „jedna
 * značka". Overlay, který cold-start hledal a nenašel, proto dnes jen varuje
 * („Domain overlay … requested but not found", aisha-cold-start.sh) a oba
 * zapisovatelé pak shodně složí jen APP_DOMAIN. NAVAZUJÍCÍ PRÁCE (tady se neřeší):
 * vyžádaný a nenalezený overlay má cold-start zastavit, ne varovat.
 * Samostatné běhy (redeploy, ruční doktor nad `.env.coolify`) dostanou deklaraci
 * od env-doktora: ten WEB_FQDNS zapíše do `.env.coolify` jako odvozený klíč
 * (lib/domenovy-overlay.mjs, týž rozklad overlaye jako cold-start), při každém
 * běhu znovu; když deklaraci znát nemůže, nezapíše nic a skončí 2.
 *
 * ⛔ NEPLATNÁ DEKLARACE SE NEOHÝBÁ. Položka WEB_FQDNS, která není
 * `http(s)://hostitel[:port][/]` (schéma i hostitel bez ohledu na velikost
 * písmen — normalizuje je URL; cesta, dotaz, fragment, přihlašovací údaje ani
 * zástupný `*` ne), nebo alias, který není jedním DNS štítkem — dřív je nástroje
 * potichu přeskočily nebo poslaly do Coolify, jak byly. Teď je to vada
 * deklarace: nic se neskládá, důvody se vypíšou.
 *
 * ⭐ REŽIM APEXU MÁ JEDEN NORMALIZÁTOR: `normalizeApexMode` z derive-domains.mjs
 * (import, ne kopie) — týž, kterým derivace vydává `AISHA_WEB_APEX_MODE`
 * (serve | web | spa bez ohledu na velikost → serve, jinak redirect). Dřív tu
 * platilo jen přesné serve|redirect: deploy-init dostával hodnotu už
 * normalizovanou derivací, doktor surovou z .env.coolify / operátorského trezoru —
 * u instance s `web` by deploy-init zapsal a doktor edge pokaždé zablokoval.
 * Obecnější strana je normalizátor derivace: přijímá vše, co derivace přijímá
 * dnes, takže žádná instance, která se dnes odvodí, nespadne. Odmítat v derivaci
 * by z dnes fungujících hodnot udělalo pád cold-startu. Tentýž režim čte i
 * edge-proxy (apex v režimu redirect) — doktor i deploy-init přes `rezimApexu`.
 *
 * Čtou: coolify-domain-doctor.mjs (funkce), coolify-deploy-init.sh (CLI níž).
 * Brána `domeny-webu-jeden-domov` hlídá, že nikdo jiný domény webu neskládá.
 *
 * CLI (čte prostředí procesu — deploy-init si deklaraci načetl sám):
 *   node domeny-webu.mjs --csv
 *     → stdout: `https://…,https://…` (kód 0)
 *     → kód 1: neplatná deklarace · kód 2: nevím (vstup chybí) — stdout prázdný,
 *       důvody na stderr. VERDIKT JE KÓD, ne text.
 *   node domeny-webu.mjs --rezim-apexu
 *     → stdout: `serve` | `redirect` (kód 0); nerozbalená šablona → kód 2
 *
 * @module
 */
import { isDirectRun } from "./cli-entry.mjs";
import { normalizeApexMode } from "./derive-domains.mjs";

/** Klíče deklarace, ze kterých se domény webu skládají (a nic jiného). */
export const KLICE_DEKLARACE_WEBU = Object.freeze([
  "WEB_FQDNS",
  "APP_DOMAIN",
  "AISHA_WEB_PUBLIC_ALIASES",
  "AISHA_WEB_APEX_MODE",
  "PUBLIC_TLD",
]);

export const KOD_NEPLATNE = 1;
export const KOD_NEVIM = 2;

const STITEK = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTITEL = new RegExp(`^${STITEK}(?:\\.${STITEK})+$`);
const ALIAS = new RegExp(`^${STITEK}$`);

const nerozbaleno = (hodnota) => typeof hodnota === "string" && hodnota.includes("${");

/**
 * Položka WEB_FQDNS → `schéma://hostitel[:port]`, nebo null.
 *
 * Schéma i hostitel se porovnávají bez ohledu na velikost písmen — `HTTPS://Host`
 * je táž adresa; normalizuje ji URL (malá písmena, výchozí port pryč, IDN na
 * punycode). Koncové `/` je prázdná cesta (týž origin; keycloak sync ho
 * odjakživa odřezává). Odmítá se vše, co by z položky udělalo jinou adresu nebo
 * router, který nikdo nedeklaroval: chybějící `//`, jiné schéma, cesta, dotaz,
 * fragment, přihlašovací údaje a zástupný `*` (URL ho v hostiteli propustí,
 * odmítne ho až HOSTITEL).
 */
function polozkaSeznamu(polozka) {
  if (!/^https?:\/\//i.test(polozka) || /[?#\s]/.test(polozka)) return null;
  let url;
  try {
    url = new URL(polozka);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.pathname !== "/") return null;
  if (!HOSTITEL.test(url.hostname)) return null;
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
}

/** Režim apexu webu: TENTÝŽ normalizátor jako derivace (serve | redirect). */
export function rezimApexu(env) {
  return normalizeApexMode(env.AISHA_WEB_APEX_MODE);
}

function seznam(hodnota) {
  return String(hodnota ?? "")
    .split(",")
    .map((polozka) => polozka.trim())
    .filter(Boolean);
}

/**
 * Domény webu z deklarace instance.
 *
 * @param {Record<string, string | undefined>} env — čtenář hodnot (prostředí procesu,
 *   nebo vrstvy, které si volající poskládal). Klíč, který v něm NENÍ, je „nevím".
 * @returns {{ znamo: true, domeny: string[], zdroj: "WEB_FQDNS" | "APP_DOMAIN" }
 *   | { znamo: false, nevim: string[], neplatne: string[] }}
 */
export function verejneDomenyWebu(env) {
  const nevim = [];
  const neplatne = [];

  // 1. Deklarovaný seznam značek.
  const webFqdns = [];
  const surovyFqdns = env.WEB_FQDNS;
  if (surovyFqdns === undefined) {
    nevim.push(
      "WEB_FQDNS v prostředí NENÍ — deklarace instance (overlay) se nenačetla; " +
        "prázdná hodnota by znamenala jednu značku, chybějící znamená „nevím“",
    );
  } else if (nerozbaleno(surovyFqdns)) {
    nevim.push(`WEB_FQDNS je nerozbalená šablona (${surovyFqdns}) — deklarace instance se nenačetla`);
  } else {
    for (const polozka of seznam(surovyFqdns)) {
      const adresa = polozkaSeznamu(polozka);
      if (!adresa) {
        neplatne.push(`WEB_FQDNS: „${polozka}“ není http(s)://hostitel[:port] (bez cesty, dotazu a *)`);
        continue;
      }
      webFqdns.push(adresa);
    }
  }

  // 2. Kanonický host.
  const appDomain = env.APP_DOMAIN;
  if (appDomain === undefined || appDomain === "" || nerozbaleno(appDomain)) {
    nevim.push(`APP_DOMAIN chybí${nerozbaleno(appDomain) ? ` (nerozbalená šablona ${appDomain})` : ""} — kanonický host webu neznám`);
  } else if (!HOSTITEL.test(appDomain.toLowerCase())) {
    neplatne.push(`APP_DOMAIN: „${appDomain}“ není hostitel`);
  }

  // 3. Aliasy pod veřejnou zónou. Nepřítomné = žádné (volitelná data operátora,
  //    .env.coolify je nese — aisha-env-doctor je tam doručuje).
  const aliasy = [];
  const surove = env.AISHA_WEB_PUBLIC_ALIASES;
  if (nerozbaleno(surove)) {
    nevim.push(`AISHA_WEB_PUBLIC_ALIASES je nerozbalená šablona (${surove})`);
  } else {
    for (const polozka of seznam(surove)) {
      const alias = polozka.toLowerCase();
      if (!ALIAS.test(alias)) {
        neplatne.push(`AISHA_WEB_PUBLIC_ALIASES: „${polozka}“ není jeden DNS štítek`);
        continue;
      }
      aliasy.push(alias);
    }
  }

  // 4. Režim apexu — normalizátor derivace (viz hlavička). Nerozbalená šablona = nevím:
  //    normalizátor by z ní potichu udělal redirect.
  const surovyRezim = env.AISHA_WEB_APEX_MODE;
  if (nerozbaleno(surovyRezim)) nevim.push(`AISHA_WEB_APEX_MODE je nerozbalená šablona (${surovyRezim})`);
  const rezim = rezimApexu(env);

  // 5. Veřejná zóna — jen když ji aliasy nebo apex potřebují.
  const potrebujeZonu = aliasy.length > 0 || rezim === "serve";
  const zona = env.PUBLIC_TLD;
  if (potrebujeZonu) {
    if (zona === undefined || zona === "" || nerozbaleno(zona)) {
      nevim.push(`PUBLIC_TLD chybí${nerozbaleno(zona) ? ` (nerozbalená šablona ${zona})` : ""} — aliasy ani apex nejde složit`);
    } else if (!HOSTITEL.test(zona.toLowerCase())) {
      neplatne.push(`PUBLIC_TLD: „${zona}“ není hostitel`);
    }
  }

  if (nevim.length > 0 || neplatne.length > 0) return { znamo: false, nevim, neplatne };

  const kanonicky = appDomain.toLowerCase();
  const zonaMala = potrebujeZonu ? zona.toLowerCase() : "";
  const vse = [
    ...webFqdns,
    `https://${kanonicky}`,
    ...aliasy.map((alias) => `https://${alias}.${zonaMala}`),
    ...(rezim === "serve" && zonaMala !== kanonicky ? [`https://${zonaMala}`] : []),
  ];
  return {
    znamo: true,
    domeny: [...new Set(vse)],
    zdroj: webFqdns.length > 0 ? "WEB_FQDNS" : "APP_DOMAIN",
  };
}

/** Lidský výpis toho, proč domény složit nejde (pro stderr a hlášení doktoru). */
export function duvodyNeslozeni(vysledek) {
  if (vysledek.znamo) return [];
  return [
    ...vysledek.neplatne.map((d) => `NEPLATNÉ: ${d}`),
    ...vysledek.nevim.map((d) => `NEVÍM: ${d}`),
  ];
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || !["--csv", "--rezim-apexu"].includes(argv[0])) {
    process.stderr.write("použití: node scripts/lib/domeny-webu.mjs --csv | --rezim-apexu\n");
    process.exit(64);
  }
  if (argv[0] === "--rezim-apexu") {
    if (nerozbaleno(process.env.AISHA_WEB_APEX_MODE)) {
      process.stderr.write(`[domeny-webu] NEVÍM: AISHA_WEB_APEX_MODE je nerozbalená šablona (${process.env.AISHA_WEB_APEX_MODE})\n`);
      process.exit(KOD_NEVIM);
    }
    process.stdout.write(`${rezimApexu(process.env)}\n`);
    process.exit(0);
  }
  const vysledek = verejneDomenyWebu(process.env);
  if (vysledek.znamo) {
    process.stdout.write(`${vysledek.domeny.join(",")}\n`);
    process.exit(0);
  }
  process.stderr.write("[domeny-webu] domény webu NESLOŽENY — nic se nevydává:\n");
  for (const d of duvodyNeslozeni(vysledek)) process.stderr.write(`  ${d}\n`);
  process.exit(vysledek.neplatne.length > 0 ? KOD_NEPLATNE : KOD_NEVIM);
}
