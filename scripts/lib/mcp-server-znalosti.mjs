/**
 * Záznam serveru znalostí pro kořenový `.mcp.json` — JEDNO místo, ze kterého ho bere
 * generátor (`scripts/dirigent/bootstrap-config.mjs --write-mcp`), `scripts/setup.sh`
 * i test, který hlídá, že zapsaný soubor a návod odpovídají.
 *
 * ⛔ NAMĚŘENO 2026-10-03 (mapa mezer, nález G20): generátor do `.mcp.json` zapisoval
 * ROZŘEŠENOU adresu jedné instance. Soubor je v repu, takže každý klon mířil na cizí
 * instanci (naživo 404). Adresa se proto bere z PROSTŘEDÍ — soubor v repu nenese doménu
 * žádné instance. Výchozí hodnota (`${VAR:-…}`) tu záměrně není: musela by být adresou
 * nějaké instance.
 *
 * ── PŘIHLÁŠENÍ: OAuth u Keycloaku instance ──────────────────────────────────────────
 * Výchozí záznam NENESE hlavičku `Authorization`. Klient MCP dostane od koncového bodu
 * 401 s adresou metadat chráněného zdroje (gateway, RFC 9728), z nich zjistí Keycloak
 * instance a člověk se přihlásí v prohlížeči (autorizační kód + PKCE). Klienti realmu
 * se DEKLARUJÍ, za běhu se neregistrují — záznam proto jmenuje předregistrovaného
 * veřejného klienta realmu a port jeho návratové adresy (pole `oauth`). Bez něj by se
 * klient MCP pokusil zaregistrovat sám.
 *
 * Klient i port se berou z DEKLARACE realmu (`keycloak/aisha-realm.json`), ne z literálu
 * tady: port v záznamu, který by se rozešel s návratovou adresou klienta, by přihlášení
 * shodil až u Keycloaku (neplatná návratová adresa), daleko od příčiny. Rozvíjení
 * proměnných prostředí uvádí dokumentace klienta jen pro `command`, `args`, `env`, `url`
 * a `headers` — pole `oauth` proto nese platformní identifikátor, stejný v každé
 * instanci, a žádnou adresu.
 *
 * ── STATICKÝ TOKEN: jen stroje bez člověka ──────────────────────────────────────────
 * n8n nebo CI se v prohlížeči nepřihlásí. Mají VLASTNÍ záznam s hlavičkou `Authorization`
 * (`serverZnalostiProStroj`), mimo výchozí `.mcp.json`. S nastavenou hlavičkou klient
 * přihlášení přes OAuth nenabídne — proto ve výchozím záznamu být nesmí.
 *
 * Jména proměnných jsou táž, která už čte extensions/aisha-dirigent-claude/server/backend.mjs.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Klíč záznamu v `mcpServers`. */
export const JMENO_SERVERU_ZNALOSTI = "aisha-knowledge";

/** Adresa koncového bodu MCP: `<veřejné API instance>/functions/v1/mcp-knowledge-server`. */
export const PROMENNA_ADRESY = "AISHA_MCP_URL";

/** Jen záznam pro stroje: osobní token `mcp_…` se seznamem povolených nástrojů. */
export const PROMENNA_TOKENU = "AISHA_TOKEN";

/**
 * Veřejný klient realmu, přes který se klienti MCP přihlašují. Platformní identifikátor
 * (stejný v každé instanci); jeho deklarace je v `keycloak/aisha-realm.json`.
 */
export const KLIENT_MCP = "aisha-mcp-client";

const CESTA_REALMU = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "keycloak", "aisha-realm.json");

/** Návratová adresa klienta MCP: smyčka (loopback), pevný port, cesta `/callback`. */
const NAVRATOVA_ADRESA = /^http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})\/callback$/;

/** Hostitel, pod kterým klient MCP návratovou adresu posílá. */
const HOSTITEL_NAVRATU = "localhost";

const odkaz = (promenna) => "${" + promenna + "}";

/** Deklarace platformního realmu. */
export function nactiRealm() {
  return JSON.parse(readFileSync(CESTA_REALMU, "utf-8"));
}

/**
 * Pole `oauth` záznamu — klient a port návratové adresy, jak je DEKLARUJE realm.
 *
 * Co nejde odvodit jednoznačně, se odmítne s důvodem: klient v realmu není, nemá návratovou
 * adresu na smyčce, adresy se neshodnou na portu, nebo chybí tvar s `localhost`.
 *
 * @param {unknown} realm  Rozparsovaný `keycloak/aisha-realm.json`.
 * @returns {{ clientId: string, callbackPort: number }}
 */
