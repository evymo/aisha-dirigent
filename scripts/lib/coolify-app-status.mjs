/**
 * Klasifikace stavu Coolify aplikace — JEDINÉ místo, kde se rozhoduje
 * „běží to, nebo ne".
 *
 * ⛔ PROČ TENHLE SOUBOR VZNIKL (naměřeno 2026-08-16)
 *
 * Slovo `unhealthy` OBSAHUJE slovo `healthy`. Čtyři nezávislé nástroje proto
 * posuzovaly stav podřetězcem a všechny byly FAIL-OPEN — mrtvou aplikaci
 * prohlásily za zdravou:
 *
 *   cold-start-verify.mjs     /running|healthy|online/i   → `exited:unhealthy` PROŠLO
 *   blue-green-smoke-runner   /running.*healthy/i         → `running:unhealthy` PROŠLO
 *   pki-bridge-deploy.mjs     s.includes("healthy")       → `exited:unhealthy` PROŠLO
 *   coolify-deploy-watch.mjs  startsWith("running") dřív
 *                             než includes("unhealthy")   → `running:unhealthy` PROŠLO
 *
 * Důsledek nebyl kosmetický: `npm run cold-start:verify` hlásil „0 unhealthy
 * app(s)", zatímco 18 z 34 aplikací bylo nezdravých — včetně `<fork>-edge`, což
 * je vstupní brána, kvůli které vracelo VŠECHNO veřejné 503. Měřidlo výpadek
 * nejen přehlédlo, ono ho aktivně zamaskovalo. Proto je `<fork>-monitoring`
 * mrtvý 244 dní, aniž si toho kdokoli všiml.
 *
 * PRAVIDLO: stav se porovnává po CELÝCH hodnotách, nikdy `includes`. Co není
 * výslovně rozpoznáno jako zdravé, je nezdravé — neznámý stav padá do
 * nezdravého, ne do zdravého.
 *
 * Formát, který Coolify vrací: `<stav>:<zdraví>`, např. `running:healthy`,
 * `exited:unhealthy`, `starting:unknown`. U vícekontejnerových (compose)
 * aplikací může přijít víc segmentů oddělených čárkou — pak rozhoduje ten
 * NEJHORŠÍ, protože aplikace není zdravější než její nejslabší kontejner.
 */

/** Stavy, které znamenají „proces žije". */
const STAV_BEZI = new Set(["running", "online"]);
/** Stavy, které znamenají „proces nežije". Vyjmenované, ne odvozené. */
const STAV_MRTVY = new Set(["exited", "dead", "stopped", "failed", "error", "removed"]);
/** Stavy, které znamenají „právě se to hýbe" — přechodné, ne verdikt. */
const STAV_PRECHODNY = new Set(["starting", "restarting", "created", "deploying", "restarting:unknown"]);

/**
 * Třídy od NEJHORŠÍ po nejlepší. Pořadí je významné: u vícekontejnerové
 * aplikace vyhrává nejnižší index.
 */
export const TRIDY = ["mrtva", "nezdrava", "startuje", "bez-healthchecku", "nezname", "zdrava"];

/**
 * Klasifikuje JEDEN segment `stav:zdravi`.
 * @returns {{trida: string, duvod: string}}
 */
function klasifikovatSegment(segment) {
  const [stav = "", zdravi = ""] = String(segment).trim().toLowerCase().split(":");

  // Nezdraví přebíjí i „běží" — kontejner může běžet a přitom neprocházet
  // vlastním healthcheckem. To je právě ten stav, který podřetězec propouštěl.
  if (zdravi === "unhealthy") {
    return STAV_MRTVY.has(stav)
      ? { trida: "mrtva", duvod: `${stav} a healthcheck neprochází` }
      : { trida: "nezdrava", duvod: "healthcheck neprochází" };
  }
  if (STAV_MRTVY.has(stav)) return { trida: "mrtva", duvod: `stav ${stav}` };
  if (STAV_PRECHODNY.has(stav)) return { trida: "startuje", duvod: `stav ${stav}` };

  if (STAV_BEZI.has(stav)) {
    if (zdravi === "healthy") return { trida: "zdrava", duvod: "běží a healthcheck prochází" };
    // Běží, ale žádný healthcheck nic netvrdí. To NENÍ důkaz zdraví — je to
    // NEZMĚŘENO. Volající se rozhodne sám; verdikt o úplnosti to počítá proti
    // sobě, průběžné čekání ne.
    return { trida: "bez-healthchecku", duvod: `běží, ale zdraví je '${zdravi || "neuvedeno"}'` };
  }

  return { trida: "nezname", duvod: `neznámý stav '${segment}'` };
}

/**
 * Klasifikuje celý stav aplikace (i vícekontejnerový).
 *
 * @param {string|null|undefined} raw stav z Coolify API (`app.status`)
 * @returns {{trida: string, zdrava: boolean|null, duvod: string, segmenty: string[]}}
 *   `zdrava === true`  → prokazatelně zdravá
 *   `zdrava === false` → prokazatelně nezdravá (mrtvá / neprochází healthcheck)
 *   `zdrava === null`  → NEZMĚŘENO (startuje, nebo běží bez healthchecku)
 */
export function klasifikovatStavAppky(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { trida: "nezname", zdrava: false, duvod: "stav neuveden", segmenty: [] };

  const segmenty = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (segmenty.length === 0) {
    return { trida: "nezname", zdrava: false, duvod: "stav neuveden", segmenty: [] };
  }

  let nejhorsi = { trida: "zdrava", duvod: "" };
  for (const segment of segmenty) {
    const vysledek = klasifikovatSegment(segment);
    if (TRIDY.indexOf(vysledek.trida) < TRIDY.indexOf(nejhorsi.trida)) nejhorsi = vysledek;
  }

  const zdrava =
    nejhorsi.trida === "zdrava" ? true
    : nejhorsi.trida === "startuje" || nejhorsi.trida === "bez-healthchecku" ? null
    : false;

  return { trida: nejhorsi.trida, zdrava, duvod: nejhorsi.duvod, segmenty };
}

/**
 * Prokazatelně zdravá? NEZMĚŘENO se NEpočítá jako zdravé.
 * Tohle je forma, kterou má používat každý verdikt o úplnosti nasazení.
 */
export function jeProkazatelneZdrava(raw) {
  return klasifikovatStavAppky(raw).zdrava === true;
}

/**
 * Prokazatelně špatná? Pro čekací smyčky, které mají přestat čekat až tehdy,
 * když je stav definitivní — `startuje` není důvod to vzdát.
 */
export function jeProkazatelneSpatna(raw) {
  return klasifikovatStavAppky(raw).zdrava === false;
}
