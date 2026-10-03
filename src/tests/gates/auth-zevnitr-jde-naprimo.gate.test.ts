/**
 * Brána: Keycloak se ZEVNITŘ volá NAPŘÍMO, ne přes https na vnitřní jméno.
 *
 * TŘÍDA VADY: adresa se složí jako `https://` + jméno pod vnitřní TLD. Pro
 * takové jméno nevydá certifikát žádná veřejná CA — a vnitřní CA je právě to,
 * co teprve vzniká. TLS proto selže na neshodě jména a volající dostane cizí
 * certifikát toho, kdo na té adrese náhodou odpovídá.
 *
 * ⛔ NAMĚŘENO 2026-08-19 na riqi, DVAKRÁT nezávisle:
 *
 *   pki-init:   ❌ curl (60) SSL: no alternative certificate subject name
 *               matches target hostname '<fork>-auth.backend.<fork>.internal'
 *
 *   management: ERRO Error when validating JWT: Post "https://<fork>-auth.
 *               backend.<fork>.internal/…": x509: certificate is valid for
 *               *.evymo.com, not <fork>-auth.backend.<fork>.internal
 *
 * Druhý případ odmítl KAŽDÝ token, takže nevznikl účet ani setup key
 * (accounts=0, setup_keys=0), agenti hlásili „setup key is invalid", nikde
 * nevzniklo `wt0`, mesh-router DNAToval bez cíle a api vracelo 502. Jedna
 * neověřitelná adresa položila celý mesh.
 *
 * ⭐ PROČ JE AUTH VÝJIMKA (rozhodnuto majitelem 2026-08-19)
 * Mesh MÁ být jediná cesta dovnitř a vnitřní jména se ven nepublikují. Auth je
 * z toho pravidla vyjmutý na OBĚ strany: ven jde přes edge jako všechno ostatní,
 * a ZEVNITŘ se na něj chodí NAPŘÍMO kontejnerovou sítí — protože mesh enrollment
 * sám Keycloak potřebuje. Opřít bootstrap o mesh je kruh.
 *
 * CO SE MĚŘÍ: nikde se nesmí skládat `https://` + proměnná, která nese VNITŘNÍ
 * tvář Keycloaku. `https://${NETBIRD_MESH_HOST}` je naopak v pořádku — ten
 * certifikát naše PKI vydává, je to VÝSLEDEK bootstrapu, ne jeho předpoklad.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(process.cwd());

/** Proměnné nesoucí VNITŘNÍ tvář Keycloaku — na ty se přes https nesmí. */
const VNITRNI_TVAR_AUTH = /\$\{[A-Z_]*KEYCLOAK[A-Z_]*(DIRECT|FROM_CLUSTER|INTERNAL)[A-Z_]*\}/;
const SCHEMA_PRED_PROMENNOU = /https:\/\/\$\{[A-Z_]+\}/;

/** Univerzum se HLEDÁ — přibude soubor a brána ho začne měřit sama. */
function nositele(): string[] {
  try {
    return execFileSync("git", ["grep", "-lE", "KEYCLOAK[A-Z_]*(DIRECT|FROM_CLUSTER|INTERNAL)", "--",
      "*.yml", "*.yaml", "*.template", "*.json", "*.sh", "*.mjs"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function vadneRadky(text: string): string[] {
  const vady: string[] = [];
  for (const radek of text.split("\n")) {
    const orez = radek.trim();
    if (/^(#|\/\/|\*)/.test(orez)) continue; // komentář popisuje vadu, nezpůsobuje ji
    if (!SCHEMA_PRED_PROMENNOU.test(radek)) continue;
    if (!VNITRNI_TVAR_AUTH.test(radek)) continue;
    vady.push(orez.slice(0, 150));
  }
  return vady;
}

describe("auth se zevnitř volá napřímo", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    expect(vadneRadky('"TokenEndpoint": "https://${KEYCLOAK_DOMAIN_FROM_CLUSTER}/realms/x"')).toHaveLength(1);
    expect(vadneRadky('KEYCLOAK_URL="https://${KEYCLOAK_DOMAIN_DIRECT}"')).toHaveLength(1);
    expect(
      vadneRadky('"TokenEndpoint": "${KEYCLOAK_URL_FROM_CLUSTER}/realms/x"'),
      "celá URL z proměnné je SPRÁVNÉ řešení",
    ).toEqual([]);
    expect(
      vadneRadky("NB_MANAGEMENT_URL: https://${NETBIRD_MESH_HOST}:33073"),
      "mesh endpoint certifikát OD NAŠÍ PKI má — je to výsledek bootstrapu, ne předpoklad",
    ).toEqual([]);
    expect(
      vadneRadky('# tady stálo `https://${KEYCLOAK_DOMAIN_DIRECT}` a bylo to špatně'),
      "komentář o vadě není vada",
    ).toEqual([]);
  });

  test("nikde se neskládá https:// + vnitřní tvář Keycloaku", () => {
    const soubory = nositele();
    expect(soubory.length, "brána si univerzum HLEDÁ — nula souborů znamená, že měřidlo osleplo").toBeGreaterThan(0);
    const vady: string[] = [];
    for (const rel of soubory) {
      for (const r of vadneRadky(readFileSync(resolve(ROOT, rel), "utf-8"))) vady.push(`${rel}: ${r}`);
    }
    expect(
      vady,
      "pro jméno pod vnitřní TLD neexistuje ověřitelný certifikát dřív, než bootstrap doběhne — " +
        "předej CELOU vnitřní URL (http://<prefix>-keycloak:80), ne doménu se schématem:\n  " + vady.join("\n  "),
    ).toEqual([]);
  });
});
