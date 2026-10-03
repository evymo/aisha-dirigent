#!/usr/bin/env node
/**
 * verejna-tvar.mjs — veřejná tvář instance pro build appky v CI
 * (`AISHA_INSTANCE_ENV`, který čte mobile-app/scripts/instance-env-derive.sh).
 *
 * ⭐ ŽÁDNÁ DRUHÁ RUČNÍ KOPIE. Lokální build bere tvář z trezoru; v CI trezor
 *    není (a celý tam patřit nesmí — kvůli jednomu veřejnému klíči by v CI
 *    leželo všechno tajné). Proto se tvář SKLÁDÁ z toho, co už má jeden domov:
 *      · domény  — derivace z profilu instance (derive-domains: buildTopology
 *                  + formatShellExports); změřeno 2026-09-27 na riq: shoda
 *                  s trezorem u PUBLIC_TLD / API / AUTH / APP;
 *      · identita — `APP_NAME_PREFIX` (repo proměnná forku, týž domov jako
 *                  deploy.yml); bez ní STOP, žádný dosazený prefix — ten by
 *                  postavil appku CIZÍ instance;
 *      · realm   — `auth.issuer` povrchu (app.config.json v datech instance);
 *                  identita instance se NEHÁDÁ — bez issueru STOP;
 *      · dveře   — `vybava.knock` z deklarace zařízení (týž údaj, který kiosk
 *                  dostává v QR); kid musí sedět s identitou appky;
 *      · anon klíč — NENÍ tajemství: veřejně ho vystavuje API instance
 *                  (`https://API_DOMAIN_PUBLIC/.well-known/app-config.json`,
 *                  pole `anon_key`) jako konfigurační údaj. Rozhodnutí majitele
 *                  2026-09-28: žádné AISHA_ANON_KEY v tajemstvích forku — kopie
 *                  by jen mohla rozjet s nasazenou instancí. Bere se z API a
 *                  OVĚŘÍ proti nasazenému webu (bundle na https://APP_DOMAIN).
 *
 * ⛔ Pojistky (Aisha.Guru 2026-09-27):
 *    · klíč musí mít v JWT `role: anon` — service_role do appky NIKDY
 *      (platí i pro klíč z API: kdyby gateway omylem vydala jiný, STOP);
 *    · „neshoda s nasazenou instancí“ a „nezměřeno“ (web nedostupný, bundle
 *      bez klíče) se rozlišují — obojí je STOP, s vlastním důvodem.
 *
 * Použití (CI) — data instance dodá volající přes rozcestník overlaye
 * (scripts/lib/instance-overlay.mjs), ne argumentem vedle něj:
 *   <proměnná rozcestníku = data instance> APP_NAME_PREFIX=… \
 *     node scripts/ci/verejna-tvar.mjs --povrch <povrch> > "$RUNNER_TEMP/instance.env"
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { odUvozovkuj } from "../lib/env-hodnota.mjs";
import { requireOverlay } from "../lib/instance-overlay.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ─── čisté funkce ───────────────────────────────────────────────────────────

/** Payload JWT bez ověření podpisu (podpis ověřuje server; tady jde o DRUH klíče). */
export function payloadJwt(jwt) {
  const casti = String(jwt ?? "").split(".");
  if (casti.length !== 3) throw new Error("anon klíč není JWT (čekám tři části)");
  try {
    return JSON.parse(Buffer.from(casti[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("anon klíč: payload JWT nejde přečíst");
  }
}

/** ⛔ Do appky smí jen klíč role `anon`. */
export function overAnonKlic(jwt) {
  const p = payloadJwt(jwt);
  if (p.role !== "anon") throw new Error(`anon klíč má role „${p.role ?? "?"}“, ne „anon“ — do appky ho nepustím`);
  if (typeof p.exp === "number" && p.exp * 1000 < Date.now()) throw new Error("anon klíč už vypršel");
  return p;
}

/** Všechna anon JWT v textu (bundle). */
export function anonKliceVTextu(text) {
  const jwts = new Set(String(text).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []);
  return [...jwts].filter((j) => {
    try {
      return payloadJwt(j).role === "anon";
    } catch {
      return false;
    }
  });
}

/** Skripty, které index.html webu načítá (src i modulepreload). */
export function skriptyZIndexu(html) {
  const cesty = new Set();
  for (const m of String(html).matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)) cesty.add(m[1]);
  return [...cesty];
}

/**
 * Ověří klíč proti NASAZENÉ instanci.
 * @returns {{ stav: "shoda" } | { stav: "neshoda", duvod: string } | { stav: "nezmereno", duvod: string }}
 */
export async function porovnejSNasazenou({ klic, appDomain, f = fetch, pokusu = 3, spi = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const zaklad = `https://${appDomain}`;
  // Přechodný výpadek SÍTĚ se zkusí znovu (build appky trvá desítky minut a
  // jedno utržené spojení by ho zbytečně shodilo). Odpověď serveru se neopakuje
  // a trvalá nedostupnost zůstane NEZMĚŘENO — tichý průchod z toho nevznikne.
  const ziskej = async (url, limitMs) => {
    for (let i = 1; ; i++) {
      try {
        return await f(url, { signal: AbortSignal.timeout(limitMs) });
      } catch (e) {
        if (i >= pokusu) throw e;
        await spi(2_000 * i);
      }
    }
  };
  let html;
  try {
    const r = await ziskej(`${zaklad}/`, 30_000);
    if (!r.ok) return { stav: "nezmereno", duvod: `web ${zaklad}/ vrátil ${r.status}` };
    html = await r.text();
  } catch (e) {
    return { stav: "nezmereno", duvod: `web ${zaklad}/ nedostupný (${e?.message ?? e})` };
  }
  const skripty = skriptyZIndexu(html);
  if (skripty.length === 0) return { stav: "nezmereno", duvod: "index.html nenačítá žádné /assets/*.js" };
  const nalezene = new Set();
  for (const cesta of skripty) {
    try {
      const r = await ziskej(`${zaklad}${cesta}`, 60_000);
      if (!r.ok) return { stav: "nezmereno", duvod: `${cesta} vrátil ${r.status}` };
      for (const j of anonKliceVTextu(await r.text())) nalezene.add(j);
    } catch (e) {
      return { stav: "nezmereno", duvod: `${cesta} nedostupný (${e?.message ?? e})` };
    }
  }
  if (nalezene.size === 0) return { stav: "nezmereno", duvod: "bundle webu nenese žádný anon klíč" };
  if (nalezene.has(klic)) return { stav: "shoda" };
  return { stav: "neshoda", duvod: `nasazený web nese jiný anon klíč (${nalezene.size}×) než API instance` };
}

/**
 * Anon klíč z VEŘEJNÉ konfigurace API instance (`/.well-known/app-config.json`,
 * pole `anon_key`) — týž údaj, který si z API bere každá appka při startu.
 * Síť se zkusí znovu (jako u webu); odpověď serveru ne. Nedostupné API, jiný
 * stav než 200 nebo odpověď bez klíče = NEZMĚŘENO s důvodem (STOP), nikdy
 * náhradní hodnota.
 * @returns {Promise<{ stav: "ok", klic: string } | { stav: "nezmereno", duvod: string }>}
 */
export async function anonKlicZApi({ apiDomain, f = fetch, pokusu = 3, spi = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const url = `https://${apiDomain}/.well-known/app-config.json`;
  let r;
  for (let i = 1; ; i++) {
    try {
      r = await f(url, { signal: AbortSignal.timeout(30_000) });
      break;
    } catch (e) {
      if (i >= pokusu) return { stav: "nezmereno", duvod: `API ${url} nedostupné (${e?.message ?? e})` };
      await spi(2_000 * i);
    }
  }
  if (!r.ok) return { stav: "nezmereno", duvod: `API ${url} vrátilo ${r.status}` };
  let telo;
  try {
    telo = await r.json();
  } catch {
    return { stav: "nezmereno", duvod: `API ${url} nevrátilo JSON` };
  }
  const klic = typeof telo?.anon_key === "string" ? telo.anon_key.trim() : "";
  if (!klic) return { stav: "nezmereno", duvod: `API ${url} neuvádí anon_key` };
  return { stav: "ok", klic };
}

/**
 * Realm instance z `auth.issuer` povrchu (`https://<auth>/realms/<realm>`).
 * ⛔ Realm je identita instance: nedeklarovaný = STOP, ne výchozí hodnota —
 *    výchozí by znamenala „když nevím, přihlas se k upstreamu“. Host issueru
 *    musí sedět s derivovanou AUTH_DOMAIN_PUBLIC, jinak by appka dostala dvě
 *    různé pravdy o tom, kde se přihlašuje.
 */
export function realmZIssueru(issuer, authDomain) {
  let u;
  try {
    u = new URL(String(issuer ?? ""));
  } catch {
    throw new Error("app.config.json povrchu neuvádí platný auth.issuer — realm instance nevím a nehádám");
  }
  const m = /^\/realms\/([^/]+)\/?$/.exec(u.pathname);
  if (!m) throw new Error(`auth.issuer „${issuer}“ nemá tvar https://<auth>/realms/<realm>`);
  if (authDomain && u.host !== authDomain) {
    throw new Error(`auth.issuer míří na ${u.host}, derivace na ${authDomain} — nesoulad, appku nestavím`);
  }
  return decodeURIComponent(m[1]);
}

/**
 * Tvář z hotových vstupů (bez I/O).
 * @param {object} o
 * @param {Record<string,string>} o.topologie  výstup formatShellExports jako mapa
 * @param {string} o.realm
 * @param {{ host: string, port: number, kid: string, scope: string } | undefined} o.knock  vybava.knock
 * @param {{ slug?: string, knock?: { kid?: string, scope?: string } }} o.brand  version.json povrchu
 * @param {string} o.anonKlic
 */
export function slozTvar({ topologie, realm, knock, brand, anonKlic }) {
  const chybi = ["PUBLIC_TLD", "API_DOMAIN_PUBLIC", "AUTH_DOMAIN_PUBLIC", "APP_DOMAIN"].filter((k) => !topologie[k]);
  if (chybi.length) throw new Error(`derivace z profilu nevydala: ${chybi.join(", ")}`);
  if (knock) {
    // Kiosk dostává dveře v QR (vybava.knock); appka se u nich hlásí svým kid.
    // Rozjeté hodnoty = appka klepe jinak, než jí kiosk řekl → mlčí dveře.
    const kidAppky = brand?.knock?.kid || brand?.slug;
    if (kidAppky && knock.kid !== kidAppky) {
      throw new Error(`vybava.knock.kid „${knock.kid}“ ≠ kid appky „${kidAppky}“ (version.json) — dveře by appku nepoznaly`);
    }
  }
  const tvar = {
    PUBLIC_TLD: topologie.PUBLIC_TLD,
    API_DOMAIN_PUBLIC: topologie.API_DOMAIN_PUBLIC,
    AUTH_DOMAIN_PUBLIC: topologie.AUTH_DOMAIN_PUBLIC,
    APP_DOMAIN: topologie.APP_DOMAIN,
    KEYCLOAK_REALM: realm,
    ANON_KEY: anonKlic,
    ...(topologie.LIVEKIT_DOMAIN_PUBLIC ? { LIVEKIT_DOMAIN_PUBLIC: topologie.LIVEKIT_DOMAIN_PUBLIC } : {}),
    ...(knock ? { SPA_KNOCK_PUBLIC_HOST: knock.host, SPA_KNOCK_PUBLIC_PORT: String(knock.port) } : {}),
  };
  for (const [k, v] of Object.entries(tvar)) {
    if (/[\n\r"'$`\\]/.test(String(v))) throw new Error(`${k}: hodnota obsahuje znak, který do env souboru nepatří`);
  }
  return tvar;
}

export function formatEnv(tvar) {
  return Object.entries(tvar).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

// ─── příkazová řádka ────────────────────────────────────────────────────────

async function hlavni(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
  if (!a.povrch) throw new Error("použití: verejna-tvar.mjs --povrch <povrch> (data instance přes rozcestník overlaye)");
  const prefix = (process.env.APP_NAME_PREFIX ?? "").trim();
  if (!prefix) throw new Error("APP_NAME_PREFIX (repo proměnná forku) chybí — bez identity instance appku nestavím");
  // Bez dat instance nemá tvář z čeho vzniknout — rozcestník v tom případě spadne.
  const data = requireOverlay("verejna-tvar (build appky kiosku)");
  const { nactiDeklaraci } = await import(pathToFileURL(join(ROOT, "scripts/ci/kiosk-balicky.mjs")).href);
  const { readdirSync, existsSync } = await import("node:fs");
  const profilySoubory = existsSync(join(data, "profiles")) ? readdirSync(join(data, "profiles")).filter((x) => x.endsWith(".json")) : [];
  const profily = profilySoubory.map((s) => ({ soubor: `profiles/${s}`, obsah: readFileSync(join(data, "profiles", s), "utf8") }));
  const d = nactiDeklaraci({ profily, cti: (c) => (existsSync(join(data, c)) ? readFileSync(join(data, c), "utf8") : null) });
  if (!d) throw new Error("data instance zařízení nedeklarují — appku kiosku nestavím");
  // Profil instance = ten, který deklaraci zařízení nese (jméno instance do stacku nepatří).
  const profil = profily.find((p) => JSON.parse(p.obsah)?.zarizeni?.hlidac === d.cesta);
  const profileId = profil.soubor.replace(/^profiles\//, "").replace(/\.json$/, "");

  const { buildTopology, formatShellExports } = await import(pathToFileURL(join(ROOT, "scripts/lib/derive-domains.mjs")).href);
  const topologie = {};
  for (const l of formatShellExports(buildTopology({ profileId })).split("\n")) {
    const m = /^(?:export )?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l);
    if (m) topologie[m[1]] = odUvozovkuj(m[2]);
  }
  if (!topologie.API_DOMAIN_PUBLIC) throw new Error("derivace z profilu nevydala API_DOMAIN_PUBLIC — anon klíč není odkud vzít");
  const zApi = await anonKlicZApi({ apiDomain: topologie.API_DOMAIN_PUBLIC });
  if (zApi.stav !== "ok") throw new Error(`anon klíč NEZMĚŘEN z API instance: ${zApi.duvod}`);
  const klic = zApi.klic;
  overAnonKlic(klic);
  const brand = JSON.parse(readFileSync(join(data, "surfaces", a.povrch, "version.json"), "utf8")).brand;
  const konfigPovrchu = JSON.parse(readFileSync(join(data, "surfaces", a.povrch, "app.config.json"), "utf8"));
  const tvar = slozTvar({
    topologie,
    realm: realmZIssueru(konfigPovrchu?.auth?.issuer, topologie.AUTH_DOMAIN_PUBLIC),
    knock: d.j.vybava?.knock,
    brand,
    anonKlic: klic,
  });

  const v = await porovnejSNasazenou({ klic, appDomain: tvar.APP_DOMAIN });
  if (v.stav === "neshoda") throw new Error(`anon klíč z API NESEDÍ s nasazeným webem: ${v.duvod}`);
  if (v.stav === "nezmereno") throw new Error(`anon klíč NEZMĚŘEN proti nasazené instanci: ${v.duvod}`);
  process.stderr.write(`veřejná tvář: profil ${profileId}, API ${tvar.API_DOMAIN_PUBLIC}, anon klíč z API = nasazený web ✓\n`);
  process.stdout.write(formatEnv(tvar));
}

if (isDirectRun(import.meta.url)) {
  hlavni(process.argv.slice(2)).catch((e) => {
    console.error(`::error title=verejna-tvar::${e.message}`);
    process.exit(1);
  });
}
