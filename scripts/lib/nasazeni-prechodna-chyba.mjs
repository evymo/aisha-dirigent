/**
 * nasazeni-prechodna-chyba.mjs — projde TENTÝŽ commit na druhý pokus?
 *
 * PROČ VZNIKL (naměřeno 2026-09-23, <fork>-core po #380)
 * ---------------------------------------------------
 * Nasazení `pc2i6yts…` spadlo na obrazu `plugin-publish-init`:
 *     npm error notarget No matching version found for @sentry/core@10.75.3.
 * Ta verze vyšla ve veřejném npm 2026-09-23T14:06:21Z; první chyba buildu je
 * 14:06:24Z. Build se trefil do okamžiku, kdy Sentry vydával balíky po jednom
 * (závislý už ukazoval na 10.75.3, ten jeho ještě nebyl vidět). Compose je jeden
 * celek, takže se nevyměnil ŽÁDNÝ kontejner — a jádro zůstalo na starém commitu,
 * dokud nasazení někdo RUČNĚ nespustil znovu. Opakování téhož commitu prošlo.
 *
 * Majitel: „potřebujeme mechanismus, který to umožní automaticky povyšovat" —
 * tedy pád, který opakování spraví, má pipeline dotáhnout sama.
 *
 * ⛔ OPAKUJE SE JEN DOLOŽENÁ PŘECHODNÁ CHYBA. Nejistota = STOP.
 * Posuzuje se jen ROZHODUJÍCÍ chyba (spadlý krok buildu), ne podpis kdekoli v logu
 * — viz `rozhodujiciBlok`.
 * Každý neznámý pád zůstává pádem: slepé „zkus to znovu" by zakrylo skutečnou
 * vadu a z červené by udělalo náhodně zelenou. Proto:
 *   · `npm-zavod-s-vydanim` — chybějící verze se DOHLEDÁ v registru: existuje
 *     a vyšla BĚHEM nasazení nebo krátce před jeho startem (výchozí okno 30 min)
 *     ⇒ závod. (Naměřeno: verze vyšla 3 min PO startu nasazení — referencí je
 *     proto interval ⟨start − okno, teď⟩, ne „před teď".) Neexistuje-li ani teď,
 *     je to chybný pin; vyšla-li dávno, je to jiná vada (třeba zastaralá cache)
 *     — obojí STOP. Nejde-li registr zeptat, je to taky STOP: bez měření se
 *     nerozhoduje.
 *   · `limit-registru` — registr odmítl pro počet požadavků (429/toomanyrequests).
 *   · `sit-registru`   — spojení k registru spadlo (reset, timeout, 502–504…).
 *   · BLOKUJE vždy: plný disk. Podpis se tváří jako síť („apt is not signed",
 *     „unexpected EOF"), ale opakování nepomůže a zakrylo by ho.
 *
 * Podpisy jsou obecné vlastnosti npm/Dockeru/BuildKitu, ne čehokoli instance.
 */
import { isDirectRun } from "./cli-entry.mjs";

/**
 * Výchozí okno „nedávného vydání" v minutách PŘED startem nasazení. Závod je vydání
 * během buildu nebo těsně před ním (šíření registru, vydávání balíků po jednom);
 * verze vydaná dřív a přesto nedostupná je jiná vada (zastaralá cache) → STOP.
 * (Recenze aisha-team 09-23: původních 120 min bylo zbytečně široké.)
 */
export const OKNO_VYDANI_MIN = 30;

/** Text logu z odpovědi Coolify (`logs` je JSON pole `{output}`), z pole nebo z řetězce. */
export function textLogu(logy) {
  let pole = logy;
  if (typeof logy === "string") {
    try {
      pole = JSON.parse(logy);
    } catch {
      return logy;
    }
  }
  if (!Array.isArray(pole)) return "";
  return pole.map((z) => String(z?.output ?? "")).join("\n");
}

