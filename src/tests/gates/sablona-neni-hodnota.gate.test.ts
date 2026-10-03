/**
 * Brána: nerozvinutá šablona není hodnota — a adresa má stanoviště.
 *
 * TŘÍDA VADY: soubory v konfiguračním řetězu se píšou tak, aby je uměl `source`
 * z bashe. Proto v nich stojí sebe-defaulty:
 *
 *   KEYCLOAK_DOMAIN=${KEYCLOAK_DOMAIN:-}
 *   CORE_MESH_HOST=${CORE_MESH_HOST:-core.${MESH_TLD}}
 *
 * Pro bash je to POKYN. Pro každého jiného čtenáře je to TEXT — a text je
 * pravdivostně pravda, takže projde kontrolou `if (domains.KEYCLOAK_DOMAIN)`
 * a doputuje rovnou do adresy. V config/domains.env je takových řádků 48.
 *
 * Naměřeno 2026-08-14 v každé vlně nasazení aishy i riqu:
 *   [netbird-peer-discover] fetch failed: Failed to parse URL from
 *   https://${KEYCLOAK_DOMAIN:-}/realms/aisha/protocol/openid-connect/token
 * a týmž dechem přímo z kanonické knihovny:
 *   readConfigKey("CORE_MESH_HOST") → "${CORE_MESH_HOST:-core.${MESH_TLD}}"
 *
 * DRUHÁ POLOVINA — STANOVIŠTĚ. Když se šablona odstraní, vyleze druhá vada:
 * netbird-peer-discover běží na OPERÁTORSKÉM stroji (volá ho vlnový běhec i
 * coolify-mesh-sync), ale bral `KEYCLOAK_URL`, což je adresa UVNITŘ mesh
 * (naměřeno: https://aisha-auth.mesh.aisha.internal). Zvenčí se nepřeloží.
 * Veřejná tvář má vlastní deklarovaný klíč `KEYCLOAK_DOMAIN_PUBLIC` — nic se
 * neodvozuje, jen se bere adresa pro to stanoviště, ze kterého se volá.
 *
 * CO SE TU MĚŘÍ: obojí spuštěním nad dočasnými soubory — žádný pin na text.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isUnexpandedTemplate,
  parseEnvFile,
  readConfigKey,
} from "../../../scripts/lib/config-env-files.mjs";

const ROOT = resolve(process.cwd());

function fixture(name: string, obsah: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sablona-"));
  const path = join(dir, name);
  writeFileSync(path, obsah);
  return path;
}

describe("nerozvinutá šablona není hodnota", () => {
  test("rozpozná tvary, které v těch souborech opravdu stojí", () => {
    for (const sablona of [
      "${KEYCLOAK_DOMAIN:-}",
      "${PUBLIC_TLD}",
      "${CORE_MESH_HOST:-core.${MESH_TLD}}",
      "${VERDACCIO_URL:-https://npm.${INTERNAL_TLD}/}",
      "https://${KEYCLOAK_DOMAIN}/realms/aisha",
    ]) {
      expect(isUnexpandedTemplate(sablona), `${sablona} je šablona`).toBe(true);
    }
  });

  test("nesahá na hodnoty, které jen obsahují $ nebo { — tajemství se nesmí ztratit", () => {
    for (const hodnota of [
      "auth.aisha.guru",
      "#FF6A1A",
      "he$lo",
      "100$",
      "a{b}c",
      "$", // osamocený dolar
      "pw$}x",
      "", // prázdno řeší volající, ne tahle otázka
    ]) {
      expect(isUnexpandedTemplate(hodnota), `${hodnota} NENÍ šablona`).toBe(false);
    }
  });

  test("readConfigKey: šablona neblokuje skutečnou hodnotu z pozdějšího souboru", () => {
    const sablonovy = fixture("domains.env", "KEYCLOAK_DOMAIN=${KEYCLOAK_DOMAIN:-}\n");
    const skutecny = fixture(".env.coolify", "KEYCLOAK_DOMAIN=auth.example.test\n");
    expect(readConfigKey("KEYCLOAK_DOMAIN", { files: [sablonovy, skutecny] })).toBe("auth.example.test");
  });

  test("readConfigKey: sama šablona je NIC, ne text — jinak se z ní stane adresa", () => {
    const jenSablona = fixture("domains.env", "CORE_MESH_HOST=${CORE_MESH_HOST:-core.${MESH_TLD}}\n");
    expect(readConfigKey("CORE_MESH_HOST", { files: [jenSablona] })).toBe("");
  });

  test("parseEnvFile: šablony zahodí, skutečné hodnoty (i s #) zachová, poslední neprázdná vyhraje", () => {
    const path = fixture(
      ".env.coolify",
      [
        "# komentář",
        "BRAND_COLOR=#FF6A1A",
        "GIT_REF=https://repo.test/x.git#main",
        "MESH_TLD=${MESH_TLD:-}",
        'QUOTED=\'auth.example.test\'',
        "S_KOMENTAREM=hodnota # tohle je poznámka",
        "OPAKOVANY=prvni",
        "OPAKOVANY=druhy",
        "OPAKOVANY=",
      ].join("\n"),
    );
    const env = parseEnvFile(path);
    expect(env.BRAND_COLOR).toBe("#FF6A1A");
    expect(env.GIT_REF).toBe("https://repo.test/x.git#main");
    expect(env.MESH_TLD, "šablona se nesmí vydávat za hodnotu").toBeUndefined();
    expect(env.QUOTED).toBe("auth.example.test");
    expect(env.S_KOMENTAREM).toBe("hodnota");
    expect(env.OPAKOVANY).toBe("druhy");
  });

  test("parseEnvFile: keepTemplates je jen pro nástroje, které soubor ANALYZUJÍ", () => {
    const path = fixture("domains.env", "MESH_TLD=${MESH_TLD:-}\n");
    expect(parseEnvFile(path, { keepTemplates: true }).MESH_TLD).toBe("${MESH_TLD:-}");
  });

  test("config/domains.env v repu ty sebe-defaulty pořád obsahuje — brána měří živý stav, ne minulost", () => {
    const text = readFileSync(join(ROOT, "config/domains.env"), "utf-8");
    const sebeDefaulty = text
      .split("\n")
      .filter((r) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(r))
      .filter((r) => isUnexpandedTemplate(r.slice(r.indexOf("=") + 1)));
    expect(
      sebeDefaulty.length,
      "kdyby jich bylo nula, tahle brána už nic nehlídá a patří přepsat",
    ).toBeGreaterThan(0);
  });
});

describe("adresa má stanoviště: discovery volá zvenčí, tedy veřejnou tvář", () => {
  const DISCOVER = join(ROOT, "scripts/netbird-peer-discover.mjs");

  function spustDiscover(env: Record<string, string>): string {
    try {
      execFileSync(process.execPath, [DISCOVER], {
        encoding: "utf-8",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return "";
    } catch (err: unknown) {
      const e = err as { stderr?: string; stdout?: string };
      return `${e.stderr ?? ""}${e.stdout ?? ""}`;
    }
  }

  test("veřejná tvář přebije vnitřní adresu, i když volající vnitřní podstrčí", () => {
    // Přesně situace vlnového běhce: prostředí nese mesh-vnitřní KEYCLOAK_URL,
    // protože ho tam vysypala topologie pro služby BĚŽÍCÍ V MESH.
    //
    // ⚠️ POZOROVACÍ BOD SE 2026-08-20 PŘESUNUL, vlastnost NE. Dřív stačilo dát
    // sem NETBIRD_MGMT_SECRET a nechat nástroj razit token servisním účtem.
    // Ten ústup byl odstraněn (zakládal mesh účet na identitu, kterou IdP nevidí,
    // což je nevratné), takže se sem musí podstrčit pověření bootstrap uživatele
    // — hlavní a nově JEDINÁ cesta. Razí proti témuž `cfg.keycloakUrl`, takže
    // se měří pořád totéž: adresa má stanoviště a vnitřní se ven nedostane.
    const vystup = spustDiscover({
      KEYCLOAK_URL: "https://vnitrni.mesh.test",
      KEYCLOAK_PUBLIC_URL: "https://auth.verejna.test",
      NETBIRD_API_URL: "https://netbird.verejna.test",
      AISHA_BOOTSTRAP_CLIENT_SECRET: "x",
      AISHA_BOOTSTRAP_PASSWORD: "x",
      // ⛔ JMÉNO A REALM MUSÍ BÝT SMYŠLENÉ, i když sem adresu podstrkujeme.
      // Nástroj si chybějící hodnoty dotahuje z konfiguračních souborů v repu,
      // takže kdyby tahle fixtura o adresu někdy přišla, mířila by na ŽIVÝ
      // Keycloak — a realm má brute-force (maxFailures=5). Pět běhů brány by
      // dočasně uzamklo právě ten účet, na kterém stojí vlastnictví mesh účtu.
      // Test nesmí umět ublížit tomu, co měří.
      AISHA_BOOTSTRAP_USERNAME: "fixtura-neexistujici-uzivatel",
      KEYCLOAK_REALM: "fixtura-neexistujici-realm",
    });
    expect(vystup).toContain("auth.verejna.test");
    expect(vystup, "vnitřní adresa se ven dostat nesmí").not.toContain("vnitrni.mesh.test");
  });

  test("do adresy se nikdy nedostane literál se šablonou", () => {
    const vystup = spustDiscover({
      NETBIRD_API_URL: "https://netbird.verejna.test",
      NETBIRD_MGMT_SECRET: "x",
    });
    expect(vystup).not.toMatch(/\$\{[A-Za-z_]/);
  });
});
