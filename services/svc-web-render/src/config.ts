/**
 * Konfigurace svc-web-render.
 *
 * ⛔ NIC SE NEHÁDÁ. Každá hodnota, která je faktem o světě — kde leží výstupní
 * adresář, která skořápka patří k tomuhle buildu, jaký hostname web obsluhuje —
 * se DEKLARUJE a při chybění selže nahlas. Dosazený literál by tiše trefil něco
 * jiného a projevil se jako výpadek bez souvislosti s příčinou (brána
 * `zadny-fallback-nad-identitou`; první verze téhle služby na ní padla dvěma
 * literály: `/out` a `/shell/index.html`).
 *
 * Výjimkou jsou hodnoty POLITIKY (port, perioda kontroly) — ty nic o světě
 * netvrdí, jen nastavují chování, a výchozí hodnota je tam legitimní.
 */

export interface WebRenderConfig {
  /** Základ API, ze kterého se čtou publikované stránky. */
  apiUrl: string;
  /** Anonymní klíč — stránky jsou veřejné, vyšší oprávnění není potřeba. */
  anonKey: string;
  /** Hostname, jehož značku a stránky generujeme. Odvozený z topologie. */
  hostname: string;
  /** Adresář, do kterého se zapisuje statický výstup (sdílený s webserverem). */
  outDir: string;
  /** Skořápka TÉHOŽ buildu — z ní se berou hashované značky skriptů a stylů. */
  shellPath: string;
  /** Politika: port push endpointu. */
  port: number;
  /** Politika: jak často se ověřuje razítko poslední změny. */
  pollMs: number;
  /** Politika: povolené originy pro push endpoint. */
  corsAllowlist: string;
  rateLimitEnabled: boolean;
  /** Politika: úroveň logování. */
  logLevel: string;
  /** Sdílený service token, kterým se prokazuje volající push endpointu. */
  serviceToken: string;
  /** Tajemství pro `PUT /shell` (web → web-render), WEB_RENDER_SHELL_TOKEN. */
  shellToken: string;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `svc-web-render NESTARTUJE — chybí ${name}. ` +
        `Hodnota je fakt o světě a musí být deklarovaná; ` +
        `dosadit literál by znamenalo hádat.`,
    );
  }
  return v.trim();
}

/**
 * Hostname se ODVOZUJE, nikdy nejmenuje. Topologický resolver vydává
 * `APP_DOMAIN` (veřejná tvář webu) — služba tím pádem funguje v každé
 * instanci beze změny kódu. `WEB_RENDER_HOSTNAME` je jen přebití pro
 * případ, kdy jedna instance servíruje víc značek.
 */
function odvodHostname(): string {
  const primy = process.env.WEB_RENDER_HOSTNAME?.trim();
  if (primy) return primy;
  return requiredEnv("APP_DOMAIN");
}

/**
 * Číslo z prostředí se stráží na PRÁZDNOU hodnotu, ne jen na `undefined`.
 *
 * ⛔ NAMĚŘENO 2026-09-12 (brána `cislo-z-prostredi-ma-straz` po sloučení forku):
 * `Number('')` NENÍ `NaN`, je to `0`, a `?? default` hlídá jen `undefined`.
 * Klíč deklarovaný v compose bez hodnoty (`WEB_RENDER_PORT=`) tedy dorazí jako
 * prázdný řetězec, projde přes `??` a stane se z něj NULA — port 0 i nulová
 * perioda dotazování. Výchozí hodnota se ke slovu nedostane.
 *
 * Týž tvar (a týž důvod) drží `svc-knock`, `svc-money`, `svc-source-broker`
 * a `ws-gateway`. Jedno pravidlo, jeden tvar.
 */
export function num(v: string | undefined, d: number): number {
  const t = (v ?? "").trim();
  if (t === "") return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(): WebRenderConfig {
  return {
    apiUrl: requiredEnv("WEB_RENDER_API_URL"),
    anonKey: requiredEnv("WEB_RENDER_ANON_KEY"),
    hostname: odvodHostname(),
    outDir: requiredEnv("WEB_RENDER_OUT_DIR"),
    shellPath: requiredEnv("WEB_RENDER_SHELL"),
    port: num(process.env.WEB_RENDER_PORT, 3040),
    pollMs: num(process.env.WEB_RENDER_POLL_MS, 30_000),
    // Kontrakt applySecurity chce ČÁRKOU ODDĚLENÝ ŘETĚZEC, ne pole —
    // týž tvar jako u sourozeneckých služeb.
    corsAllowlist: process.env.WEB_RENDER_CORS_ALLOWLIST ?? "",
    rateLimitEnabled: process.env.WEB_RENDER_RATE_LIMIT !== "false",
    // ⛔ ANI ÚROVEŇ LOGOVÁNÍ SE NEHÁDÁ. Sourozenecké služby mají `?? "info"`,
    // ale to je zapsaný dluh ve výchozím snímku brány, ne vzor k následování:
    // dosazený literál znamená, že se tiše loguje jinak, než říká kontrakt
    // nasazení. Hodnota se proto DEKLARUJE v compose a při chybění služba
    // nestartuje — stejně jako každý jiný fakt o světě.
    logLevel: requiredEnv("LOG_LEVEL"),
    // Přegenerování je service-to-service operace; token je fakt o světě,
    // takže se deklaruje a při chybění služba nestartuje.
    serviceToken: requiredEnv("INTRANET_API_KEY"),
    // Vlastní tajemství JEN pro dvojici web → web-render (PUT /shell, varianta d-ii).
    // Ne sdílený service token: kdo by ho měl, smí jen vyměnit skořápku.
    //
    // ⛔ ZÁMĚRNĚ NE requiredEnv (nález revize d-ii 2026-10-02): token přibyl změnou
    // kontraktu proměnných, takže ho instance dostane až konvergencí
    // (`aisha-cold-start.sh --skip-create`). Povinný by mezitím službu shazoval
    // dokola a Coolify by po limitu restartů aplikaci ZASTAVIL (StopApplication) —
    // a s ní i servírování už hotových stránek. Bez tokenu proto zápis skořápky
    // selže ZAVŘENĚ (503) a start to hlasitě ohlásí; čtení běží dál.
    shellToken: process.env.WEB_RENDER_SHELL_TOKEN ?? "",
  };
}
