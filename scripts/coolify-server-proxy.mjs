#!/usr/bin/env node
/**
 * coolify-server-proxy.mjs — typ proxy SERVERU v Coolify proti deklaraci slotu.
 *
 * Proxy serveru (Traefik/Caddy, kterou Coolify spouští na každém serveru jako
 * `coolify-proxy`) je vlastnost STROJE. Na uzlu, kam se nic veřejně nevystavuje
 * (GPU uzel `gpu`: služby jen meshem, „veřejné jen přes edge do meshe"), je
 * výchozí Traefik veřejně odpovídající 80/443 navíc (naměřeno 2026-10-02 z cizí
 * sítě: `/` → 404 = proxy odpovídá celému internetu). Deklarace slotu
 * (`proxy` v coolify/servers.json, výklad lib/sloty-serveru.mjs `proxySlotu`)
 * říká, jaká proxy na serveru MÁ být; tenhle nástroj to měří a umí srovnat.
 *
 *   node scripts/coolify-server-proxy.mjs [--slot <slot>] [--json] [--env-soubor <soubor>]
 *        → jen ČTE: GET serveru, porovná typ proxy s deklarací
 *   node scripts/coolify-server-proxy.mjs --apply [...]
 *        → při rozdílu — i když server typ proxy ještě vůbec nemá — pošle PATCH
 *          a výsledek ZPĚTNĚ PŘEČTE (zápis bez zpětného čtení je třída „Coolify
 *          vrátil 200 a hodnotu zahodil")
 *
 * Které sloty: sloty V PROVOZU (lib/sloty-serveru.mjs — slot hostí službu
 * s otevřenou lane), které proxy deklarují. Bez otevřené lane služby slotu (u slotu
 * `gpu` provision_when_env služeb accel-*) se nic neměří — a výpis to říká, ne mlčí.
 * `--slot` vybere jeden slot.
 *
 * Návratové kódy (jeden kód podle nejvážnějšího nálezu, 1 > 2 > 3 > 0; úplný
 * obraz nese --json):
 *   0 — každý měřený server má v API deklarovaný TYP proxy (nebo s --apply
 *       nastavený a ověřený zpětným čtením)
 *   1 — chyba: vadná deklarace, API, zápis nepřijat (zpětné čtení nesedí)
 *   2 — rozdíl (bez --apply)
 *   3 — NEMĚŘENO: UUID serveru slotu nenastaveno, nebo (ve ČTECÍM běhu) odpověď
 *       API pole s typem proxy nemá (server, který proxy nikdy neměl — viz
 *       POLE_PROXY) — nikdy se netváří jako shoda. S --apply se v tom případě
 *       deklarace zapíše a ověří (kód 0), nebo je to chyba (kód 1).
 *
 * ⛔ Kód 0 mluví o TYPU V API, ne o kontejneru. Zápis `none` běžící proxy
 * nezastaví (past u POLE_PROXY) — že na uzlu žádná proxy porty nepublikuje, měří
 * jen výpis kontejnerů uzlu (scripts/lib/kontejnery-uzlu.mjs).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./lib/cli-entry.mjs";
import { readConfigKeyAny } from "./lib/config-env-files.mjs";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { ctenarHodnot } from "./lib/provision-gate.mjs";
import { klicUuidSlotu, nactiSloty, proxySlotu, slotyVProvozu, uuidSlotu } from "./lib/sloty-serveru.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Kde API Coolify drží typ proxy serveru — pro ČTENÍ (cesta v odpovědi
 * `GET /api/v1/servers/{uuid}`) a pro ZÁPIS (pole těla `PATCH /api/v1/servers/{uuid}`).
 *
 * ZMĚŘENO 2026-10-03 na Coolify 4.3.16:
 *   • ČTENÍ — GETem na živém API: typ je v `proxy.type` VELKÝMI písmeny
 *     (`TRAEFIK`, `CADDY`, `NONE`), vedle něj `proxy.status` (`running`/`exited`).
 *     Server, který proxy nikdy neměl, pole `proxy.type` vůbec NEMÁ — to je
 *     NEZMĚŘENO, ne „none" (chybějící pole se na žádný typ nepřevádí). Srovnat ho
 *     jde jen zápisem: `--apply` deklarovaný typ ZAPÍŠE (`changeProxy()` pole
 *     založí) a zpětné čtení musí pole s tou hodnotou ukázat, jinak je to chyba.
 *   • ZÁPIS — ze zdroje téže verze (ServersController::update_server): pole těla
 *     `proxy_type`, hodnoty `traefik|caddy|none`; neznámá hodnota i neznámé pole
 *     → 422. Na živém API ho ověřuje zpětné čtení tohoto nástroje při každém
 *     zápisu, ne tahle poznámka.
 *
 * ⛔ PAST: zápis volá `Server::changeProxy()` — do databáze uloží `proxy.type`
 * a `proxy.status='exited'` HNED, ale pro `none` běžící kontejner `coolify-proxy`
 * NEZASTAVÍ (API na zastavení proxy nemá). Po zápisu tedy API hlásí NONE/exited
 * a proxy dál odpovídá internetu. Zpětné čtení z API to nepozná: SHODA TYPU
 * V API NENÍ DŮKAZ, ŽE PROXY NEBĚŽÍ. Jediný důkaz je výpis kontejnerů na uzlu
 * (scripts/lib/kontejnery-uzlu.mjs — doktor fáze V, cold-start za vlnami).
 *
 * Když měření přestane platit (jiná verze Coolify pole přejmenuje), čtení vrátí
 * `neměřeno` (kód 3) a vypíše JMÉNA klíčů odpovědi s „proxy" — nikdy hodnoty.
 * Jméno pole se NEHÁDÁ: hádaný zápis by buď spadl na validaci, nebo — horší —
 * prošel a nic nezměnil.
 *
 * @type {{ cteni: readonly string[]|null, zapis: string|null, zmereno: string|null }}
 */
