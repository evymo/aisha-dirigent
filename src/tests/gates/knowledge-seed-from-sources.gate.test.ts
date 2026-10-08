/**
 * Brána — seed znalostí ze zkušenosti je GENEROVANÝ ze zdrojů a čerstvý.
 *
 * Zdroj pravdy jsou soubory aisha/knowledge/<slug>.md; seed
 * aisha/db/seed/core/41_aisha_knowledge_from_experience.sql z nich vyrábí
 * scripts/db/gen-knowledge-seed.mjs. Ruční úprava seedu (oprava, která by se při
 * příští regeneraci tiše ztratila) i zdroj bez regenerace tu zčervenají.
 *
 * Měří zároveň tři vlastnosti, které generátor sám slibuje:
 *   · TŘÍDNÍ: výčet item_type, se kterým generátor počítá, = výčet
 *     knowledge_item_type v SoT i v baseline (nová hodnota výčtu bez rozhodnutí
 *     v generátoru neprojde, zrušená taky ne);
 *   · JMÉNA: obecná položka nenese jméno instance — tytéž vrstvy jako
 *     no-instance-data-in-public (strukturální e-maily mimo bezpečné domény,
 *     operátorský seznam z config/tenant.json / AISHA_TENANT_SENTINELS, vlastní
 *     instance z instances/). Seznam jmen v repu NENÍ ani pro tuhle kontrolu;
 *   · JEDINEČNOST: slug zařazené položky nenese žádný jiný soubor seedu (jinak by
 *     seed narazil na unikátní index (source_slug, locale) až na živé DB).
 * Každá kontrola má kotvu nebo mutant, který dokazuje, že by uměla zčervenat.
 *
 * Přegenerovat: npm run db:seed:knowledge (pak npm run regen — kompilovaný seed).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ITEM_TYPES,
  PLATFORM_OUTPUT_FILE,
  PLATFORM_SOURCE_DIR,
  VYHRAZENE_ZDROJE,
  buildSeedSql,
} from "../../../scripts/db/gen-knowledge-seed.mjs";
import { allTenantNames, ownTenantIds } from "../../../scripts/lib/tenant-sentinels.mjs";
import { findLeakedIdentities, loadTenantSentinels, privateSentinelHits } from "./lib/tenant-leak-detect";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const JMENA: string[] = allTenantNames(ROOT);
type Polozka = { slug: string; title: string; status: string };
type Vysledek = { sql: string; zarazene: Polozka[]; vynechane: Polozka[] };
// Vadný zdroj (chybějící pole, jméno instance, neznámý item_type) generátor odmítne
// výjimkou — ta se tu zachytí a vypíše v prvním testu místo pádu celého souboru.
let vysledek: Vysledek = { sql: "", zarazene: [], vynechane: [] };
let chybaGeneratoru = "";
try {
  vysledek = buildSeedSql({ jmena: JMENA }) as Vysledek;
} catch (e) {
  chybaGeneratoru = e instanceof Error ? e.message : String(e);
}
const ulozeny = readFileSync(PLATFORM_OUTPUT_FILE, "utf8");

/** Hodnoty výčtu knowledge_item_type z textu SQL: `CREATE TYPE … AS ENUM (…)` i každé
 *  `ALTER TYPE … ADD VALUE '…'` (tak se do výčtu přidává na existující DB). */
function vycet(sql: string): string[] {
  const m = sql.match(/CREATE TYPE (?:public\.)?knowledge_item_type AS ENUM \(([^)]*)\)/);
  // Hodnota je cokoli mezi apostrofy — užší třída znaků by hodnotu s číslicí nebo velkým
  // písmenem tiše přehlédla a brána by ji neviděla.
  const zaklad = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  const pridane = [
    ...sql.matchAll(/ALTER TYPE (?:public\.)?knowledge_item_type\s+ADD VALUE\s+(?:IF NOT EXISTS\s+)?'([^']+)'/gi),
  ].map((x) => x[1]);
  return [...new Set([...zaklad, ...pridane])].sort();
}

