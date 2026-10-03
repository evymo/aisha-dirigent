/**
 * Brána: vlna 0 nesmí záviset na tom, co teprve bootstrapuje.
 *
 * PROČ (naměřeno 2026-08-12 na živém nasazení)
 * --------------------------------------------
 * `docker-compose.coolify-netinit.yml` je WARMUP: zakládá hostitelské sítě
 * instance a skončí. Běží jako VLNA 0, tedy před vším ostatním — mimo jiné
 * před `<instance>-registry`, což je pull-through cache Docker Hubu (vlna 1).
 *
 * Jenže jeho obraz byl adresovaný PŘES tu cache:
 *
 *   image: ${REGISTRY_PROXY:-}library/docker:27-cli
 *
 * Dokud registry běželo, vada byla neviditelná — cache odpověděla. Jakmile
 * registry spadlo, kruh se zavřel:
 *
 *   netinit Error: failed to resolve reference
 *     "cache.<host>/library/docker:27-cli" — unexpected status from HEAD request
 *
 * ⇒ warmup neprošel ⇒ síť `<instance>-shared-net` nevznikla ⇒ registry se
 * nemělo kam nasadit (31 compose souborů ji chce jako `external`) ⇒ vlna 1 je
 * tvrdá brána, takže s ním padlo dalších 29 aplikací. Z kruhu ven vede jen
 * ruční zásah na hostiteli — přesně to, čemu se cold-start vyhýbá.
 *
 * ⭐ TŘÍDA CHYBY: bootstrap krok, který konzumuje službu, již sám umožňuje.
 * Za normálního provozu se NEPROJEVÍ — projeví se až při zotavení z výpadku,
 * tedy v nejhorší možnou chvíli. „Běží to" tuhle vadu nedokáže odhalit.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne komentář a ne přítomnost řetězce. Bere se KAŽDÝ `image:` ve warmup
 * compose a tvrdí se, že žádný neprochází proxy proměnnou. Když někdo
 * `${REGISTRY_PROXY}` vrátí zpět, tvrzení padne.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WARMUP = join(ROOT, "docker-compose.coolify-netinit.yml");

/** Všechny `image:` hodnoty z compose (bez zakomentovaných řádků). */
function obrazy(text: string): string[] {
  return text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .map((r) => /^\s*image:\s*(.+?)\s*$/.exec(r)?.[1])
    .filter((v): v is string => Boolean(v));
}

describe("warmup nezávisí na cache, kterou bootstrapuje (brána)", () => {
  test("měřidlo má co měřit — warmup compose existuje a deklaruje obraz", () => {
    // Bez tohohle by tvrzení níž prošlo i nad smazaným souborem: prázdný
    // seznam „neobsahuje proxy" ze špatného důvodu.
    expect(
      existsSync(WARMUP),
      "docker-compose.coolify-netinit.yml zmizel — brána ztratila předmět měření. " +
        "Opravit ji, NEODSTRAŇOVAT: warmup je jediná cesta, jak vznikne sdílená síť.",
    ).toBe(true);
    expect(obrazy(readFileSync(WARMUP, "utf8")).length, "warmup nedeklaruje žádný image:").toBeGreaterThan(0);
  });

  test("⭐ žádný obraz vlny 0 nejde přes registry proxy", () => {
    const seznam = obrazy(readFileSync(WARMUP, "utf8"));
    for (const obraz of seznam) {
      expect(
        /REGISTRY_PROXY/.test(obraz),
        `warmup tahá obraz přes registry proxy:\n    ${obraz}\n\n` +
          "Cache obsluhuje `<instance>-registry` z VLNY 1; tenhle warmup je VLNA 0 a\n" +
          "teprve zakládá síť, na které registry běží. Dokud registry běží, vada je\n" +
          "neviditelná — zavře se až při zotavení z výpadku, kdy cache neodpovídá,\n" +
          "a z kruhu pak není cesta ven bez ručního zásahu na hostiteli.",
      ).toBe(false);
    }
  });

  test("obraz zůstává plně kvalifikovaný (`library/…`)", () => {
    // Druhá půlka téhož řádku a starší nález (2026-08-11): bez `library/`
    // vrací registry „not found". Oprava proxy ho nesmí shodit.
    const seznam = obrazy(readFileSync(WARMUP, "utf8"));
    for (const obraz of seznam) {
      if (obraz.includes("/")) continue;
      expect.fail(
        `obraz \`${obraz}\` není plně kvalifikovaný. Oficiální obrazy se adresují ` +
          "jako `library/<jméno>` — jinak registry odpoví not-found a deploy padne " +
          "dřív, než se cokoli spustí (naměřeno 2026-08-11).",
      );
    }
  });
});