export const POLE_PROXY = Object.freeze({
  cteni: Object.freeze(["proxy", "type"]),
  zapis: "proxy_type",
  zmereno:
    "2026-10-03, Coolify 4.3.16 — čtení změřeno GETem na živém API; zápis ze zdroje téže verze, živě ho ověřuje zpětné čtení",
});

/**
 * Co výstup říká u slotu s deklarací `none`, když typ v API sedí (past výš).
 * Nese ho záznam (`upozorneni`), výpis i --json.
 */
export const UPOZORNENI_NONE =
  "typ 'none' v API Coolify běžící kontejner proxy NEZASTAVÍ — shoda typu v API není důkaz, že proxy neběží; " +
  "to měří jen výpis kontejnerů na uzlu (node scripts/lib/kontejnery-uzlu.mjs)";

/** Hodnota na cestě v objektu (cesta = pole klíčů); `undefined` když cesta neexistuje. */
function naCeste(obj, cesta) {
  let v = obj;
  for (const k of cesta) {
    if (v === null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

/** Jména klíčů (cesty), ve kterých je „proxy" — pomůcka pro měření pole, NIKDY hodnoty. */
export function klicesProxy(obj, cesta = [], out = []) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const tady = [...cesta, k];
    if (/proxy/i.test(k)) {
      out.push(tady.join("."));
      // Pod klíčem „proxy" jména dětí (typ bývá uvnitř objektu) — hodnoty nikdy.
      if (v && typeof v === "object" && !Array.isArray(v)) for (const d of Object.keys(v)) out.push([...tady, d].join("."));
      continue;
    }
    if (cesta.length < 3) klicesProxy(v, tady, out);
  }
  return out;
}

/**
 * Sloty k měření: sloty v provozu, které deklarují proxy; s `jenSlot` jen ten
 * (a musí proxy deklarovat — jinak by výběr tiše neměřil nic).
 *
 * @returns {{ sloty: Array<{slot: string, proxy: string}>, chyby: string[], mimoProvoz: string[] }}
 */
export function slotyKMereni({ servers, vProvozu, jenSlot }) {
  const chyby = [];
  const sloty = [];
  const mimoProvoz = [];
  const kandidati = jenSlot ? [jenSlot] : Object.keys(servers);
  for (const slot of kandidati) {
    if (!Object.prototype.hasOwnProperty.call(servers, slot)) {
      chyby.push(`slot '${slot}' není v coolify/servers.json`);
      continue;
    }
    const { proxy, chyba } = proxySlotu(servers[slot], slot);
    if (chyba) {
      chyby.push(chyba);
      continue;
    }
    if (proxy === null) {
      if (jenSlot) chyby.push(`slot '${slot}' proxy nedeklaruje — není s čím porovnat`);
      continue;
    }
    if (!vProvozu.includes(slot)) {
      mimoProvoz.push(slot);
      if (!jenSlot) continue;
    }
    sloty.push({ slot, proxy });
  }
  return { sloty, chyby, mimoProvoz };
}

/**
 * Změří (a s `apply` srovná) proxy serverů slotů. Žádná výchozí hodnota: co
 * nejde změřit, je `nemereno` s důvodem.
 *
 * @param {{ coolify: (path: string, opts?: object) => Promise<any>,
 *   sloty: Array<{slot: string, proxy: string}>, env: Record<string, string|undefined>,
 *   servers: object, apply?: boolean, pole?: typeof POLE_PROXY }} vstup
 */
export async function srovnejProxy({ coolify, sloty, env, servers, apply = false, pole = POLE_PROXY }) {
  const vysledky = [];
  for (const { slot, proxy } of sloty) {
    const zaznam = { slot, deklarace: proxy, uuid: null, zive: null, stav: null, duvod: null, upozorneni: null };
    vysledky.push(zaznam);
    const uuid = uuidSlotu(slot, env, servers);
    if (!uuid) {
      Object.assign(zaznam, { stav: "nemereno", duvod: `${klicUuidSlotu(slot)} nenastaveno — server slotu neznám` });
      continue;
    }
    zaznam.uuid = uuid;
    let server;
    try {
      server = await coolify(`/servers/${encodeURIComponent(uuid)}`);
    } catch (e) {
      Object.assign(zaznam, { stav: "chyba", duvod: `GET serveru selhal: ${String(e.message).split("\n")[0]}` });
      continue;
    }
    if (server === null || typeof server !== "object" || Array.isArray(server)) {
      Object.assign(zaznam, { stav: "chyba", duvod: "Coolify nevydal objekt serveru" });
      continue;
    }
    if (!pole.cteni) {
      const klice = klicesProxy(server);
      Object.assign(zaznam, {
        stav: "nemereno",
        duvod:
          "jméno pole s typem proxy v API Coolify NENÍ ZMĚŘENÉ (POLE_PROXY v coolify-server-proxy.mjs) — " +
          `klíče s „proxy" v odpovědi: ${klice.length ? klice.join(", ") : "žádné"}`,
      });
      continue;
    }
    const zive = naCeste(server, pole.cteni);
    const poleChybi = typeof zive !== "string" || zive === "";
    if (poleChybi && !apply) {
      // Chybějící pole NENÍ „none": server, který proxy nikdy neměl, ho nemá vůbec
      // (změřeno, viz POLE_PROXY) — a stejně vypadá odpověď po přejmenování pole.
      const klice = klicesProxy(server);
      Object.assign(zaznam, {
        stav: "nemereno",
        duvod:
          `odpověď nemá pole ${pole.cteni.join(".")} (server proxy nikdy neměl, nebo měření pole už neplatí) — ` +
          `chybějící pole není 'none', srovná ho jen zápis (--apply); klíče s „proxy" v odpovědi: ${klice.length ? klice.join(", ") : "žádné"}`,
      });
      continue;
    }
    if (!poleChybi) {
      zaznam.zive = zive;
      if (zive.toLowerCase() === proxy) {
        zaznam.stav = "shoda";
        if (proxy === "none") zaznam.upozorneni = UPOZORNENI_NONE;
        continue;
      }
      if (!apply) {
        Object.assign(zaznam, { stav: "rozdil", duvod: `Coolify: '${zive}', deklarace: '${proxy}'` });
        continue;
      }
    }
    // ZÁPIS: typ se liší, nebo ho server ještě nemá (pole chybí) — deklarace se
    // zapíše a zpětné čtení ji musí ukázat. Pole, které po zápisu dál chybí, je
    // chyba stejně jako jiná hodnota: zápis se nepovedl nebo měření pole neplatí.
    if (!pole.zapis) {
      Object.assign(zaznam, { stav: "nemereno", duvod: "pole pro ZÁPIS typu proxy není změřené — nastavit nejde, nehádá se" });
      continue;
    }
    try {
      await coolify(`/servers/${encodeURIComponent(uuid)}`, { method: "PATCH", body: { [pole.zapis]: proxy } });
    } catch (e) {
      Object.assign(zaznam, { stav: "chyba", duvod: `PATCH serveru selhal: ${String(e.message).split("\n")[0]}` });
      continue;
    }
    let poZapisu;
    try {
      poZapisu = naCeste(await coolify(`/servers/${encodeURIComponent(uuid)}`), pole.cteni);
    } catch (e) {
      Object.assign(zaznam, { stav: "chyba", duvod: `zpětné čtení selhalo: ${String(e.message).split("\n")[0]} — zápis NEOVĚŘEN` });
      continue;
    }
    const puvodne = poleChybi ? `pole ${pole.cteni.join(".")} chybělo` : `'${zive}'`;
    if (typeof poZapisu === "string" && poZapisu.toLowerCase() === proxy) {
      Object.assign(zaznam, {
        stav: "nastaveno",
        zive: poZapisu,
        duvod: `${puvodne} → '${proxy}' (typ v API ověřen zpětným čtením)`,
        upozorneni: proxy === "none" ? UPOZORNENI_NONE : null,
      });
    } else {
      const precteno = typeof poZapisu === "string" && poZapisu !== "" ? `dává '${poZapisu}'` : `pole ${pole.cteni.join(".")} nemá`;
      Object.assign(zaznam, {
        stav: "chyba",
        zive: typeof poZapisu === "string" && poZapisu !== "" ? poZapisu : null,
        duvod: `Coolify zápis potvrdil, ale zpětné čtení ${precteno} místo '${proxy}' — hodnota se nezapsala`,
      });
    }
  }
  return vysledky;
}

/** Jeden kód podle nejvážnějšího nálezu: chyba 1 > rozdíl 2 > neměřeno 3 > 0. */
export function kodVysledku(vysledky, chybyDeklarace = []) {
  if (chybyDeklarace.length || vysledky.some((v) => v.stav === "chyba")) return 1;
  if (vysledky.some((v) => v.stav === "rozdil")) return 2;
  if (vysledky.some((v) => v.stav === "nemereno")) return 3;
  return 0;
}

function argumenty(argv) {
  const out = { apply: false, json: false, slot: undefined, envSoubor: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--slot" || a === "--env-soubor") {
      if (argv[i + 1] === undefined) throw new Error(`${a} potřebuje hodnotu`);
      out[a === "--slot" ? "slot" : "envSoubor"] = argv[++i];
    } else throw new Error(`neznámý přepínač '${a}'`);
  }
  return out;
}

