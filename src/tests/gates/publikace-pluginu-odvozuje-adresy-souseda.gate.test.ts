import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Publikace pluginů mluví na SOUSEDA, ne na svět.
 *
 * ⛔ NAMĚŘENO 2026-09-06 v RIQ produkci: `plugin-publish-init` končil kódem 1 při
 * KAŽDÉM nasazení — „3 zabaleno · 0 publikováno (`fetch failed`)" — a
 * `plugin_catalog` i `plugin_versions` měly NULA řádků. Vada byla v JEDINÉ
 * hodnotě: `AISHA_POSTGREST_URL` se brala z nasazovacího prostředí, kde veze
 * `https://<prefix>-api.mesh.<tld>`. To je adresa pro stanoviště ZVENČÍ a
 * z tohohle kontejneru je vadná třikrát najednou:
 *   1. jméno se nepřeloží — core stack síť `mesh-dns` nedeklaruje,
 *   2. mesh ingress servíruje `-api` na :3001 a `-postgrest` na :3000, ne na 443,
 *   3. `-api` míří na gateway, ne na PostgREST.
 *
 * ⭐ PROČ TO NEHLÍDÁ STARŠÍ BRÁNA. `plugin-ma-drahu-do-katalogu` ověřuje, že
 * `plugins:publish` MÁ VOLAJÍCÍHO a že volající sedí v compose. To je pravda
 * o REPU. Že volajícímu dojde adresa, na kterou odsud nevede cesta, je pravda
 * o SVĚTĚ — a mezi ně se vešel prázdný katalog, o kterém nikdo nevěděl, protože
 * init kontejner smí selhat, aniž by shodil stack.
 *
 * ⭐ MĚŘÍ SE VLASTNOST: adresa souseda na téže síti se ODVOZUJE z identity
 * instance. Netvrdí se, jak se proměnná jmenuje ani jaký má port — tvrdí se, že
 * v ní není nasazovací dosazení `${...}` pro cizí stanoviště. `S3_ENDPOINT` o
 * řádek výš je týž idiom a slouží jako doklad, že to není nový vynález.
 *
 * Doloženo koncem řetězu (RIQ, 2026-09-06): s odvozenou adresou vydal týž obraz
 * `3 publikováno · 0 chyb` a katalog má 3 řádky `submitted/internal`.
 */
const ROOT = join(__dirname, "../../..");
const COMPOSE = join(ROOT, "docker-compose.coolify.yml");

/** Blok `environment:` služby `plugin-publish-init` — bez komentářů. */
function prostrediPublikace(): string {
  const src = readFileSync(COMPOSE, "utf8");
  const zacatek = src.indexOf("\n  plugin-publish-init:");
  expect(zacatek, "služba `plugin-publish-init` v compose není").toBeGreaterThan(-1);
  // Konec = další služba na téže úrovni odsazení.
  const zbytek = src.slice(zacatek + 1);
  const dalsi = zbytek.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/);
  const blok = dalsi === -1 ? zbytek : zbytek.slice(0, dalsi);
  // ⛔ Komentáře pryč PŘED hledáním hodnot — jinak by je vysvětlující text
  // v komentáři (tenhle případ: cituje se v něm vadná mesh adresa) přebil.
  return blok.replace(/^\s*#.*$/gm, "");
}

/** `KLÍČ: hodnota` z bloku environment. */
function adresy(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const r of prostrediPublikace().split("\n")) {
    const m = r.match(/^\s{6}([A-Z0-9_]+):\s*(.+?)\s*$/);
    if (m && /_URL$|_ENDPOINT$/.test(m[1])) out.push([m[1], m[2]]);
  }
  return out;
}

describe("publikace pluginů odvozuje adresy souseda", () => {
  it("měřidlo má co měřit — služba nese aspoň dvě adresy", () => {
    // Kdyby se blok přestal nacházet, prázdný seznam by vypadal jako zelená.
    expect(
      adresy().map(([k]) => k),
      "v `plugin-publish-init` nejsou žádné adresy — brána by měřila prázdno",
    ).toHaveLength(2);
  });

  it("žádná adresa souseda se nebere z nasazovacího prostředí", () => {
    const zvenci = adresy().filter(([, v]) => /\$\{(?!APP_NAME_PREFIX)/.test(v));
    expect(
      zvenci.map(([k, v]) => `${k}: ${v}`),
      "Tahle adresa přichází z nasazovacího prostředí, tedy ze stanoviště ZVENČÍ.\n" +
        "`plugin-publish-init` sedí vedle PostgREST i MinIO na sdílené síti instance —\n" +
        "odsud platí odvozené jméno `${APP_NAME_PREFIX}-<služba>:<port>`, jako u\n" +
        "`S3_ENDPOINT`. Publikace jinak skončí `fetch failed` a katalog zůstane prázdný,\n" +
        "aniž by to cokoli shodilo.",
    ).toEqual([]);
  });

  it("adresy nesou identitu instance — na sdíleném hostiteli jich běží víc", () => {
    const bezIdentity = adresy().filter(([, v]) => !v.includes("APP_NAME_PREFIX"));
    expect(
      bezIdentity.map(([k, v]) => `${k}: ${v}`),
      "Adresa bez `${APP_NAME_PREFIX}` míří na souseda CIZÍ instance — na sdíleném\n" +
        "hostiteli běží víc stacků a `postgrest` bez prefixu není jednoznačné jméno.",
    ).toEqual([]);
  });
});
