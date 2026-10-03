/**
 * Overlay povrchu ↔ derivace topologie — tři hodnoty, které nikdo neporovnával.
 *
 * ⛔ NAMĚŘENO 2026-09-13. `surfaces/<instance>/app.config.json` v instančním repu
 * nese adresu API, issuer a client_id jako LITERÁLY:
 *
 *     api.postgrest_url   https://api.<public_tld>/rest/v1
 *     auth.issuer         https://auth.<public_tld>/realms/<realm>
 *     auth.client_id      <prefix>-extranet
 *
 * a `apps/workbench-shell/vite.config.ts` je čte DOSLOVA (define
 * `__AISHA_INSTANCE__`). Tytéž tři veličiny přitom platforma ODVOZUJE jinde:
 *
 *   · API_DOMAIN_PUBLIC, KEYCLOAK_DOMAIN_PUBLIC — derive-domains.mjs,
 *   · KC_ISSUER = https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}
 *     — tím issuerem gateway OVĚŘUJE token (docker-compose.coolify.yml),
 *   · klient `${APP_NAME_PREFIX}-${surface}` — zakládá ho
 *     scripts/provision-surfaces.sh v realmu KEYCLOAK_REALM.
 *
 * Dnes hodnoty sedí (změřeno proti derivaci instance), ale nic je nedrží
 * u sebe. Rozejdou-li se, NIC nespadne: povrch se postaví, přihlášení skončí
 * u cizího IdP / neexistujícího klienta, nebo token s jiným issuerem gateway
 * odmítne — a pozná se to až očima (táž třída jako 2026-08-22, kdy se povrch
 * postavil z referenční šablony).
 *
 * PROČ KONTROLA A NE ODVOZENÍ PŘI BUILDU (změřeno 2026-09-13): build by
 * potřeboval pět nových build argů (API_DOMAIN_PUBLIC, KEYCLOAK_DOMAIN_PUBLIC,
 * KEYCLOAK_REALM, APP_NAME_PREFIX a jméno povrchu, které dnes nedostává ani
 * compose, ani provision-surfaces.sh) — a mimo Coolify (`surfaces-build-all.sh`,
 * lokální vite) by je neměl odkud vzít; zbyl by fallback na literál z overlaye,
 * tedy dva zdroje téže hodnoty. Týž den se ukázalo, jak křehké je spoléhat na
 * doručení build argů (extranet: `if [ -n "" ]`). Kontrola tam, kde se overlay
 * už čte, nic z toho nepotřebuje.
 *
 * Tenhle modul jen POROVNÁVÁ. Nečte prostředí ani overlay — vstupy mu dá
 * volající (derive-domains.mjs nad hotovým výstupem derivace), aby se dal
 * měřit na syntetických vstupech bez celé topologie.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Soubor, kde gateway registruje proxy na PostgREST. */
export const GATEWAY_SERVER_SOUBOR = "services/gateway/src/server.ts";

/**
 * Prefix, pod kterým gateway vystavuje PostgREST — ČTE SE ZE ZDROJE gateway,
 * neopisuje. Opsaný literál by přežil přejmenování cesty a kontrola by pak
 * zeleně porovnávala proti adrese, na které už nikdo neposlouchá.
 *
 * @returns {string} např. "/rest/v1"
 */
