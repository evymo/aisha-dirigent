/**
 * Story se RESOLVUJE z identity, nezadává se do konfigurace (CLASS gate)
 *
 * TŘÍDA VADY: identita obsahu vypsaná do konfigurace jako syrové UUID. Takový
 * odkaz nepřežije přestavbu cílové databáze — a co hůř, TVÁŘÍ SE NASTAVENĚ.
 *
 * ⛔ NAMĚŘENO 2026-08-30: `impl.json` neslo `story_id: "9e7e4dc5-…"`, engine ho
 * razítkoval do KAŽDÉHO emitovaného řádku (kb, registry, cases) a v cílové DB
 * měla ta story NULA řádků. Balíček s 3 822 doklady se o ni zastavil a byl by
 * v pořadí 16. zaseknutý. Šablona enginu měla dokonce `story_id: ""` — prázdná
 * hodnota, tedy táž třída jako `VPN_IDLE_MS=""`: neplatný vstup, který vypadá
 * jako nastavený.
 *
 * ⭐ Proč zrovna takhle: twins tutéž přestavbu PŘEŽÍVAJÍ, protože jsou klíčované
 * identitou `(source, source_key)`, ne syrovým UUID. Tohle je táž oprava o
 * vrstvu výš — kontext dosazuje driver z identity zdroje při replayi, kdy jako
 * jediný ví, jaká story ve světě skutečně je.
 *
 * INVARIANTY:
 *   1. Konfigurace ingestu NESMÍ nést `story_id`. Ani prázdné — prázdná hodnota
 *      přebije default a tváří se jako nastavená.
 *   2. Driver kontext RESOLVUJE (`ensure_source_story`), nebere ho z balíčku.
 *   3. Resolution je FAIL-CLOSED: neznámý nebo neaktivní zdroj je STOP, ne
 *      založení story. Nejistota se neobchází výchozí hodnotou.
 *   4. Story vzniká NEVIDITELNÁ (`inbox`). O tom, že vznikla, rozhoduje
 *      automatika ingestu; o tom, že ji člověk uvidí, rozhoduje člověk.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const RPC = join(ROOT, "aisha", "db", "sql", "functions", "ensure_source_story.sql");
const DRIVER = join(ROOT, "services", "svc-source-broker", "src", "clients", "li-driver.ts");

const cti = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

describe("story se resolvuje z identity, nezadává se", () => {
  const rpc = cti(RPC);
  const driver = cti(DRIVER);

  test("RPC `ensure_source_story` je v SoT", () => {
    expect(rpc, `${RPC} chybí — kořen kontextu by neměl kde vzniknout.`).not.toBeNull();
    expect(rpc).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_source_story/);
  });

  // ⛔ POZOR na to, co tu SCHVÁLNĚ NENÍ: kontrola, že `impl.json` nenese
  // `story_id`. Konfigurace ingestu v tomhle repu NEŽIJE (je v instančním
  // datovém repu a v enginu), takže by se test bez overlaye jen tiše přeskočil
  // — a přesně to se stalo při mutačním ověření 2026-08-30: vadu jsem vrátil
  // zpět a brána zůstala ZELENÁ. Měřidlo, jehož univerzum mine část světa,
  // vydá týž výstup jako měřidlo, které nic nenašlo.
  //
  // Vlastnost proto drží ENGINE u zdroje: `_merge_config` konfiguraci s klíčem
  // `story_id` ODMÍTNE výjimkou (test `test_impl_bez_kontextu` tamtéž). Tady
  // se měří jen to, co tu měřit LZE — strana konzumenta.

  test("2. driver kontext RESOLVUJE, nebere ho z balíčku", () => {
    expect(driver).not.toBeNull();
    expect(
      driver,
      "li-driver musí volat `ensure_source_story` — kontext zná jen živý svět.",
    ).toMatch(/ensure_source_story/);
    expect(
      /item\.p_story_id/.test(driver ?? ""),
      "li-driver čte `p_story_id` z řádku balíčku. Právě tak se do platformy\n" +
        "dostalo UUID z konfigurace, které v cílové DB nic neadresovalo.",
    ).toBe(false);
  });

  test("3. resolution je fail-closed — neznámý zdroj je STOP, ne nová story", () => {
    expect(
      rpc,
      "Chybí odmítnutí neregistrovaného zdroje. Zdroj musí nejdřív projít\n" +
        "onboardingem (klasifikace, consent), teprve pak smí vlastnit obsah.",
    ).toMatch(/unknown or inactive source/);
    expect(rpc).toMatch(/WHERE source_slug = p_source_slug AND is_active/);
  });

  test("4. story vzniká neviditelná (`inbox`) s původem `ingest`", () => {
    expect(
      rpc,
      "Story ingestu musí vznikat ve stavu `inbox`. Automatika rozhoduje, ŽE\n" +
        "story vznikla; že ji uživatel uvidí, rozhoduje člověk.",
    ).toMatch(/'inbox'/);
    expect(rpc).toMatch(/'ingest'/);
    expect(
      /'active'/.test(rpc ?? ""),
      "Story ingestu nesmí vznikat rovnou jako `active` — to by uživateli vysypalo\n" +
        "do přehledu každý nově napojený zdroj.",
    ).toBe(false);
  });

  test("5. neznámý zdroj nechá NEAKTIVNÍ návrh — odmítnutí bez stopy je slepé", () => {
    // Zdroj najde ingest, aktivuje ho člověk. Dřív odmítnutí nenechalo stopu,
    // takže „nic tu není" se nedalo odlišit od „nikdo se nehlásil".
    expect(rpc, "chybí založení návrhu neznámého zdroje").toMatch(/proposed_by', 'ingest'/);
    // ⛔ Kotva musí být TĚSNÁ. První verze zněla `VALUES (p_source_slug,[\s\S]*?false,`
    // a mutace ji neshodila: `[\s\S]*?` si `false` našlo o kus dál v souboru,
    // takže brána byla zelená i pro AKTIVNÍ návrh. Vážeme se proto na řádek
    // bezprostředně za odvozeným jmenným prostorem.
    expect(
      rpc,
      "Návrh MUSÍ vznikat neaktivní — jinak by si ingest sám uděloval oprávnění.",
    ).toMatch(/'ingest\/' \|\| p_source_slug,\s*\n\s*false,/);
  });

  test("6. návrh NEHÁDÁ klasifikaci — jsou to fakta o vztahu, ne o datech", () => {
    const usek = (rpc ?? "").slice((rpc ?? "").indexOf("INSERT INTO public.agent_knowledge_sources"));
    const blok = usek.slice(0, usek.indexOf("ON CONFLICT"));
    // ⭐ Hledá se KLÍČ, ne zmínka. Poznámka v návrhu ty dimenze jmenuje
    // (aby operátor věděl, co doplnit) — a první verze téhle brány na to
    // spadla, protože měřila holý výskyt slova. Klíč v `jsonb_build_object`
    // je vždy v apostrofech; text uvnitř poznámky ne.
    // Klíče závory agent_knowledge_sources_activation_guard (kontrakt §1 + §3).
    for (const klic of ["source_type", "data_sensitivity", "retention_class", "legal_basis", "owner"]) {
      expect(
        blok.includes(`'${klic}'`),
        `Návrh dosazuje klíč '${klic}'. Klasifikace se nedoplňuje ani prázdná —\n` +
          "legal_basis a retention_class jsou fakta o právním vztahu, ne o bajtech.",
      ).toBe(false);
    }
    expect(blok, "návrh musí nést svůj původ").toContain("'proposed_by'");
  });

  test("7. záměrně vypnutý zdroj se návrhem NEPŘEPÍŠE", () => {
    expect(
      rpc,
      "Existující (byť neaktivní) zdroj mohl být vypnutý záměrně. Přepsat cizí\n" +
        "rozhodnutí návrhem je horší než mlčet — musí být větev, která ho nechá být.",
    ).toMatch(/IF EXISTS \(SELECT 1 FROM public\.agent_knowledge_sources WHERE source_slug/);
  });

  test("idempotence: druhý běh nezaloží druhou story", () => {
    expect(
      rpc,
      "Chybí větev `created:false` — bez ní by každý replay založil další story.",
    ).toMatch(/story_id IS NOT NULL[\s\S]*'created', false/);
  });
});