async function main() {
  let a;
  try {
    a = argumenty(process.argv.slice(2));
  } catch (e) {
    console.error(`coolify-server-proxy: ${e.message}`);
    console.error("použití: coolify-server-proxy.mjs [--slot <slot>] [--apply] [--json] [--env-soubor <soubor>]");
    return 1;
  }
  const cti = ctenarHodnot(a.envSoubor);
  const servers = nactiSloty(REPO_ROOT);
  const vProvozu = slotyVProvozu({ servers, cti });
  const { sloty, chyby, mimoProvoz } = slotyKMereni({ servers, vProvozu, jenSlot: a.slot });
  const vypis = (radek) => {
    if (!a.json) console.log(radek);
  };
  for (const c of chyby) vypis(`✗ deklarace: ${c}`);
  for (const s of mimoProvoz) vypis(`· slot '${s}' deklaruje proxy, ale není v provozu (lane jeho služeb zavřená) — neměří se`);

  let vysledky = [];
  if (sloty.length > 0) {
    const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL || readConfigKeyAny(["COOLIFY_BASE_URL", "COOLIFY_URL"]);
    const token = process.env.COOLIFY_API_TOKEN || process.env.COOLIFY_API_KEY || readConfigKeyAny(["COOLIFY_API_TOKEN", "COOLIFY_API_KEY"]);
    if (!baseUrl || !token) {
      vysledky = sloty.map(({ slot, proxy }) => ({
        slot, deklarace: proxy, uuid: null, zive: null, stav: "chyba",
        duvod: "chybí COOLIFY_URL nebo COOLIFY_API_TOKEN — server nejde přečíst", upozorneni: null,
      }));
    } else {
      const coolify = createCoolifyClient({ baseUrl, token, timeoutMs: 30_000, maxRetries: 2 });
      const env = new Proxy({}, { get: (_, k) => (typeof k === "string" ? cti(k) : undefined) });
      vysledky = await srovnejProxy({ coolify, sloty, env, servers, apply: a.apply });
    }
  } else if (chyby.length === 0) {
    vypis("· žádný slot v provozu nedeklaruje proxy serveru — není co měřit");
  }

  const ZNAK = { shoda: "✓", nastaveno: "✓", rozdil: "✗", chyba: "✗", nemereno: "?" };
  for (const v of vysledky) {
    const co = v.stav === "shoda" ? `typ proxy v API '${v.zive}' = deklarace` : v.duvod;
    vypis(`${ZNAK[v.stav]} ${v.slot}${v.uuid ? ` (${v.uuid.slice(0, 12)}…)` : ""}: ${v.stav === "nemereno" ? "NEMĚŘENO — " : ""}${co}`);
    if (v.upozorneni) vypis(`· ${v.slot}: ${v.upozorneni}`);
  }
  const kod = kodVysledku(vysledky, chyby);
  if (a.json) process.stdout.write(`${JSON.stringify({ kod, chyby, mimoProvoz, sloty: vysledky }, null, 2)}\n`);
  return kod;
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (kod) => process.exit(kod),
    (e) => {
      console.error(`coolify-server-proxy: ${e.message}`);
      process.exit(1);
    },
  );
}