export function oauthKlientaMcp(realm) {
  const klienti = realm && typeof realm === "object" && Array.isArray(realm.clients) ? realm.clients : [];
  const klient = klienti.find((k) => k?.clientId === KLIENT_MCP);
  if (!klient) {
    throw new Error(`Realm nedeklaruje klienta „${KLIENT_MCP}“ — záznam serveru znalostí nemá, čím se přihlásit.`);
  }

  const adresy = Array.isArray(klient.redirectUris) ? klient.redirectUris : [];
  if (adresy.length === 0) {
    throw new Error(`Klient „${KLIENT_MCP}“ nemá v realmu žádnou návratovou adresu.`);
  }
  const porty = new Set();
  const hostitele = new Set();
  for (const adresa of adresy) {
    const shoda = typeof adresa === "string" ? NAVRATOVA_ADRESA.exec(adresa) : null;
    if (!shoda) {
      throw new Error(
        `Klient „${KLIENT_MCP}“: návratová adresa ${JSON.stringify(adresa)} není ` +
          "http://localhost:<port>/callback ani http://127.0.0.1:<port>/callback — port z ní odvodit nejde.",
      );
    }
    hostitele.add(shoda[1]);
    porty.add(Number(shoda[2]));
  }
  if (porty.size !== 1) {
    throw new Error(
      `Klient „${KLIENT_MCP}“: návratové adresy se neshodnou na portu ` +
        `(${[...porty].sort((a, b) => a - b).join(", ")}) — záznam umí nést jen jeden.`,
    );
  }
  if (!hostitele.has(HOSTITEL_NAVRATU)) {
    throw new Error(
      `Klient „${KLIENT_MCP}“: chybí návratová adresa s hostitelem ${HOSTITEL_NAVRATU} — tu klient MCP posílá.`,
    );
  }
  const [callbackPort] = porty;
  if (callbackPort < 1 || callbackPort > 65535) {
    throw new Error(`Klient „${KLIENT_MCP}“: ${callbackPort} není platný port návratové adresy.`);
  }
  return { clientId: klient.clientId, callbackPort };
}

/**
 * VÝCHOZÍ záznam serveru znalostí: adresa z prostředí, přihlášení přes OAuth klientem
 * z deklarace realmu. Bez hlavičky `Authorization`.
 *
 * @param {unknown} [realm]  Deklarace realmu; bez ní se čte `keycloak/aisha-realm.json`.
 */
export function serverZnalostiZProstredi(realm = nactiRealm()) {
  return {
    type: "http",
    url: odkaz(PROMENNA_ADRESY),
    oauth: oauthKlientaMcp(realm),
  };
}

/**
 * Záznam pro STROJ bez člověka (n8n, CI): adresa i token z prostředí, bez OAuth.
 * Do výchozího `.mcp.json` nepatří — stroj ho má ve vlastní konfiguraci.
 */
export function serverZnalostiProStroj() {
  return {
    type: "http",
    url: odkaz(PROMENNA_ADRESY),
    headers: { Authorization: `Bearer ${odkaz(PROMENNA_TOKENU)}` },
  };
}

/** `${VAR}` bez výchozí hodnoty, za ním nejvýš cesta — žádné schéma ani host. */
const URL_JEN_Z_PROSTREDI = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}(\/[^\s]*)?$/;

/** `<schéma> ${VAR}` — pověření samo v souboru není. */
const POVERENI_JEN_Z_PROSTREDI = /^[A-Za-z][A-Za-z0-9-]* \$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * Co v obsahu `.mcp.json` nese adresu nebo pověření DOSLOVA. Prázdný výsledek = soubor je
 * přenositelný mezi instancemi. Výchozí hodnota `${VAR:-https://…}` se počítá jako doslovná
 * adresa — je to táž doména, jen o závorku dál. Adresou je i `oauth.authServerMetadataUrl`:
 * je to adresa autorizačního serveru jedné instance.
 *
 * @param {unknown} mcpJson  Rozparsovaný obsah `.mcp.json`.
 * @returns {string[]}       Popis každého nálezu (bez hodnot pověření).
 */
export function doslovneAdresyAPovereni(mcpJson) {
  const servery = mcpJson && typeof mcpJson === "object" ? mcpJson.mcpServers : null;
  if (!servery || typeof servery !== "object") return [];

  const nalezy = [];
  for (const [jmeno, server] of Object.entries(servery)) {
    if (!server || typeof server !== "object") continue;
    if (typeof server.url === "string" && !URL_JEN_Z_PROSTREDI.test(server.url)) {
      // Hodnota se nevypisuje: doslovná adresa může nést i přihlašovací údaje.
      nalezy.push(`${jmeno}: url nese adresu doslova — má být \${PROMENNA}[/cesta]`);
    }
    const hlavicky = server.headers && typeof server.headers === "object" ? server.headers : {};
    for (const [hlavicka, hodnota] of Object.entries(hlavicky)) {
      if (hlavicka.toLowerCase() !== "authorization") continue;
      if (typeof hodnota !== "string" || !POVERENI_JEN_Z_PROSTREDI.test(hodnota)) {
        nalezy.push(`${jmeno}: hlavička ${hlavicka} nese pověření doslova — má být "<schéma> \${PROMENNA}"`);
      }
    }
    const oauth = server.oauth && typeof server.oauth === "object" ? server.oauth : {};
    if ("authServerMetadataUrl" in oauth) {
      nalezy.push(
        `${jmeno}: oauth.authServerMetadataUrl nese adresu autorizačního serveru jedné instance — ` +
          "do sdíleného souboru nepatří",
      );
    }
  }
  return nalezy;
}
