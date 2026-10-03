/**
 * Brána: adresa-zevnitř-clusteru-není-veřejná
 *
 * INVARIANT (dvě tvrzení o šabloně `management.json` NetBirdu):
 *
 *   1. Adresy, na které volá SÁM MANAGEMENT (JWKS, token endpoint IdP manažera,
 *      admin endpoint), se NESMÍ odvíjet od veřejné tváře Keycloaku. Ta je
 *      zevnitř clusteru neviditelná.
 *   2. `AuthIssuer` naopak veřejnou tvář nést MUSÍ — musí doslova sedět
 *      s claimem `iss` v tokenu, který Keycloak vydává pod svým pevným
 *      hostnamem.
 *
 * A jedno tvrzení o doručení:
 *
 *   3. Každá proměnná, kterou šablona používá, je v prostředí `netbird-init`
 *      opravdu doručená. `envsubst` totiž nedoručenou proměnnou nahradí
 *      PRÁZDNEM — vznikne `https:///realms/...`, což je syntakticky platná
 *      konfigurace mířící nikam. Chyba se pak projeví až za běhu jako
 *      autentizační problém.
 *
 * ⛔ NAMĚŘENO 2026-08-14 na aisha.guru — kruh, který se uzavřel sám na sobě:
 *   · z talosu: `https://auth.aisha.guru/realms/aisha/…/certs` → HTTP 404
 *     „edge-proxy: unknown host (no rule matched)" (zvenčí přitom 200),
 *   · management proto nestáhl JWKS a KAŽDÝ platný token odmítl:
 *     `getPublicKey error: unable to find appropriate key` → `/api/groups 401`,
 *   · bez API nešlo vyrobit setup keys → agenti: „setup key is invalid",
 *   · mesh zůstala prázdná → edge neměl kam routovat → veřejná tvář 404.
 *
 * Táž třída jako `pki-init` (#912) a `netbird-bootstrap`: **bootstrap nesmí
 * stát na tváři, kterou sám teprve umožňuje.** Rozdíl je jen ve stanovišti —
 * jednou zevnitř clusteru, jednou z operátorského stroje.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const SABLONA = path.join(ROOT, "coolify/netbird-management.json.template");
const COMPOSE = path.join(ROOT, "docker-compose.coolify-netbird.yml");

const VEREJNA = "KEYCLOAK_DOMAIN_PUBLIC";

/**
 * CESTY, ne jména klíčů. `TokenEndpoint` je v šabloně DVAKRÁT a pokaždé pro
 * jiné stanoviště: jednou ho volá management (IdP manažer), jednou ho dostane
 * PROHLÍŽEČ (PKCE flow). Kdyby brána měřila podle jména, spletla by si je —
 * a tím by buď hlásila falešný poplach, nebo tiše přehlédla tu skutečnou.
 */
const VOLA_MANAGEMENT = [
  ["HttpConfig", "AuthKeysLocation"],
  ["IdpManagerConfig", "ClientConfig", "TokenEndpoint"],
  ["IdpManagerConfig", "ExtraConfig", "AdminEndpoint"],
];
/** Cesty, které jsou IDENTITOU a musí sedět s claimem `iss` v tokenu. */
const IDENTITA = [["HttpConfig", "AuthIssuer"]];

const sablona = readFileSync(SABLONA, "utf8");
const compose = parse(readFileSync(COMPOSE, "utf8"));
/** Šablona je platný JSON — `${VAR}` je uvnitř uvozovek, takže se dá projít strukturou. */
const strom = JSON.parse(sablona) as Record<string, unknown>;

function naCeste(cesta: string[]): string {
  let uzel: unknown = strom;
  for (const krok of cesta) {
    if (uzel === null || typeof uzel !== "object") {
      throw new Error(`cesta ${cesta.join(".")} v šabloně neexistuje (spadlo na "${krok}")`);
    }
    uzel = (uzel as Record<string, unknown>)[krok];
  }
  if (typeof uzel !== "string") {
    throw new Error(`cesta ${cesta.join(".")} není řetězec — šablona se změnila, brána by měřila prázdno`);
  }
  return uzel;
}

describe("brána: adresa zevnitř clusteru není veřejná tvář", () => {
  it("šablona i compose se opravdu načetly (mlčení není měření)", () => {
    expect(sablona.length, "prázdná šablona").toBeGreaterThan(200);
    expect(compose?.services?.["netbird-init"], "netbird-init v compose chybí").toBeTruthy();
  });

  it("adresy, na které management volá sám, nestojí na veřejné tváři", () => {
    const provinilci: string[] = [];
    for (const cesta of VOLA_MANAGEMENT) {
      const hodnota = naCeste(cesta);
      if (hodnota.includes(`\${${VEREJNA}}`)) provinilci.push(`${cesta.join(".")} = ${hodnota}`);
    }
    expect(
      provinilci,
      "Tohle volá management ZEVNITŘ clusteru, kde veřejná tvář vrací 404 od edge.\n" +
        "Použij tvář dosažitelnou z clusteru (KEYCLOAK_DOMAIN_FROM_CLUSTER):\n  " +
        provinilci.join("\n  "),
    ).toEqual([]);
  });

  it("issuer naopak veřejnou tvář nese (musí sedět s `iss` v tokenu)", () => {
    for (const cesta of IDENTITA) {
      expect(
        naCeste(cesta),
        `${cesta.join(".")} musí nést veřejnou tvář — token nese \`iss\` s pevným hostnamem ` +
          "Keycloaku a management ho porovnává doslova",
      ).toContain(`\${${VEREJNA}}`);
    }
  });

  it("každá proměnná ze šablony je v prostředí netbird-init doručená", () => {
    const pouzite = new Set(
      [...sablona.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]),
    );
    expect(pouzite.size, "šablona nepoužívá žádnou proměnnou — sken je vadný").toBeGreaterThan(3);
    const dorucene = new Set(Object.keys(compose.services["netbird-init"].environment ?? {}));
    const chybi = [...pouzite].filter((k) => !dorucene.has(k));
    expect(
      chybi,
      "`envsubst` nedoručenou proměnnou nahradí PRÁZDNEM — vznikne adresa jako\n" +
        "`https:///realms/...`, tedy platná konfigurace mířící nikam:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });
});
