/**
 * coolify-http.mjs — shared Coolify v4 API client (read + write).
 *
 * Single source of truth for the retry/timeout behavior every script that
 * talks to Coolify needs. Coolify v4 has stretches of ~20-40s slowness (app
 * creation, cold-start), so a 10s single-shot fetch produces spurious
 * AbortErrors that previously made the verifier silently skip its app-status
 * assertions while the doctor (60s + retries) succeeded on the same instance.
 *
 * Behavior:
 *   - default 60s timeout per attempt, 3 attempts; obojí lze přebít NA VOLÁNÍ
 *   - retries ONLY transient failures (abort/reset/timeout/fetch failed)
 *     PLUS HTTP 429 typu „rate limit", kde server sám říká „zkus to znovu" a
 *     `Retry-After` se respektuje; ostatní HTTP 4xx/5xx padají hned (fail-loud
 *     — žádné retry storms na chybě pověření nebo validace)
 *   - HTTP 429 typu „fronta nasazení je plná" se NEOPAKUJE a označí se
 *     `err.backpressure = true` — viz `waitForDeploymentSlot` níž
 *   - strips ASCII control chars from the JSON payload (Coolify embeds
 *     raw control bytes in some fields)
 */

/**
 * Coolify odpovídá 429 na DVĚ NESOUVISEJÍCÍ věci a rozlišuje je jen textem:
 *
 *   „Too Many Attempts."                → spotřeboval jsi rozpočet požadavků
 *                                         (200/okno). Přejde za desítky vteřin.
 *   „Deployment queue is full. …"       → server nemá MÍSTO. Fronta se
 *                                         uvolňuje rychlostí NASAZOVÁNÍ.
 *
 * ⛔ NAMĚŘENO 2026-08-25: fronta držela 27 nasazení při souběžnosti 2. Při
 * 1–3 min na nasazení je to 15–40 minut. Klient přitom čekal `attempt*5000`,
 * tedy 15 vteřin — a vlna, které selhaly VŠECHNY spouštěče, pokračovala dál
 * jako by neměla co nasazovat. Tři vlny (7, 8, 9) tak proběhly naprázdno.
 *
 * Opakovat tohle UVNITŘ klienta by bylo horší než nedělat nic: 22 souběžných
 * spouštěčů × dotaz co 30 s × 20 min = ~880 požadavků, což spolehlivě vyčerpá
 * rozpočet a vyrobí ten DRUHÝ druh 429. Na zahlcení se čeká SPOLEČNĚ, jednou
 * za vlnu — proto se sem chyba jen označí a rozhodnutí patří volajícímu.
 */
const ZAHLCENA_FRONTA = /deployment queue is full/i;

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl - e.g. https://coolify.example.com (no trailing slash needed)
 * @param {string} cfg.token   - Coolify API bearer token
 * @param {number} [cfg.timeoutMs=60000]
 * @param {number} [cfg.maxRetries=3]
 * @returns {(path: string, options?: object) => Promise<any>}
 */