export function gatewayRestPrefix(root) {
  const soubor = resolve(root, GATEWAY_SERVER_SOUBOR);
  const src = readFileSync(soubor, "utf8");
  const m = src.match(/register\(\s*restProxy\s*,\s*\{\s*prefix:\s*['"]([^'"]+)['"]/);
  if (!m) {
    throw new Error(
      `${GATEWAY_SERVER_SOUBOR}: registrace restProxy s prefixem nenalezena — ` +
        `kontrola overlaye povrchu neví, proti jaké cestě PostgREST porovnávat`,
    );
  }
  return m[1];
}

const bezKoncovehoLomitka = (s) => String(s ?? "").replace(/\/+$/, "");

/**
 * client_id, se kterým se shell povrchu SKUTEČNĚ přihlásí.
 *
 * Změřeno ve shellu: `apps/workbench-shell/src/auth.ts` —
 * `cfg.workbench?.client_id ?? cfg.auth.client_id`; `instance.ts` popisuje
 * sekci shellu jako přepis klienta pro overlay sdílený více shelly. Klíč sekce
 * je jméno shellu bez přípony `-shell` (workbench-shell → workbench).
 */
export function efektivniKlient(config, shell) {
  const sekce = String(shell ?? "").replace(/-shell$/, "");
  return config?.[sekce]?.client_id ?? config?.auth?.client_id;
}

/**
 * Porovná overlay povrchu s tím, co platforma odvodila.
 *
 * @param {object} p
 * @param {object} p.config          obsah app.config.json
 * @param {string} p.soubor          cesta k app.config.json (do hlášky)
 * @param {{name:string, shell:string}[]} p.povrchy  povrchy z profilu
 * @param {string} p.prefix          vydaný APP_NAME_PREFIX
 * @param {string} p.apiDomena       vydaný API_DOMAIN_PUBLIC
 * @param {string} p.keycloakDomena  vydaný KEYCLOAK_DOMAIN_PUBLIC
 * @param {string} p.restPrefix      prefix PostgREST v gateway
 * @param {string} p.realm           KEYCLOAK_REALM; prázdný = realm NEZMĚŘEN
 * @returns {{ nesoulady: string[], nezmereno: string[] }}
 */
export function nesouladyPovrchu({ config, soubor, povrchy, prefix, apiDomena, keycloakDomena, restPrefix, realm }) {
  const nesoulady = [];
  const nezmereno = [];
  const ohlas = (co, overlay, derivace, zdroj) =>
    nesoulady.push(
      `${co}: overlay '${overlay ?? "(chybí)"}' × derivace '${derivace}' (${zdroj}) — ${soubor}`,
    );

  // Odvozená strana musí EXISTOVAT. Prázdná derivace není shoda, je to
  // nezměřená kontrola — a ta se nesmí tvářit jako průchod.
  for (const [jmeno, hodnota] of [
    ["API_DOMAIN_PUBLIC", apiDomena],
    ["KEYCLOAK_DOMAIN_PUBLIC", keycloakDomena],
    ["APP_NAME_PREFIX", prefix],
  ]) {
    if (!hodnota) nesoulady.push(`derivace nevydala ${jmeno} — overlay povrchu (${soubor}) není s čím porovnat`);
  }
  if (nesoulady.length > 0) return { nesoulady, nezmereno };

  const api = `https://${apiDomena}${restPrefix}`;
  if (bezKoncovehoLomitka(config?.api?.postgrest_url) !== bezKoncovehoLomitka(api)) {
    ohlas("api.postgrest_url", config?.api?.postgrest_url, api, `https://\${API_DOMAIN_PUBLIC}${restPrefix}`);
  }

  const issuer = bezKoncovehoLomitka(config?.auth?.issuer);
  if (realm) {
    const ocekavany = `https://${keycloakDomena}/realms/${realm}`;
    if (issuer !== ocekavany) {
      ohlas("auth.issuer", config?.auth?.issuer, ocekavany, "KC_ISSUER = https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}");
    }
  } else {
    // Realm derivace nevydává — je to deklarace instance. Bez ní se měří jen
    // původ issueru a zbytek se PŘIZNÁ, ne zamlčí.
    const puvod = `https://${keycloakDomena}/realms/`;
    if (!issuer.startsWith(puvod) || issuer.length === puvod.length) {
      ohlas("auth.issuer", config?.auth?.issuer, `${puvod}<realm>`, "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/…");
    }
    nezmereno.push(`realm v auth.issuer (${config?.auth?.issuer}) — KEYCLOAK_REALM není deklarovaný`);
  }

  for (const p of povrchy ?? []) {
    const ocekavany = `${prefix}-${p.name}`;
    const skutecny = efektivniKlient(config, p.shell);
    if (skutecny !== ocekavany) {
      const sekce = String(p.shell ?? "").replace(/-shell$/, "");
      ohlas(
        `client_id povrchu '${p.name}' (shell ${p.shell}: ${sekce}.client_id ?? auth.client_id)`,
        skutecny,
        ocekavany,
        "provision-surfaces.sh zakládá klienta ${APP_NAME_PREFIX}-${surface}",
      );
    }
  }
  return { nesoulady, nezmereno };
}
