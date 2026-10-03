/**
 * Brána: každý `*-proxy` klient musí vydávat token s `aud` na sebe sama.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * OAuth2 Proxy ověřuje v callbacku, že `aud` obsahuje jeho `client_id`. Keycloak
 * sám od sebe vydá jen `azp`, takže bez audience mapperu je token pro proxy
 * nepoužitelný a chráněný povrch skončí na 500.
 *
 * ⛔ NAMĚŘENO 2026-08-26, den po wipu: `extra.<veřejná doména>` vracelo
 *
 *   Error creating session during OAuth2 callback:
 *     audience claims [aud] do not exist in claims: map[azp:extranet-proxy email:…]
 *
 * Přihlášení proběhlo (e-mail v tokenu byl), chyběl jen `aud`. Postiženo bylo
 * VŠECH OSM proxy klientů — tedy i admin, n8n, openclaw, pki a studio.
 *
 * ── A PROČ TO PŘEDTÍM FUNGOVALO ───────────────────────────────────────────────
 * Nerozbilo se to. NIKDY TO NEBYLO REPRODUKOVATELNÉ: mapper žil jen v BĚŽÍCÍM
 * Keycloaku, ne v `keycloak/aisha-realm.json`. Dokud se realm nepřestavěl,
 * povrch fungoval. Wipe ho postavil ze zdroje pravdy — a ten mapper neměl.
 *
 * Táž vada se přitom už jednou našla a opravila: commit 57a513487
 * („self-heal pki-proxy audience mapper") ji vyřešil pro JEDNOHO klienta a
 * riziko dokonce pojmenoval — „if the realm import skipped the client mapper
 * (partial import, pre-existing realm…)". Zbylých sedm zůstalo.
 * Proto tahle brána iteruje CELOU rodinu, ne vzorek jmen.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

type Mapper = { name?: string; protocolMapper?: string; config?: Record<string, string> };
type Client = { clientId?: string; protocolMappers?: Mapper[] };

const realm = JSON.parse(readFileSync(join(ROOT, "keycloak/aisha-realm.json"), "utf-8")) as {
  clients?: Client[];
};
const proxyKlienti = (realm.clients ?? []).filter((c) => (c.clientId ?? "").endsWith("-proxy"));
const maAudience = (c: Client) =>
  (c.protocolMappers ?? []).some((m) => /audience/i.test(m.protocolMapper ?? ""));

describe("proxy klient vydává token s aud na sebe sama", () => {
  test("univerzum není prázdné — jinak by brána mlčela místo měření", () => {
    expect(proxyKlienti.length, "v realmu není ani jeden *-proxy klient").toBeGreaterThan(3);
  });

  test("KAŽDÝ *-proxy klient má v realm JSONu audience mapper", () => {
    const bez = proxyKlienti.filter((c) => !maAudience(c)).map((c) => c.clientId);
    expect(
      bez,
      "bez audience mapperu Keycloak vydá jen `azp` a OAuth2 Proxy odmítne token " +
        "v callbacku → chráněný povrch skončí na 500",
    ).toEqual([]);
  });

  test("mapper míří na VLASTNÍ clientId, ne na cizí", () => {
    // Audience na cizího klienta by token pustila jinam, než patří — a chyba by
    // se projevila až u druhé služby, daleko od příčiny.
    for (const c of proxyKlienti) {
      const m = (c.protocolMappers ?? []).find((x) => /audience/i.test(x.protocolMapper ?? ""));
      expect(
        m?.config?.["included.client.audience"],
        `${c.clientId}: audience mapper musí vkládat vlastní clientId`,
      ).toBe(c.clientId);
    }
  });

  test("mapper vkládá aud do ID i access tokenu", () => {
    for (const c of proxyKlienti) {
      const m = (c.protocolMappers ?? []).find((x) => /audience/i.test(x.protocolMapper ?? ""));
      expect(m?.config?.["access.token.claim"], `${c.clientId}: access token`).toBe("true");
      expect(m?.config?.["id.token.claim"], `${c.clientId}: id token`).toBe("true");
    }
  });

  test("provision-sso to LÉČÍ i na už existujícím realmu — a univerzum si HLEDÁ", () => {
    // Realm JSON pokryje jen NOVÉ realmy; produkce běží na realmu, který import
    // nepřepíše. Léčicí cesta proto musí existovat — a nesmí mít ručně psaný
    // seznam klientů, jinak nový proxy klient tiše vypadne (to je právě ta vada,
    // kvůli které tahle brána vznikla: opraveno pro jednoho z osmi).
    const sh = readFileSync(join(ROOT, "scripts/provision-sso.sh"), "utf-8");
    expect(sh, "chybí funkce, která mapper doplní").toMatch(/ensure_audience_mapper\s*\(\)/);
    expect(sh, "musí zakládat právě oidc-audience-mapper").toMatch(/oidc-audience-mapper/);
    expect(
      sh,
      "seznam proxy klientů se musí ČÍST z realmu, ne opisovat",
    ).toMatch(/clientId":"\[\^"\]\*-proxy"/);
    // ⛔ A NESMÍ TO VISET VE VĚTVI `--check`. Přesně tam jsem to 2026-08-26
    // nejdřív vložil — ukotvil jsem se na seznam `check_client`, aniž bych
    // ověřil, v jaké větvi leží, a provisioning proběhl s EXIT=0, aniž by
    // mapper vznikl. Cold-start volá `--prod --keycloak-only`, tedy APPLY cestu.
    //
    // Kotva je ZÁPIS SECRETŮ: `_try_secret` mění stav, takže v kontrolním
    // režimu být nemůže. Co je za ním, je prokazatelně v apply cestě.
    const iSecret = sh.indexOf('_try_secret "extranet-proxy"');
    const iVolani = sh.indexOf('ensure_audience_mapper "$_pc"');
    expect(iSecret, "kotva `_try_secret` se nenašla — brána by měřila prázdno").toBeGreaterThan(0);
    expect(iVolani, "volání ensure_audience_mapper se nenašlo").toBeGreaterThan(0);
    expect(
      iVolani > iSecret,
      "volání leží PŘED razítkováním secretů, tedy nejspíš ve větvi --check — " +
        "cold-start ji nevolá, takže by mapper nikdy nevznikl",
    ).toBe(true);
  });
});