const CHYBI_VERZE = /No matching version found for ((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([0-9][\w.+-]*?)\.?(?=\s|$)/gim;
const PLNY_DISK = /no space left on device/i;
const LIMIT = /toomanyrequests|429 Too Many Requests|npm error code E429/i;
const SIT = [
  /npm error code (ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ERR_SOCKET_TIMEOUT|E502|E503|E504)\b/i,
  /npm error network\b/i,
  /failed to (?:do request|fetch|resolve|copy|authorize)[^\n]*(?:i\/o timeout|TLS handshake timeout|connection reset by peer|unexpected EOF|50[234] (?:Bad Gateway|Service Unavailable|Gateway Time-?out))/i,
  /(?:dial tcp|lookup)[^\n]*(?:i\/o timeout|temporary failure in name resolution)/i,
];

/**
 * ROZHODUJÍCÍ chyba — ne „podpis kdekoli v logu".
 * ⛔ Recenze aisha-team 09-23: skutečná vada (třeba chyba TypeScriptu) + nesouvisející
 * řádek `dial tcp …: i/o timeout` z jiného kroku by se posoudily jako síť → opakování
 * nad vadou kódu. Proto se hledá jen v blocích kroků BuildKitu, které SPADLY
 * (`#<krok> ERROR: …` → všechny řádky `#<krok> …`), a v závěrečném `failed to solve`.
 * Nenajde-li se rozhodující chyba (pád mimo build: start kontejneru, healthcheck…),
 * vrací `null` → STOP.
 */
export function rozhodujiciBlok(text) {
  const radky = String(text).split("\n");
  const kroky = new Set();
  for (const r of radky) {
    const m = /^\s*#(\d+) ERROR:/.exec(r);
    if (m) kroky.add(m[1]);
  }
  const blok = radky.filter((r) => {
    const m = /^\s*#(\d+) /.exec(r);
    return (m && kroky.has(m[1])) || /failed to solve:/.test(r);
  });
  return blok.length ? blok.join("\n") : null;
}

/** Co v logu je — bez rozhodování. */
export function priznaky(text) {
  const chybiVerze = [];
  const videno = new Set();
  for (const m of String(text).matchAll(CHYBI_VERZE)) {
    const klic = `${m[1]}@${m[2]}`;
    if (videno.has(klic)) continue;
    videno.add(klic);
    chybiVerze.push({ balik: m[1], verze: m[2] });
  }
  const radky = String(text).split("\n");
  const najdi = (re) => radky.find((r) => re.test(r))?.trim().slice(0, 200) ?? null;
  return {
    chybiVerze,
    plnyDisk: najdi(PLNY_DISK),
    limit: najdi(LIMIT),
    sit: SIT.map(najdi).find(Boolean) ?? null,
  };
}

/**
 * Verdikt nad textem logu.
 * @param {string} text
 * @param {{casVydani?: (balik: string, verze: string) => Promise<Date|null|undefined>, zacatek?: Date, ted?: Date, oknoMin?: number}} opts
 *   casVydani: Date = vyšla tehdy; null = verze v registru NENÍ; undefined = registr se nepodařilo zeptat.
 *   zacatek: start nasazení (bez něj se bere `ted`).
 * @returns {Promise<{prechodna: boolean, trida: string|null, dukaz: string}>}
 */
export async function klasifikuj(text, { casVydani, zacatek, ted = new Date(), oknoMin = OKNO_VYDANI_MIN } = {}) {
  // Plný disk blokuje odkudkoli z logu — je to stav stroje, ne kroku.
  const disk = priznaky(text).plnyDisk;
  if (disk) {
    return { prechodna: false, trida: null, dukaz: `plný disk („${disk}") — opakování nepomůže, patří člověku` };
  }
  const blok = rozhodujiciBlok(text);
  if (!blok) {
    return { prechodna: false, trida: null, dukaz: "v logu není rozhodující chyba buildu (#krok ERROR / failed to solve) — pád mimo build se neopakuje" };
  }
  const p = priznaky(blok);
  if (p.chybiVerze.length) {
    if (typeof casVydani !== "function") {
      return { prechodna: false, trida: null, dukaz: "chybí verze balíku, ale čas vydání nebylo čím dohledat — bez měření se neopakuje" };
    }
    const dukazy = [];
    for (const { balik, verze } of p.chybiVerze) {
      const cas = await casVydani(balik, verze);
      if (cas === undefined) {
        return { prechodna: false, trida: null, dukaz: `${balik}@${verze}: registr se nepodařilo zeptat — bez měření se neopakuje` };
      }
      if (cas === null) {
        return { prechodna: false, trida: null, dukaz: `${balik}@${verze} v registru neexistuje ani teď — chybný pin, ne závod` };
      }
      const od = (zacatek ?? ted).getTime() - oknoMin * 60000;
      if (!(cas.getTime() >= od && cas.getTime() <= ted.getTime())) {
        return {
          prechodna: false,
          trida: null,
          dukaz: `${balik}@${verze} vyšla ${cas.toISOString()} — mimo ⟨start nasazení − ${oknoMin} min, teď⟩, není to závod s vydáním`,
        };
      }
      const vuciStartu = Math.round((cas.getTime() - (zacatek ?? ted).getTime()) / 60000);
      dukazy.push(`${balik}@${verze} vyšla ${cas.toISOString()} (${vuciStartu >= 0 ? `${vuciStartu} min PO startu` : `${-vuciStartu} min před startem`} nasazení)`);
    }
    return { prechodna: true, trida: "npm-zavod-s-vydanim", dukaz: dukazy.join("; ") };
  }
  if (p.limit) return { prechodna: true, trida: "limit-registru", dukaz: p.limit };
  if (p.sit) return { prechodna: true, trida: "sit-registru", dukaz: p.sit };
  return { prechodna: false, trida: null, dukaz: "žádný doložený podpis přechodné chyby — nejistota = STOP" };
}

/** Čas vydání verze z registru npm (`time[verze]` v dokumentu balíku). */
export async function casVydaniZRegistru(balik, verze, { registr, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const zaklad = String(registr || process.env.npm_config_registry || "https://registry.npmjs.org/").replace(/\/?$/, "/");
  const cesta = balik.startsWith("@") ? `@${encodeURIComponent(balik.slice(1))}` : encodeURIComponent(balik);
  try {
    const r = await fetchImpl(zaklad + cesta, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    const doc = await r.json();
    const t = doc?.time?.[verze];
    if (!t) return doc?.versions && !doc.versions[verze] ? null : undefined;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

// CLI: stdin = odpověď `GET /api/v1/deployments/<uuid>` (JSON s `logs`).
// Výstup: jeden řádek `ano|ne <TAB> třída <TAB> důkaz`; chybí-li třída, stojí tam `-`.
// ⛔ Tabulátor je v bashovém IFS „bílý" znak — dva za sebou se SLIJÍ a `read` by
// důkaz přečetl jako třídu (chyceno testem chování `dalsi_pokus`). Návratový kód je 0 i pro „ne" —
// rozhoduje OBSAH; neúspěch nástroje (neplatný vstup) = kód 2, aby se nepletl s verdiktem.
if (isDirectRun(import.meta.url)) {
  let vstup = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (vstup += d));
  process.stdin.on("end", async () => {
    let telo;
    try {
      telo = JSON.parse(vstup);
    } catch (e) {
      console.error(`nasazeni-prechodna-chyba: vstup není JSON odpovědi Coolify (${e instanceof Error ? e.message : String(e)})`);
      process.exit(2);
    }
    const start = telo?.created_at ? new Date(telo.created_at) : undefined;
    const v = await klasifikuj(textLogu(telo?.logs ?? ""), {
      casVydani: (b, ver) => casVydaniZRegistru(b, ver),
      zacatek: start && !Number.isNaN(start.getTime()) ? start : undefined,
    });
    process.stdout.write(`${v.prechodna ? "ano" : "ne"}\t${v.trida || "-"}\t${v.dukaz.replace(/[\t\n]/g, " ")}\n`);
  });
}
