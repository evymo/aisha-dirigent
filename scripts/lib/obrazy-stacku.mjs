/**
 * Obrazy, které si stack při nasazení STÁHNE — `image:` reference z jeho compose,
 * rozvinuté hodnotami, se kterými compose interpoluje Coolify.
 *
 * Proč vůbec: disková brána (lib/diskova-brana.mjs) měří potřebu stacku podle
 * obrazů jeho kontejnerů. Po selhaném nasazení ale stack kontejnery NEMÁ
 * (naměřeno 2026-09-25 na hostiteli forku: pět stacků, nula kontejnerů) a obrazy,
 * které Coolify postavil (`<uuid>_<služba>`), jsou jen část — stažené obrazy
 * (db, redis, keycloak…) prefix nemají, a u znovu nasazovaného jádra jsou právě
 * ty podstatné.
 *
 * Rozvinutí dělá jen to, co docker compose u `image:` skutečně potkává:
 * `${VAR}`, `${VAR:-výchozí}`, `${VAR-výchozí}`, `${VAR:?zpráva}`, `${VAR?zpráva}`,
 * `${VAR:+jiné}`, `$VAR` a `$$`. Co rozvinout nejde (chybějící povinná proměnná,
 * výsledek, který není referencí obrazu), vrací se zvlášť jako `nerozvinute` —
 * volající to nesmí přečíst jako „stack nic nestahuje".
 */

import { createRequire } from "node:module";

// ⛔ js-yaml se načítá AŽ při volání, ne na začátku modulu. NAMĚŘENO 2026-10-01 (main
// fa7c6d6d6, běh 4139): aisha-redeploy.mjs importuje tenhle modul staticky a nasazovací
// úlohy CI běží z řídkého checkoutu BEZ node_modules → `--print-waves` padl na
// ERR_MODULE_NOT_FOUND dřív, než se cokoli nasadilo. Balík potřebuje jen čtení compose
// (disková brána sériového nasazení), ne výpis vln. Hlídá ridky-checkout-nese-graf-importu.
const nacistYaml = () => createRequire(import.meta.url)("js-yaml");

/** Reference obrazu, kterou lze bezpečně vložit do vzdáleného příkazu. */
const REFERENCE = /^[a-z0-9][a-z0-9._\-/:@]*$/i;

export function jeReferenceObrazu(text) {
  return typeof text === "string" && text.length <= 255 && REFERENCE.test(text);
}

/**
 * Rozvine jednu hodnotu jako docker compose. Vnořené výchozí hodnoty
 * (`${A:-${B}x}`) se řeší zevnitř ven.
 *
 * @param {string} text
 * @param {(klic: string) => string | undefined} hodnota
 * @returns {string | null} rozvinutý text, nebo null (povinná proměnná chybí)
 */
export function rozvin(text, hodnota) {
  const ZASTUPNY = "\u0000DOLAR\u0000";
  let s = String(text).replaceAll("$$", ZASTUPNY);
  const VNITRNI = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^{}]*))?\}/;
  for (let krok = 0; krok < 50; krok++) {
    const m = s.match(VNITRNI);
    if (!m) break;
    const [cele, klic, operator = "", arg = ""] = m;
    const v = hodnota(klic);
    const nastaveno = v !== undefined && v !== null;
    const neprazdne = nastaveno && String(v) !== "";
    let nahrada;
    switch (operator) {
      case "": nahrada = nastaveno ? String(v) : ""; break;
      case ":-": nahrada = neprazdne ? String(v) : arg; break;
      case "-": nahrada = nastaveno ? String(v) : arg; break;
      case ":?": if (!neprazdne) return null; nahrada = String(v); break;
      case "?": if (!nastaveno) return null; nahrada = String(v); break;
      case ":+": nahrada = neprazdne ? arg : ""; break;
      case "+": nahrada = nastaveno ? arg : ""; break;
      default: return null;
    }
    s = s.replace(cele, () => nahrada);
  }
  s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => String(hodnota(k) ?? ""));
  if (s.includes("${")) return null;
  return s.replaceAll(ZASTUPNY, "$");
}

/**
 * `image:` reference compose souboru, rozvinuté.
 *
 * @param {string} composeText
 * @param {(klic: string) => string | undefined} hodnota
 * @returns {{ obrazy: string[], nerozvinute: string[] }}
 */
export function obrazyZCompose(composeText, hodnota) {
  const obrazy = new Set();
  const nerozvinute = [];
  for (const radek of String(composeText).split(/\r?\n/)) {
    const m = radek.match(/^\s+image:\s*(.+?)\s*$/);
    if (!m) continue;
    const surove = m[1].replace(/^(["'])(.*)\1$/, "$2");
    const r = rozvin(surove, hodnota);
    if (r !== null && jeReferenceObrazu(r)) obrazy.add(r);
    else nerozvinute.push(surove);
  }
  return { obrazy: [...obrazy], nerozvinute };
}

/** Jméno služby compose, které lze bezpečně vložit do vzdáleného příkazu. */
const SLUZBA = /^[a-z0-9][a-z0-9_.-]{0,62}$/i;

export function jeJmenoSluzby(text) {
  return typeof text === "string" && SLUZBA.test(text);
}

/**
 * Služby, jejichž obraz Coolify při nasazení STAVÍ (`build:`) — na uzlu z nich
 * vznikne `<uuid aplikace>_<služba>:<commit>`.
 *
 * ⛔ NAMĚŘENO 2026-09-26 (hostitel forku, jádro po selhaném nasazení a úklidu):
 * brána našla 5 obrazů ze 17 služeb a odhadla 4,8 GiB; nasazení zabralo 7,2 GiB.
 * Kolik obrazů na uzlu CHYBÍ, se z uzlu nepozná — jen proti tomu, co stack
 * deklaruje. Struktura služeb se čte parserem YAML (kotvy `<<: *common`),
 * ne řádky: u řádku nejde říct, ke které službě `build:` patří.
 *
 * @param {string} composeText
 * @returns {string[] | null} jména služeb, nebo null (compose nejde přečíst —
 *   volající to nesmí přečíst jako „stack nic nestaví")
 */
export function sluzbySeStavbou(composeText) {
  // Mimo try: chybějící balík je chyba prostředí, ne „compose nejde přečíst“ (null).
  const yaml = nacistYaml();
  let dokument;
  try {
    dokument = yaml.load(String(composeText));
  } catch {
    return null;
  }
  const sluzby = dokument?.services;
  if (!sluzby || typeof sluzby !== "object") return null;
  const jmena = Object.entries(sluzby)
    .filter(([, s]) => s && typeof s === "object" && s.build)
    .map(([jmeno]) => jmeno);
  return jmena.every(jeJmenoSluzby) ? jmena : null;
}
