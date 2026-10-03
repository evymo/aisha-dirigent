/**
 * Přihlášení Řidiče na Androidu ve VLOŽENÉM WebView — jen jménem a heslem RIQ ID.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): „Android aplikace RIQ Řidič bude přihlašovat
 * jen pomocí jména a hesla RIQi ID." Tablety v kiosku nemají žádný prohlížeč
 * (zavedení z QR ho odinstaluje, Kiosk Admin ho nevrací) a Google Play na nich
 * není — Custom Tab (expo-web-browser) proto nemá kde běžet.
 *
 * Tady je jen ČISTÁ logika (bez React Native), aby šla změřit testem:
 *   · co smí WebView načíst (jen realm RIQ ID, žádný broker Google/Apple, nic cizího),
 *   · jak se přečte návrat na redirect_uri (code × error, s kontrolou `state`).
 *
 * ⛔ PROČ SE BLOKUJE BROKER: Google ve vloženém WebView přihlášení odmítne
 *    (403 disallowed_useragent) a majitel chce jen jméno a heslo. Skrytí tlačítka
 *    na stránce je kosmetika; o tom, kam WebView smí, rozhoduje `rozhodniNavigaci`.
 *
 * ⛔ ADRESY SE ROZEBÍRAJÍ RUČNĚ: globální třída pro adresy nemusí mít v React
 *    Native úplnou implementaci (parametry dotazu), a tahle logika se musí chovat
 *    na tabletu stejně jako v testu.
 */

export type RozhodnutiNavigace = "povolit" | "navrat" | "blokovat";

export interface CilPrihlaseni {
  /** Autorita Keycloaku, např. `https://auth.example.cz/realms/aisha`. */
  authority: string;
  /** Kam se Keycloak vrací s `code` (vlastní schéma appky). */
  redirectUri: string;
}

export interface Adresa {
  /** `schema://host[:port]`, malými písmeny. */
  origin: string;
  schema: string;
  cesta: string;
  dotaz: Map<string, string>;
}

const SCHEMA = /^[a-z][a-z0-9+.-]*$/i;

function prectiDotaz(cast: string, dotaz: Map<string, string>): boolean {
  for (const par of cast.split("&")) {
    if (!par) continue;
    const i = par.indexOf("=");
    const k = i < 0 ? par : par.slice(0, i);
    const v = i < 0 ? "" : par.slice(i + 1);
    try {
      dotaz.set(decodeURIComponent(k.replace(/\+/g, " ")), decodeURIComponent(v.replace(/\+/g, " ")));
    } catch {
      return false;
    }
  }
  return true;
}

export function rozeber(url: string): Adresa | null {
  const oddelovac = url.indexOf("://");
  if (oddelovac < 1) return null;
  const schema = url.slice(0, oddelovac).toLowerCase();
  if (!SCHEMA.test(schema)) return null;
  const zbytek = url.slice(oddelovac + 3);
  const konecHostu = zbytek.search(/[/?#]/);
  const host = konecHostu < 0 ? zbytek : zbytek.slice(0, konecHostu);
  const zaHostem = konecHostu < 0 ? "" : zbytek.slice(konecHostu);
  const mrizka = zaHostem.indexOf("#");
  const predMrizkou = mrizka < 0 ? zaHostem : zaHostem.slice(0, mrizka);
  const fragment = mrizka < 0 ? "" : zaHostem.slice(mrizka + 1);
  const otaznik = predMrizkou.indexOf("?");
  const cesta = otaznik < 0 ? predMrizkou : predMrizkou.slice(0, otaznik);
  const query = otaznik < 0 ? "" : predMrizkou.slice(otaznik + 1);
  const dotaz = new Map<string, string>();
  // Keycloak vrací parametry v dotazu (response_mode=query); fragment se čte taky.
  if (!prectiDotaz(query, dotaz) || !prectiDotaz(fragment, dotaz)) return null;
  return { origin: `${schema}://${host.toLowerCase()}`, schema, cesta: cesta || "/", dotaz };
}

/** Smí WebView načíst `url`? Návrat na redirect se NEnačítá — zpracuje ho appka. */
export function rozhodniNavigaci(url: string, cil: CilPrihlaseni): RozhodnutiNavigace {
  if (url.startsWith(cil.redirectUri)) return "navrat";
  if (url === "about:blank") return "povolit";
  const u = rozeber(url);
  const a = rozeber(cil.authority);
  if (!u || !a) return "blokovat";
  if (a.schema === "https" && u.schema !== "https") return "blokovat";
  if (u.origin !== a.origin) return "blokovat";
  const realm = a.cesta.replace(/\/+$/, "") + "/";
  // Keycloak servíruje přihlašovací stránku pod /realms/<realm>/ a styly či písma
  // pod /resources/. Nic jiného z autority přihlášení nepotřebuje.
  const vRealmu = u.cesta.startsWith(realm);
  const zdroj = u.cesta.startsWith("/resources/");
  if (!vRealmu && !zdroj) return "blokovat";
  // Broker = přihlášení přes cizího poskytovatele (Google, Apple…).
  if (vRealmu && u.cesta.slice(realm.length).startsWith("broker/")) return "blokovat";
  return "povolit";
}

export type Navrat = { code: string } | { error: string };

/**
 * Přečte návrat z Keycloaku. `state` MUSÍ sedět — jinak by appka přijala kód,
 * o který nežádala (CSRF v OAuth). Chybu Keycloaku nese doslova (je to protokol,
 * ne osobní údaj), aby ji servis mohl ukázat.
 */
export function prectiNavrat(url: string, ocekavanyState: string): Navrat {
  const u = rozeber(url);
  if (!u) return { error: "návrat z přihlášení nejde přečíst" };
  const p = u.dotaz;
  if (!ocekavanyState || p.get("state") !== ocekavanyState) {
    return { error: "návrat z přihlášení nepatří k této žádosti (state)" };
  }
  const chyba = p.get("error");
  if (chyba) return { error: [chyba, p.get("error_description")].filter(Boolean).join(" — ") };
  const code = p.get("code");
  if (!code) return { error: "návrat z přihlášení nenese kód" };
  return { code };
}

/**
 * Styl vložený do přihlašovací stránky: skryje přihlášení přes Google/Apple,
 * passkey a „zkusit jinak". Jen kosmetika — navigaci hlídá `rozhodniNavigaci`.
 */
export const SKRYT_JINE_ZPUSOBY = `
(function () {
  var s = document.createElement('style');
  s.textContent = '#kc-social-providers, .kc-social-section, [id*="social" i], [id*="webauthn" i], [id*="passkey" i], #try-another-way, #kc-select-try-another-way-form { display: none !important; }';
  (document.head || document.documentElement).appendChild(s);
})();
true;
`;
