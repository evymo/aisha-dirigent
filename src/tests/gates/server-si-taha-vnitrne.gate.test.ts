/**
 * CO SI SERVER STAHUJE SÁM, TAHÁ VNITŘNĚ. VEŘEJNÁ ZŮSTÁVÁ JEN IDENTITA.
 *
 * ⛔ NAMĚŘENO 2026-08-23. `netbird-management` se nespustil:
 *
 *     loading OIDC configuration from the IDP configuration endpoint
 *       https://auth.<tld>/realms/<realm>/.well-known/openid-configuration
 *     Error: OIDC configuration request returned status 503 → exit 1
 *
 * Ta 503 nepřišla z Keycloaku — ten byl ZDRAVÝ. Přišla od brány, protože
 * `edge` měl 0 kontejnerů. Veřejná adresa vede přes edge, a edge se podle
 * návrhu nasazuje AŽ NAKONEC (dokud se platforma zvedá, nemá být zvenku
 * vidět nic). Server, který si při bootu sahá na veřejnou adresu, tím na
 * sebe váže dveře, které v tu chvíli ještě nikdo neotevřel.
 *
 * Šablona ten princip UŽ DRŽELA u tří polí ze čtyř — `AuthKeysLocation`,
 * `TokenEndpoint` a `AdminEndpoint` míří dovnitř. `OIDCConfigEndpoint` byl
 * jediná výjimka a přesně on to shodil.
 *
 * ⭐ Rozlišení není „veřejné × vnitřní", ale ROLE pole:
 *   · IDENTITA (Issuer, Audience) — veřejná, musí být stabilní, jinak se
 *     rozejde s tokeny, které drží prohlížeč
 *   · FETCH (…Endpoint, …Location) — vnitřní, je to serverový hovor
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SABLONA = join(ROOT, "coolify/netbird-management.json.template");
const text = readFileSync(SABLONA, "utf-8");

/**
 * Pole, která volá SERVER — a to se pozná podle BLOKU, ne podle přípony názvu.
 *
 * ⛔ První verze téhle brány brala každé `*Endpoint` jako serverový hovor a
 * označila i `PKCEAuthorizationFlow`. Ten ale otevírá PROHLÍŽEČ UŽIVATELE
 * (`RedirectURLs: localhost:53000`) — tam veřejná adresa být MUSÍ. „Opravit"
 * je na vnitřní by rozbilo přihlašování z klientských strojů.
 *
 * Klientské toky se jmenují `*AuthorizationFlow`; všechno ostatní volá server.
 */
const KLIENTSKE_BLOKY = /"[A-Za-z]*AuthorizationFlow"\s*:\s*\{[\s\S]*?\n {4}\}/g;
const FETCH = /"([A-Za-z]*(?:Endpoint|Location|URL))"\s*:\s*"([^"]*)"/g;
/** Pole, která nesou IDENTITU vydavatele. */
const IDENTITA = /"(Issuer|AuthIssuer|Audience|AuthAudience)"\s*:\s*"([^"]*)"/g;

describe("server si tahá vnitřně (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect([...text.matchAll(FETCH)].length, "šablona nevydala ANI JEDNO fetch pole").toBeGreaterThan(0);
    expect([...text.matchAll(IDENTITA)].length, "šablona nevydala ANI JEDNO pole identity").toBeGreaterThan(0);
  });

  test("žádný serverový fetch nevede přes veřejnou adresu (tedy přes edge)", () => {
    // Klientské toky z textu vyjmout — ty veřejné být MAJÍ.
    let serverova = text;
    for (const blok of text.matchAll(KLIENTSKE_BLOKY)) serverova = serverova.replace(blok[0], "");
    expect(
      serverova.length,
      "vyjmutí klientských toků sežralo celou šablonu — brána by neměřila nic",
    ).toBeGreaterThan(text.length / 2);

    const venku: string[] = [];
    for (const [, pole, hodnota] of serverova.matchAll(FETCH)) {
      if (hodnota.includes("KEYCLOAK_DOMAIN_PUBLIC")) venku.push(`${pole} → ${hodnota}`);
    }
    expect(
      venku,
      "tyhle serverové hovory jdou přes VEŘEJNOU adresu:\n  " +
        venku.join("\n  ") +
        "\n\nVeřejná adresa vede přes `edge`, který se nasazuje AŽ NAKONEC — takže\n" +
        "se ta služba při bootu váže na dveře, které ještě nikdo neotevřel, a\n" +
        "spadne na 503 od brány (ne od Keycloaku!). Použij `KEYCLOAK_URL_FROM_CLUSTER`,\n" +
        "jak to už dělají AuthKeysLocation, TokenEndpoint i AdminEndpoint.",
    ).toEqual([]);
  });

  test("identita vydavatele naopak VEŘEJNÁ zůstává", () => {
    const uvnitr: string[] = [];
    for (const [, pole, hodnota] of text.matchAll(IDENTITA)) {
      if (hodnota.includes("KEYCLOAK_URL_FROM_CLUSTER")) uvnitr.push(`${pole} → ${hodnota}`);
    }
    expect(
      uvnitr,
      "identita vydavatele ukazuje dovnitř:\n  " +
        uvnitr.join("\n  ") +
        "\n\nIssuer musí být týž, jaký je v tokenech, které drží prohlížeč — jinak\n" +
        "ověření selže. Vnitřní adresa je cesta, ne identita.",
    ).toEqual([]);
  });
});
