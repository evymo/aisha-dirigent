import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kdo čte SCHÉMA, čeká na migraci — ne na zdravou databázi.
 *
 * ⛔ NAMĚŘENO 2026-09-07 v RIQ produkci. Nasazení přineslo opravenou funkci
 * `submit_plugin` (zapisuje všech šest spec sloupců) a přesto zůstal
 * `plugin_catalog.source_spec` NULL. Funkce v databázi PŘITOM UŽ NOVÁ BYLA.
 *
 * Rozhodlo pořadí. `plugin-publish-init` měl `depends_on` jen na `db:
 * service_healthy`, takže startoval souběžně s `migrate`:
 *     migrate               … 03:54:37,88
 *     plugin-publish-init   … 03:54:38,15
 * Publikace tedy proběhla proti STARÉ funkci. Doloženo koncem řetězu: týž obraz
 * spuštěný o pár minut později — kdy už heals doběhly — `source_spec` zapsal.
 *
 * ⭐ PROČ JE TO TŘÍDA, NE JEDEN PŘÍPAD. „Databáze odpovídá" a „schéma je hotové"
 * jsou DVA různé stavy. Kdokoli v nasazení čte nebo zapisuje přes schéma, které
 * staví `migrate`, musí čekat na jeho DOKONČENÍ. Jinak každá změna schématu mine
 * spotřebitele z téhož nasazení — a mine ho TIŠE, protože init smí selhat, aniž
 * shodí stack, a appka zůstane `running:healthy`.
 *
 * ⭐ MĚŘÍ SE VLASTNOST, NE PRAVOPIS: netvrdí se pořadí klíčů ani formátování,
 * tvrdí se, že mezi závislostmi je `migrate` s podmínkou dokončení.
 */
const ROOT = join(__dirname, "../../..");
const COMPOSE = join(ROOT, "docker-compose.coolify.yml");

/** Blok jedné služby z compose, bez komentářů. */
function sluzba(jmeno: string): string {
  const src = readFileSync(COMPOSE, "utf8");
  const zacatek = src.indexOf(`\n  ${jmeno}:`);
  expect(zacatek, `služba \`${jmeno}\` v compose není`).toBeGreaterThan(-1);
  const zbytek = src.slice(zacatek + 1);
  const dalsi = zbytek.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/);
  return (dalsi === -1 ? zbytek : zbytek.slice(0, dalsi)).replace(/^\s*#.*$/gm, "");
}

describe("publikace pluginů čeká na dokončenou migraci", () => {
  it("měřidlo má co měřit — obě služby v compose existují", () => {
    expect(sluzba("plugin-publish-init").length).toBeGreaterThan(50);
    expect(sluzba("migrate").length).toBeGreaterThan(50);
  });

  it("`migrate` je mezi závislostmi publikace", () => {
    expect(
      sluzba("plugin-publish-init"),
      "`plugin-publish-init` nečeká na `migrate`. Publikace pak běží souběžně s\n" +
        "migrací a čte STARÉ schéma — naměřeno 2026-09-07: `source_spec` zůstal NULL,\n" +
        "ačkoli opravená funkce už v databázi byla.",
    ).toMatch(/\bmigrate:/);
  });

  it("čeká se na DOKONČENÍ, ne na nastartování", () => {
    const blok = sluzba("plugin-publish-init");
    const usek = blok.slice(blok.indexOf("migrate:"));
    expect(
      usek,
      "u `migrate` chybí `condition: service_completed_successfully`. `service_started`\n" +
        "ani zdědění `service_healthy` nestačí — migrace musí DOBĚHNOUT, jinak je to\n" +
        "týž závod, jen o vteřinu posunutý.",
    ).toMatch(/condition:\s*service_completed_successfully/);
  });

  it("`migrate` je init, který skončí — jinak by se na dokončení čekalo věčně", () => {
    // `service_completed_successfully` má smysl jen u kontejneru, který exituje.
    expect(
      sluzba("migrate"),
      "`migrate` nemá `restart: \"no\"` — na dokončení restartované služby se čekat nedá",
    ).toMatch(/restart:\s*"no"/);
  });
});