export function createCoolifyClient({ baseUrl, token, timeoutMs = 60000, maxRetries = 3 }) {
  if (!baseUrl) throw new Error("createCoolifyClient: baseUrl required");
  if (!token) throw new Error("createCoolifyClient: token required");
  const base = baseUrl.replace(/\/$/, "");

  return async function coolify(path, options = {}) {
    // Timeout i počet pokusů jdou přebít NA VOLÁNÍ: rychlé dotazy na stav
    // nemají čekat minutu, spouštění nasazení naopak ano. Bez toho si každý
    // skript psal vlastního klienta jen kvůli téhle jedné hodnotě.
    const {
      timeoutMs: timeoutVolani = timeoutMs,
      maxRetries: pokusuVolani = maxRetries,
      body,
      ...zbytek
    } = options;
    // Objekt se serializuje sám. Devět vlastních kopií klienta se lišilo
    // hlavně tím, jestli `body` stringifikuje volající, nebo klient.
    const telo = body === undefined || body === null || typeof body === "string"
      ? body
      : JSON.stringify(body);

    let lastErr;
    for (let attempt = 1; attempt <= pokusuVolani; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutVolani);
      try {
        const response = await fetch(`${base}/api/v1${path}`, {
          ...zbytek,
          body: telo,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(telo ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
          },
        });
        const text = await response.text();
        if (!response.ok) {
          const chyba = new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 200)}`);
          chyba.status = response.status;
          if (response.status === 429 && ZAHLCENA_FRONTA.test(text)) {
            // Není to chyba spouštění, je to „teď ne". Volající, který umí
            // počkat, ať počká (waitForDeploymentSlot); ostatní ať spadnou
            // nahlas — tiché přeskočení je přesně ta vada, co stála tři vlny.
            chyba.backpressure = true;
          } else {
            // `Retry-After` je ve VTEŘINÁCH. Když ho server pošle, je to jeho
            // vlastní odpověď na „kdy to zkusit znovu" — hádat místo něj nemá smysl.
            const retryAfter = Number(response.headers.get("retry-after"));
            if (Number.isFinite(retryAfter) && retryAfter > 0) {
              chyba.retryAfterMs = Math.min(retryAfter * 1000, 120_000);
            }
          }
          throw chyba;
        }
        return text ? JSON.parse(text.replace(/[\x00-\x1f]/g, "")) : null;
      } catch (err) {
        lastErr = err;
        // ⛔ 429 JE PŘECHODNÁ, i když je to 4xx. Do 2026-08-25 padala okamžitě
        // spolu s 400/404 pod pravidlem „žádné retry storms na auth/validaci" —
        // jenže u 429 server SÁM říká „zkus to za chvíli", takže neopakovat
        // znamená zahodit běh kvůli něčemu, co za pár vteřin přejde.
        //
        // ⛔ NAMĚŘENO 2026-08-25: cold-start spadl DVAKRÁT na
        //     coolify-project-scope: HTTP 429 {"message":"Too Many Attempts."}
        // a podruhé už po 100 vteřinách — rozpočet (200/okno) spotřeboval jeho
        // vlastní preflight. Skript se přitom zachoval správně (odmítl
        // pokračovat s prázdnými UUID); chyběla jen trpělivost o vrstvu níž.
        const zahlcen = err?.status === 429 && !err?.backpressure;
        const transient = zahlcen
          || err?.name === "AbortError"
          || /aborted|ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(err));
        if (attempt < pokusuVolani && transient) {
          // U zahlcení delší odstup: okno bývá minutové, 5s by jen spálilo pokus.
          const backoff = zahlcen ? (err.retryAfterMs ?? attempt * 20_000) : attempt * 5000;
          console.warn(`coolify(${path}) transient ${err?.name || err?.message} — retry ${attempt}/${pokusuVolani} in ${backoff}ms`);
          await new Promise((resolveSleep) => setTimeout(resolveSleep, backoff));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  };
}

/**
 * Přečte, kolik nasazení server právě drží (fronta + běžící).
 *
 * ⛔ TVAR ODPOVĚDI: `/deployments` NEVRACÍ pole. Vrací objekt s číselnými
 * klíči („0", „1", …) — serializované PHP pole. Naivní `Array.isArray(j) ? j
 * : j.deployments || []` proto vrátí PRÁZDNO a měřidlo mlčky ohlásí „fronta
 * je prázdná" přesně ve chvíli, kdy je plná. (Napálilo mě to 2026-08-25 na
 * první pokus.) Čteme hodnoty objektu a filtrujeme na ty, co mají `status`.
 *
 * @param {(path: string, options?: object) => Promise<any>} coolify
 * @returns {Promise<{celkem: number, bezi: number, ceka: number, polozky: any[]}>}
 */
export async function readDeploymentQueue(coolify) {
  const odpoved = await coolify("/deployments", { timeoutMs: 30_000 });
  const polozky = Object.values(odpoved || {}).filter((d) => d && typeof d === "object" && d.status);
  const bezi = polozky.filter((d) => d.status === "in_progress").length;
  return { celkem: polozky.length, bezi, ceka: polozky.length - bezi, polozky };
}

/**
 * Počká, až se ve frontě nasazení uvolní místo.
 *
 * Zahlcení není chyba, je to ZPĚTNÝ TLAK: server říká „teď ne, mám plno".
 * Správná odpověď na zpětný tlak je počkat, dokud místo nebude — a nahlas
 * spadnout, když se přestane hýbat. Ne pokračovat, jako by se nic nestalo.
 *
 * ⛔ ROZPOČET SE MĚŘÍ NA STÁNÍ, NE NA CELKOVÉM ČASE. Naměřeno 2026-08-25:
 * jedno nasazení těžkého stacku stavělo 12 obrazů a po 33 minutách teprve
 * začalo přenášet — fronta 27 nasazení při souběžnosti 2 se tedy legitimně
 * cedí HODINY. Strop na celkový čas by utnul frontu, která pracuje správně.
 * Stejný tvar má o vrstvu výš i čekání na zdraví vlny („idle-timeout, resetuje
 * se při jakémkoli pokroku").
 *
 * Čeká se JEDNOU ZA VLNU, ne za každý spouštěč: jeden dotaz co `pollMs`
 * místo N souběžných retry smyček, které by vyčerpaly rozpočet požadavků
 * (200/okno) a vyrobily druhý druh 429.
 *
 * @param {(path: string, options?: object) => Promise<any>} coolify
 * @param {object} [opts]
 * @param {number} [opts.stallMs=1_800_000] jak dlouho smí být fronta BEZE ZMĚNY, než to vzdáme (30 min)
 * @param {number} [opts.hardCapMs=21_600_000] absolutní pojistka proti nekonečnu (6 h)
 * @param {number} [opts.pollMs=30_000]      odstup dotazů na hloubku fronty
 * @param {number} [opts.prahVolno=4]        kolik nasazení ve frontě ještě považujeme za „je místo"
 * @param {(s: string) => void} [opts.log]
 * @returns {Promise<{uvolneno: boolean, duvod: string, cekanoMs: number, hloubka: number}>}
 */
export async function waitForDeploymentSlot(coolify, opts = {}) {
  const {
    stallMs = 1_800_000,
    hardCapMs = 21_600_000,
    pollMs = 30_000,
    prahVolno = 4,
    log = () => {},
  } = opts;
  const zacatek = Date.now();
  let hloubka = Number.NaN;
  let poslednePohyb = Date.now();
  let posledniOtisk = "";

  for (;;) {
    let fronta = null;
    try {
      fronta = await readDeploymentQueue(coolify);
    } catch (e) {
      // Nevidím do fronty ⇒ nevím, jestli je místo. To NENÍ „je volno".
      log(`hloubku fronty se nepodařilo přečíst (${e.message}) — čekám dál, nedomýšlím si volno`);
    }
    if (fronta) {
      hloubka = fronta.celkem;
      if (fronta.celkem <= prahVolno) {
        return { uvolneno: true, duvod: "místo", cekanoMs: Date.now() - zacatek, hloubka };
      }
      // Pokrok = ubylo nasazení NEBO se vyměnila sada těch běžících. Obojí
      // znamená, že se fronta hýbe, takže stání začíná znovu od nuly.
      const otisk = `${fronta.celkem}|${fronta.polozky
        .filter((d) => d.status === "in_progress")
        .map((d) => d.deployment_uuid || d.id)
        .sort()
        .join(",")}`;
      if (otisk !== posledniOtisk) {
        posledniOtisk = otisk;
        poslednePohyb = Date.now();
      }
      const stoji = Math.round((Date.now() - poslednePohyb) / 1000);
      log(`fronta nasazení: ${fronta.celkem} (${fronta.bezi} běží, ${fronta.ceka} čeká)${stoji > 0 ? `, beze změny ${stoji}s` : ", hýbe se"} — čekám na místo`);
      if (Date.now() - poslednePohyb >= stallMs) {
        return { uvolneno: false, duvod: `fronta stojí ${Math.round(stallMs / 60000)} min beze změny`, cekanoMs: Date.now() - zacatek, hloubka };
      }
    }
    if (Date.now() - zacatek >= hardCapMs) {
      return { uvolneno: false, duvod: `absolutní strop ${Math.round(hardCapMs / 3600000)} h`, cekanoMs: Date.now() - zacatek, hloubka };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
