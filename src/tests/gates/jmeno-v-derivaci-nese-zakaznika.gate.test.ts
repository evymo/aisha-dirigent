/**
 * Brána: JMÉNO, které derivace VYDÁ, nese identitu ZÁKAZNÍKA (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-08-22 (majitel: „je to pomalé"). `derive-domains.mjs` vydávalo
 *
 *     SHARED_REDIS_HOST=${serviceAliasPrefix()}-shared-redis   →  aisha-shared-redis
 *
 * jenže `docker-compose.coolify-shared-redis.yml` si dává alias i container_name
 * z `${APP_NAME_PREFIX:?identita instance}` — tedy `<zákazník>-shared-redis`.
 * Komentář u té emise přitom TVRDIL, že compose bere SERVICE_ALIAS_PREFIX. Nebral.
 *
 * DŮSLEDEK: gateway hledala jméno, které se NEPŘELOŽÍ; ioredis to opakoval s
 * odstupem a KAŽDÝ požadavek, který sáhl na Redis, čekal ~28 s. Nic nespadlo —
 * kontejner healthy, HTTP 200, jen o půl minuty později. 43 chyb za 5 minut.
 *
 * ⭐ A POMALOST BYLA TA MÍRNĚJŠÍ VARIANTA. Kdyby implementační jméno na tom
 * hostiteli EXISTOVALO, připojili bychom se RYCHLE k CIZÍMU Redisu: sdílená síť
 * `coolify` měla 2026-08-16 při měření 149 aplikací a 8 zákaznických prefixů a
 * docker mezi stejnojmennými ROUND-ROBINUJE. Vada je bezpečnostní, ne výkonnostní.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   1. `serviceAliasPrefix()` (jméno IMPLEMENTACE, stejné pro všechny instance)
 *      neskládá ŽÁDNÉ vydávané jméno — smí vydat jen sám sebe;
 *   2. PÁR deklarace ↔ odkaz: prefix, ze kterého skládá jméno compose, se musí
 *      shodovat s prefixem, ze kterého skládá TÉŽ jméno derivace.
 *
 * Sousední brána `jmeno-na-sdilene-siti-nese-identitu` hlídá KLÍČE SLUŽEB
 * v compose. Tahle je druhá půlka: hodnoty, které derivace vydá do `.env.coolify`.
 * Právě mezi ně `SHARED_REDIS_HOST` propadlo.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

const ROOT = resolve(__dirname, "../../..");
const DERIVACE = "scripts/lib/derive-domains.mjs";

/** Zdroj bez komentářů — brána nesmí měřit vlastní vysvětlující text. */
export function kodBezKomentaru(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

/** Vydávaná jména složená z prefixu IMPLEMENTACE (mimo vydání jeho samého). */
export function jmenaZImplementacnihoPrefixu(kod: string): string[] {
  const out: string[] = [];
  const re = /lines\.push\(`([A-Z_]+)=\$\{serviceAliasPrefix\(\)\}([^`]*)`\)/g;
  for (const m of kod.matchAll(re)) {
    if (m[1] === "SERVICE_ALIAS_PREFIX" && m[2] === "") continue; // vydává sám sebe
    out.push(`${m[1]}=\${serviceAliasPrefix()}${m[2]}`);
  }
  return out;
}

describe("jméno vydané derivací nese identitu zákazníka", () => {
  const kod = kodBezKomentaru(readFileSync(join(ROOT, DERIVACE), "utf-8"));

  test("prefix IMPLEMENTACE neskládá žádné vydávané jméno", () => {
    expect(
      jmenaZImplementacnihoPrefixu(kod).sort(),
      "`serviceAliasPrefix()` je `aisha` pro KAŽDOU instanci, takže jméno z něj složené\n" +
        "nemíří na konkrétní instanci, ale na kteroukoli, kterou docker vybere.\n" +
        "Na sdílené síti to znamená buď ticho (jméno neexistuje → čekání), nebo\n" +
        "rychlé připojení k CIZÍ instanci. Skládej ze zákaznické identity.",
    ).toEqual([]);
  });

  test("adresa pro konzumenty je MESH jméno, ne alias na sdílené síti", () => {
    // ⚠️ Tenhle test dřív porovnával prefix v compose s prefixem v derivaci.
    // Bylo to správné pro stav, kdy `SHARED_REDIS_HOST` skládala derivace ze
    // zákaznického prefixu — jenže to byl MEZISTAV. Dnes tu adresu vydává
    // KATALOG (`internal_tcp_endpoints[].env_aliases`) jako MESH jméno, protože
    // shared-redis je mesh peer. Brána proto měří to, co platí teď: adresa
    // konzumenta patří peeru, ne sdílené síti.
    const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
    const sluzby = katalog.services ?? katalog;
    const redis = sluzby["shared-redis"];
    expect(redis, "shared-redis v katalogu chybí — pak ho verdikt mesh-konformity nevidí").toBeDefined();

    const aliasy = (redis.internal_tcp_endpoints ?? []).flatMap((e: { env_aliases?: string[] }) => e.env_aliases ?? []);
    expect(
      aliasy,
      "SHARED_REDIS_HOST nevydává katalog — buď ho skládá někdo jiný (druhý domov),\n" +
        "nebo ho nevydává nikdo a konzument spadne na sdílenou síť.",
    ).toContain("SHARED_REDIS_HOST");

    expect(
      kod,
      "Derivace pořád skládá SHARED_REDIS_HOST vlastní větví — to je DRUHÝ domov\n" +
        "téže adresy vedle katalogu. Adresu vydává katalog, derivace ji jen veze.",
    ).not.toMatch(/SHARED_REDIS_HOST=\$\{[a-zA-Z]/);
  });

  test("mesh jméno nese identitu instance — jinak by adresa patřila komukoli", () => {
    // Adresa konzumenta se bere z PRIMÁRNÍ vnitřní adresy služby, kterou derivace
    // odvozuje z topologie — tedy z mesh jména nesoucího identitu instance.
    //
    // ⛔ 2026-08-23 jsem to krátce přesměroval na odchozí bránu
    // (`<prefix>-mesh-egress`), protože gateway v netns agenta není a mesh jméno
    // nepřeloží. Ta brána ale sama nenaskočila: mesh jména se nepřekládají ANI
    // uvnitř netns agenta (`NB_DNS_PROXY disabled`), takže nginx skončil na
    // `host not found in upstream`. Shodilo to core i s auth a extranetem.
    // Vráceno. Cílem trasy musí být MESH IP z discovery, ne jméno — a ty IP se
    // dnes do .env.coolify nezapisují (je tam jen CORE_MESH_IP). Než se odchozí
    // brána vrátí, tohle je ten stav, který platí.
    expect(
      kod,
      "Adresa konzumenta se neskládá z primární (mesh) adresy služby — holé jméno\n" +
        "kontejneru je nárok na sdílené síti, o který se přetahují všichni nájemníci.",
    ).toMatch(/env_aliases[\s\S]{0,200}?\$\{primary\.url\}/);
  });

  // ── Záporné testy: detektor musí vidět to, kvůli čemu vznikl ──────────────
  test("detektor chytí vydání jména z implementačního prefixu", () => {
    const vada = "lines.push(`SHARED_REDIS_HOST=${serviceAliasPrefix()}-shared-redis`);";
    expect(jmenaZImplementacnihoPrefixu(vada)).toHaveLength(1);
  });

  test("detektor nehlásí vydání prefixu samotného ani komentář", () => {
    expect(jmenaZImplementacnihoPrefixu("lines.push(`SERVICE_ALIAS_PREFIX=${serviceAliasPrefix()}`);")).toEqual([]);
    expect(
      jmenaZImplementacnihoPrefixu(kodBezKomentaru("// lines.push(`X=${serviceAliasPrefix()}-y`);")),
    ).toEqual([]);
  });
});
