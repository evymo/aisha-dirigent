/**
 * VYSTAVIT SE DÁ JEN VÝSLOVNĚ — A S DŮVODEM.
 *
 * ⛔ NAMĚŘENO 2026-08-22. Katalog měl `public: true` u JEDENÁCTI služeb z 31,
 * zatímco profil `riq` z nich čtyři (openclaw, local-ingest, realtime, potok)
 * musel VÝSLOVNĚ ZAVŘÍT. Bezpečnost tedy stála na tom, že si profil vzpomene —
 * kdo přidá službu a na profil zapomene, vystaví ji MLČKY.
 *
 * Výchozí stav je od teď zavřený a otevření je úkon, který někdo NAPÍŠE:
 * `external_connectivity` říká, v kterém směru se služba dotýká vnějšku.
 * Majitel 2026-08-22: „je to prostě maximálně privátní secure záležitost"
 * a „dveřník má i jednodušší práci" — čím míň cest, tím míň se dá pokazit.
 *
 * ⭐ Tvrzení NEROZHODUJE, co veřejné být má. Jen zakazuje, aby to někdo měl
 * bez uvedení důvodu — o tom, co je legitimní, rozhoduje člověk, ne brána.
 *
 * Tahle brána hlídá KATALOG. Přepis instance (`service_overrides.<id>.public`
 * v profilu) nese důvod v `_comment_public` — pravidlo stojí ve
 * `config/profiles.schema.json` a nad profilem overlaye ho uplatňuje
 * `profil-instance-plni-schema`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
const sluzby: Record<string, { public?: boolean; external_connectivity?: string }> =
  katalog.services ?? katalog;

describe("vystavení musí mít důvod (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(Object.keys(sluzby).length, "katalog nevydal ANI JEDNU službu").toBeGreaterThan(0);
  });

  test("co je veřejné, deklaruje SMĚR, kterým se vnějšku dotýká", () => {
    const bezDuvodu = Object.entries(sluzby)
      .filter(([, v]) => v.public === true && !v.external_connectivity)
      .map(([k]) => k);
    expect(
      bezDuvodu,
      "tyhle služby smějí být veřejné, ale nikdo nenapsal PROČ:\n  " +
        bezDuvodu.join(", ") +
        "\n\nDoplň `external_connectivity` (egress = volá ven, ingress = přijímá zvenčí),\n" +
        "nebo — pokud se vnějšku nedotýkají — nastav `public: false` a nech je\n" +
        "dosažitelné jen meshem. Vystavení zapomenutím není vystavení rozhodnutím.",
    ).toEqual([]);
  });

  test("směr se deklaruje jen tam, kde je co vystavit", () => {
    const zbytecne = Object.entries(sluzby)
      .filter(([, v]) => v.external_connectivity && v.public !== true)
      .map(([k]) => k);
    expect(
      zbytecne,
      "služba deklaruje dotyk s vnějškem, ale veřejná není — mrtvá deklarace,\n" +
        "která svádí k tomu ji 'zprovoznit':\n  " + zbytecne.join(", "),
    ).toEqual([]);
  });
});