/** Všechny soubory SQL pod adresářem (SoT), rekurzivně. */
function sqlSoubory(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? sqlSoubory(p) : p.endsWith(".sql") ? [p] : [];
  });
}

describe("knowledge seed — generovaný ze zdrojů a čerstvý", () => {
  it("uložený seed se bajtově rovná výstupu generátoru (jinak: npm run db:seed:knowledge)", () => {
    expect(chybaGeneratoru, "generátor zdroje odmítl").toBe("");
    expect(ulozeny).toBe(vysledek.sql);
  });

  it("mutant: ruční úprava seedu se pozná (titulek, smazaný blok, přehozené pořadí)", () => {
    const [prvni, druha] = vysledek.zarazene;
    expect(prvni && druha, "kotva: seed má aspoň dvě zařazené položky").toBeTruthy();
    const upraveny = ulozeny.replace(prvni.title.replace(/'/g, "''"), "Ručně opravený titulek");
    expect(upraveny).not.toBe(vysledek.sql);
    const bloky = ulozeny.split(/\n(?=-- [a-z0-9-]+ {2}\(zdroj: )/);
    expect(bloky.length, "kotva: seed jde rozdělit na bloky položek").toBeGreaterThan(2);
    expect(bloky.filter((_, i) => i !== 1).join("\n")).not.toBe(vysledek.sql);
    expect([bloky[0], bloky[2], bloky[1], ...bloky.slice(3)].join("\n")).not.toBe(vysledek.sql);
  });

  it("každý zdroj je v seedu zařazený, nebo vyjmenovaný jako nezařazený — žádný tiše nechybí", () => {
    const zdroje = readdirSync(PLATFORM_SOURCE_DIR)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => f.slice(0, -3))
      .sort();
    const zarazene = vysledek.zarazene.map((p) => p.slug);
    const vynechane = vysledek.vynechane.map((p) => p.slug);
    expect([...zarazene, ...vynechane].sort()).toEqual(zdroje);
    for (const p of vysledek.vynechane) {
      expect(ulozeny).toContain(`--   ${p.slug} (${p.status})`);
      expect(ulozeny).not.toContain(`'${p.slug}'`);
    }
  });

  it("zápis je upsert s verzí a strážemi, ne DO NOTHING", () => {
    const inserty = (ulozeny.match(/INSERT INTO public\.knowledge_items \(/g) ?? []).length;
    expect(inserty).toBe(vysledek.zarazene.length);
    expect((ulozeny.match(/ON CONFLICT \(id\) DO UPDATE SET/g) ?? []).length).toBe(inserty);
    expect((ulozeny.match(/version = public\.knowledge_items\.version \+ 1/g) ?? []).length).toBe(inserty);
    expect((ulozeny.match(/IS DISTINCT FROM/g) ?? []).length).toBe(inserty);
    expect(ulozeny).not.toMatch(/DO NOTHING/);
    expect(ulozeny).toMatch(/DO \$straz\$[\s\S]*RAISE EXCEPTION/);
    expect(ulozeny, "karanténu rozhoduje sken, seed ji nepřepisuje").not.toMatch(/quarantine_/);
  });

  it("regenerace celku zná krok znalostí a pouští ho PŘED kompilací seedu", () => {
    const regen = read("scripts/regen-artifacts.mjs");
    const znalosti = regen.indexOf('run: ["run", "db:seed:knowledge"]');
    const kompilace = regen.indexOf('run: ["run", "db:seed:compile"]');
    expect(znalosti, "krok db:seed:knowledge v regen-artifacts").toBeGreaterThan(-1);
    expect(znalosti).toBeLessThan(kompilace);
    expect(JSON.parse(read("package.json")).scripts["db:seed:knowledge"]).toBe("node scripts/db/gen-knowledge-seed.mjs");
  });
});

describe("knowledge seed — třídní brána: item_type = výčet v SoT i v baseline", () => {
  // SoT = definice výčtu + každé ADD VALUE kdekoli ve stromu SoT a v heals.sql.
  const sotText = [
    ...sqlSoubory(join(ROOT, "aisha/db/sql")).map((p) => readFileSync(p, "utf8")),
    read("aisha/db/heals.sql"),
  ].join("\n");
  const sot = vycet(sotText);
  const baseline = vycet(read("aisha/db/migrations/00000000000000_baseline.sql"));

  it("kotva: výčet jde z obou zdrojů přečíst", () => {
    expect(sot.length).toBeGreaterThanOrEqual(7);
    expect(sot).toContain("engineering_doc");
  });

  it("generátor zná právě hodnoty výčtu — nic navíc, nic chybějící", () => {
    expect(Object.keys(ITEM_TYPES).sort()).toEqual(sot);
    expect(baseline).toEqual(sot);
  });

  it("mutant: výčet s novou hodnotou by se s generátorem rozešel (v definici i přes ALTER TYPE … ADD VALUE)", () => {
    const sNovou = vycet(
      read("aisha/db/sql/enums/knowledge_item_type.sql").replace("'core_value'", "'core_value',\n  'lesson_learned'"),
    );
    expect(sNovou).not.toEqual(Object.keys(ITEM_TYPES).sort());
    const pridanim = vycet(`${sotText}\nALTER TYPE public.knowledge_item_type ADD VALUE IF NOT EXISTS 'lesson_learned';`);
    expect(pridanim).toContain("lesson_learned");
    expect(vycet(`${sotText}\nALTER TYPE knowledge_item_type ADD VALUE 'Lesson2';`), "hodnota s číslicí a velkým písmenem").toContain("Lesson2");
    expect(pridanim).not.toEqual(Object.keys(ITEM_TYPES).sort());
  });
});

describe("knowledge seed — vyhrazený prostor: kolize slugu je nemožná konstrukcí", () => {
  const VYHRAZENE = (Object.values(VYHRAZENE_ZDROJE) as string[]).sort();
  /** Výčty (IN (…) / ARRAY[…]) v textu, které nesou některý vyhrazený typ. */
  const vycty = (sql: string): string[][] =>
    [...sql.matchAll(/(?:\bIN \(|ARRAY\[)([^)\]]*)/g)]
      .map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
      .filter((v) => v.some((x) => VYHRAZENE.includes(x)))
      .map((v) => [...new Set(v)].sort());
  const MISTA = [
    "aisha/db/sql/functions/fn_protect_reserved_knowledge.sql",
    "aisha/db/sql/indexes/idx_knowledge_items_reserved_slug_unique.sql",
    "aisha/db/sql/indexes/idx_knowledge_items_source_slug_locale_unique.sql",
    "aisha/db/sql/functions/upsert_story_knowledge_item_audited.sql",
    "aisha/db/sql/functions/import_story_bundle.sql",
    "aisha/db/heals.sql",
  ];

  for (const m of MISTA) {
    it(`${m}: každý výčet vyhrazených zdrojů = výčet generátoru (VYHRAZENE_ZDROJE)`, () => {
      const nalezene = vycty(read(m));
      expect(nalezene.length, "kotva: místo výčet nese — jinak by brána měřila prázdno").toBeGreaterThan(0);
      for (const v of nalezene) expect(v).toEqual(VYHRAZENE);
    });
  }

  it("mutant: výčet bez jednoho vyhrazeného typu se pozná", () => {
    const [v] = vycty("WHERE source_type IN ('platform_knowledge')");
    expect(v).not.toEqual(VYHRAZENE);
  });

  it("trigger stráže je zapojený v SoT i v heals, seed píše jen vyhrazený typ vrstvy platformy", () => {
    expect(read("aisha/db/sql/triggers/trg_protect_reserved_knowledge.sql")).toMatch(
      /CREATE TRIGGER trg_protect_reserved_knowledge\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.knowledge_items/,
    );
    const heals = read("aisha/db/heals.sql");
    for (const f of ["fn_protect_reserved_knowledge.sql", "trg_protect_reserved_knowledge.sql", "idx_knowledge_items_reserved_slug_unique.sql"]) {
      expect(heals, `\\ir ${f} v heals.sql`).toMatch(new RegExp(`\\\\ir sql/[a-z]+/${f.replace(/\./g, "\\.")}`));
    }
    const inserty = (ulozeny.match(/INSERT INTO public\.knowledge_items \(/g) ?? []).length;
    expect((ulozeny.match(new RegExp(`^ {2}'${VYHRAZENE_ZDROJE.platforma}',$`, "gm")) ?? []).length).toBe(inserty);
    expect(ulozeny).not.toMatch(/^ {2}'manual',$/m);
  });
});

describe("knowledge seed — obecná položka nenese jméno instance", () => {
  const zdroje = readdirSync(PLATFORM_SOURCE_DIR).filter((f) => f.endsWith(".md"));
  // Operátorský seznam (config/tenant.json / AISHA_TENANT_SENTINELS; CI z tajemství Actions)
  // + vlastní instance z instances/. Ve veřejném stromu bez tajemství je PRÁZDNÝ — pak tahle
  // vrstva NEMĚŘÍ a musí to být vidět (přeskočeno s důvodem), nikdy tichá zelená.
  const seznam = [...new Set([...loadTenantSentinels(), ...(ownTenantIds(ROOT) as string[])])];

  it("kotva: detekce umí zčervenat (strukturální e-mail, operátorský seznam)", () => {
    expect(findLeakedIdentities("contact ops@tenant-corp.example-real.cz")).not.toEqual([]);
    expect(privateSentinelHits("seen on the Acme-Corp node", ["acme-corp"])).toEqual(["acme-corp"]);
  });

  for (const f of zdroje) {
    it(`${f}: žádný e-mail mimo bezpečné domény (strukturální vrstva, bez seznamu)`, () => {
      expect(findLeakedIdentities(readFileSync(join(PLATFORM_SOURCE_DIR, f), "utf8"))).toEqual([]);
    });
  }

  it("seznam jmen instancí je k dispozici — prázdný = NEZMĚŘENO, ne zelená", (ctx) => {
    if (!seznam.length) {
      console.warn(
        "[knowledge-seed] seznam jmen instancí je prázdný (config/tenant.json, AISHA_TENANT_SENTINELS, instances/) — " +
          "kontrola jmen v obecných položkách NEZMĚŘENA",
      );
      ctx.skip();
      return;
    }
    expect(seznam.length).toBeGreaterThan(0);
  });

  for (const f of zdroje) {
    it.skipIf(!seznam.length)(`${f}: žádné jméno ze seznamu instancí`, () => {
      // Jména se do hlášky NEVYPISUJÍ (výpis veřejné CI by je prozradil) — jen počet.
      expect(privateSentinelHits(readFileSync(join(PLATFORM_SOURCE_DIR, f), "utf8"), seznam).length).toBe(0);
    });
  }
});

describe("knowledge seed — slug zařazené položky nenese jiný soubor seedu", () => {
  const SEED = join(ROOT, "aisha/db/seed");
  const soubory: string[] = [];
  const projdi = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) projdi(p);
      else if (p.endsWith(".sql") && p !== PLATFORM_OUTPUT_FILE) soubory.push(p);
    }
  };
  projdi(SEED);

  it("kotva: prohledává se celý seed (core i další vrstvy)", () => {
    expect(soubory.some((p) => p.endsWith("35_aisha_platform_self_knowledge.sql"))).toBe(true);
    expect(soubory.length).toBeGreaterThan(40);
  });

  it("žádná kolize slugu", () => {
    const kolize: string[] = [];
    for (const p of soubory) {
      const text = readFileSync(p, "utf8");
      for (const { slug } of vysledek.zarazene) {
        if (text.includes(`'${slug}'`)) kolize.push(`${slug} v ${relative(ROOT, p)}`);
      }
    }
    expect(kolize).toEqual([]);
  });
});
