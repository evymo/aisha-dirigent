/**
 * gen-knowledge-seed — jednotkové testy generátoru znalostí ze zkušenosti.
 *
 * Každá odmítací kontrola má KOTVU: tatáž položka bez vady projde. Bez ní by test
 * „vadná položka spadla" prošel i nad generátorem, který odmítá všechno.
 * Jména instancí v testech jsou smyšlená (acme-…); skutečná do repa nepatří ani
 * jako seznam pro kontrolu.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ITEM_TYPES,
  STAVY,
  VIDITELNOSTI_CEKAJICI,
  VRSTVY,
  VYHRAZENE_ZDROJE,
  Vada,
  buildSeedSql,
  idPolozky,
  main,
  parseItem,
  validateItem,
} from "./gen-knowledge-seed.mjs";

/** Platná položka; `prepis` mění pole hlavičky (null = pole vynechat). */
function polozka(slug = "sample-lesson", prepis = {}) {
  const pole = {
    slug,
    title: '"A sample lesson"',
    summary: '"What the lesson says in one sentence."',
    category: "engineering_practice",
    item_type: "playbook",
    tags: "[sample, test]",
    verified: "read",
    evidence: ["procedure: re-run the sample and compare"],
    valid_for: '"general"',
    scope: "general",
    status: "adopted",
    author: "platform-maintainers",
    ai_instructions: '"Use when a sample is needed."',
    ...prepis,
  };
  const radky = ["---"];
  for (const [k, v] of Object.entries(pole)) {
    if (v === null) continue;
    if (Array.isArray(v)) {
      radky.push(`${k}:`);
      for (const e of v) radky.push(`  - ${e}`);
    } else radky.push(`${k}: ${v}`);
  }
  radky.push("---", "# A sample lesson", "", "## Rules", "1. **Do the sample thing.** [read] Because it was needed once.", "");
  return radky.join("\n");
}

function adresar(soubory) {
  const d = mkdtempSync(path.join(tmpdir(), "znalosti-"));
  const zdroj = path.join(d, "zdroj");
  mkdirSync(zdroj);
  for (const [jmeno, text] of Object.entries(soubory)) writeFileSync(path.join(zdroj, jmeno), text);
  return { zdroj, cil: path.join(d, "41_out.sql") };
}

const sestav = (soubory, volby = {}) => {
  const { zdroj, cil } = adresar(soubory);
  return buildSeedSql({ zdroj, cil, ...volby });
};

describe("gen-knowledge-seed — kotva: platná položka projde", () => {
  it("jedna platná položka dá jeden INSERT s upsertem", () => {
    const { sql, zarazene } = sestav({ "sample-lesson.md": polozka() });
    expect(zarazene).toHaveLength(1);
    expect(sql.match(/INSERT INTO public\.knowledge_items \(/g)).toHaveLength(1);
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE SET");
    expect(sql).toContain("version = public.knowledge_items.version + 1");
    expect(sql).toMatch(/IS DISTINCT FROM/);
    expect(sql).not.toMatch(/DO NOTHING/);
  });
});

describe("gen-knowledge-seed — odmítá vadnou položku (kód 2)", () => {
  for (const pole of ["slug", "title", "summary", "category", "tags", "verified", "evidence", "valid_for", "scope", "status", "author", "ai_instructions"]) {
    it(`chybí povinné pole ${pole}`, () => {
      const text = polozka("sample-lesson", { [pole]: null });
      expect(() => validateItem(parseItem(text, "sample-lesson.md"), "platforma")).toThrow(Vada);
    });
  }

  it("neznámý item_type je chyba a hláška vyjmenuje výčet", () => {
    const p = parseItem(polozka("sample-lesson", { item_type: "how_to" }), "sample-lesson.md");
    expect(() => validateItem(p, "platforma")).toThrow(/není z výčtu knowledge_item_type/);
  });

  it("bez item_type platí engineering_doc", () => {
    const p = validateItem(parseItem(polozka("sample-lesson", { item_type: null }), "sample-lesson.md"), "platforma");
    expect(p.item_type).toBe("engineering_doc");
  });

  for (const typ of Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t] !== "zapis")) {
    it(`item_type ${typ} generátor nezapisuje a řekne proč`, () => {
      const p = parseItem(polozka("sample-lesson", { item_type: typ }), "sample-lesson.md");
      expect(() => validateItem(p, "platforma")).toThrow(/tímto generátorem nejde/);
    });
  }

  it("neznámé pole hlavičky (překlep) je chyba", () => {
    const text = polozka().replace("status: adopted", "status: adopted\nvisiblity: public");
    expect(() => parseItem(text, "sample-lesson.md")).toThrow(/neznámé pole/);
  });

  it("slug musí sedět se jménem souboru", () => {
    expect(() => validateItem(parseItem(polozka(), "other-name.md"), "platforma")).toThrow(/jméno souboru/);
  });

  it("platforma nebere scope instance ani visibility members", () => {
    expect(() => validateItem(parseItem(polozka("sample-lesson", { scope: "instance" }), "sample-lesson.md"), "platforma")).toThrow(/scope/);
    expect(() => validateItem(parseItem(polozka("sample-lesson", { visibility: "members" }), "sample-lesson.md"), "platforma")).toThrow(/visibility/);
  });

  it("vrstva instance nebere obecnou položku a pošle ji do platformy", () => {
    expect(() => validateItem(parseItem(polozka("sample-lesson", { visibility: "public" }), "sample-lesson.md"), "instance")).toThrow(/patří do platformy/);
    const p = validateItem(parseItem(polozka("sample-lesson", { scope: "instance", visibility: "public" }), "sample-lesson.md"), "instance");
    expect(p.visibility).toBe("public");
  });

  it("vrstva instance chce visibility výslovně a nepovolené viditelnosti odmítne s důvodem", () => {
    const bez = parseItem(polozka("sample-lesson", { scope: "instance" }), "sample-lesson.md");
    expect(() => validateItem(bez, "instance")).toThrow(/chce visibility výslovně/);
    for (const vis of Object.keys(VIDITELNOSTI_CEKAJICI)) {
      const p = parseItem(polozka("sample-lesson", { scope: "instance", visibility: vis }), "sample-lesson.md");
      expect(() => validateItem(p, "instance"), vis).toThrow(/zatím nepovoleno/);
      expect(VRSTVY.instance.viditelnosti, `${vis} je čekající, nesmí být zároveň povolená`).not.toContain(vis);
    }
  });

  it("každá vrstva píše svůj vyhrazený source_type, nikdy 'manual'", () => {
    const plat = sestav({ "sample-lesson.md": polozka() }).sql;
    expect(plat).toMatch(/^ {2}'platform_knowledge',$/m);
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka("sample-lesson", { scope: "instance", visibility: "public" }) });
    const inst = buildSeedSql({ zdroj, cil, vrstva: "instance" }).sql;
    expect(inst).toMatch(/^ {2}'instance_knowledge',$/m);
    for (const sql of [plat, inst]) expect(sql).not.toMatch(/^ {2}'manual',$/m);
    expect(Object.values(VYHRAZENE_ZDROJE).sort()).toEqual(["instance_knowledge", "platform_knowledge"]);
  });

  it("stráž v seedu chytá jen stav po ručním zásahu: cizí řádek s naším id, nebo náš slug pod jiným id", () => {
    const { sql } = sestav({ "sample-lesson.md": polozka() });
    // stráž chce vyhrazený typ SVÉ vrstvy — jinak by si vrstvy přepisovaly verzi
    expect(sql).toMatch(/ki\.id = z\.id AND ki\.source_type <> 'platform_knowledge'\)/);
    expect(sql).toMatch(/ki\.source_type = 'platform_knowledge' AND ki\.source_slug = z\.slug AND ki\.locale = 'global' AND ki\.id <> z\.id/);
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka("sample-lesson", { scope: "instance", visibility: "public" }) });
    const inst = buildSeedSql({ zdroj, cil, vrstva: "instance" }).sql;
    expect(inst).toMatch(/ki\.id = z\.id AND ki\.source_type <> 'instance_knowledge'\)/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });

  it("důkaz `file:` musí v checkoutu platformy existovat", () => {
    const zly = parseItem(polozka("sample-lesson", { evidence: ["file: scripts/neexistuje-xyz.mjs"] }), "sample-lesson.md");
    expect(() => validateItem(zly, "platforma")).toThrow(/neexistuje/);
    const dobry = parseItem(polozka("sample-lesson", { evidence: ["file: scripts/db/gen-knowledge-seed.mjs — sám generátor"] }), "sample-lesson.md");
    expect(() => validateItem(dobry, "platforma")).not.toThrow();
  });
});

describe("gen-knowledge-seed — jméno instance v obecné položce", () => {
  const JMENA = ["acme-corp", "globex"];

  it("jméno ze seznamu kdekoli v textu = chyba; hláška jméno neprozradí", () => {
    const text = polozka().replace("Because it was needed once.", "Seen on the Acme-Corp node.");
    let chyba;
    try {
      validateItem(parseItem(text, "sample-lesson.md"), "platforma", { jmena: JMENA });
    } catch (e) {
      chyba = e;
    }
    expect(chyba).toBeInstanceOf(Vada);
    expect(chyba.message).toMatch(/pořadí v seznamu jmen: 1/);
    expect(chyba.message.toLowerCase()).not.toContain("acme");
  });

  it("jméno v důkazu nebo štítku se počítá taky", () => {
    const vDukazu = polozka("sample-lesson", { evidence: ["seen on globex"] });
    expect(() => validateItem(parseItem(vDukazu, "sample-lesson.md"), "platforma", { jmena: JMENA })).toThrow(/pořadí v seznamu jmen: 2/);
    const veStitku = polozka("sample-lesson", { tags: "[sample, globex]" });
    expect(() => validateItem(parseItem(veStitku, "sample-lesson.md"), "platforma", { jmena: JMENA })).toThrow(Vada);
  });

  it("kotva: bez jména projde se stejným seznamem", () => {
    expect(() => validateItem(parseItem(polozka(), "sample-lesson.md"), "platforma", { jmena: JMENA })).not.toThrow();
  });

  it("vrstva instance jména nekontroluje (jsou to její data)", () => {
    const text = polozka("sample-lesson", { scope: "instance", visibility: "public" }).replace("Because it was needed once.", "Seen on the acme-corp node.");
    expect(() => validateItem(parseItem(text, "sample-lesson.md"), "instance", { jmena: JMENA })).not.toThrow();
  });

  it("CLI s --vyzaduj-jmena a prázdným seznamem skončí 2 (NEZMĚŘENO není čisto)", () => {
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka() });
    // Kořen pro čtení jmen = prázdný dočasný adresář: test nezávisí na tom, jestli
    // stroj, na kterém běží, drží config/tenant.json.
    const kod = main(["--zdroj", zdroj, "--cil", cil, "--vyzaduj-jmena"], { AISHA_TENANT_SENTINELS: "" }, path.dirname(zdroj));
    expect(kod).toBe(2);
  });
});

describe("gen-knowledge-seed — stavy a vynechání", () => {
  it("proposed / draft / returned do seedu nejdou a hlavička je vyjmenuje", () => {
    const { sql, zarazene, vynechane } = sestav({
      "a-adopted.md": polozka("a-adopted"),
      "b-proposed.md": polozka("b-proposed", { status: "proposed" }),
      "c-draft.md": polozka("c-draft", { status: "draft" }),
      "d-returned.md": polozka("d-returned", { status: "returned" }),
    });
    expect(zarazene.map((p) => p.slug)).toEqual(["a-adopted"]);
    expect(vynechane.map((p) => p.slug)).toEqual(["b-proposed", "c-draft", "d-returned"]);
    expect(sql).toMatch(/--\s+b-proposed \(proposed\)/);
    expect(sql).not.toContain("'b-proposed'");
  });

  it("retired jde do seedu jako archived (odebrání z existujících DB)", () => {
    const { sql } = sestav({ "old-lesson.md": polozka("old-lesson", { status: "retired" }) });
    expect(STAVY.retired).toBe("archived");
    expect(sql).toMatch(/'old-lesson',[\s\S]*'archived',\n\s+'public'/);
  });

  it("kolize slugu s platformou ve vrstvě instance = chyba", () => {
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka("sample-lesson", { scope: "instance", visibility: "public" }) });
    expect(() => buildSeedSql({ zdroj, cil, vrstva: "instance", slugyPlatformy: new Set(["sample-lesson"]) })).toThrow(/slug už má platforma/);
  });

  it("prázdný adresář zdrojů = NEZMĚŘENO, ne prázdný seed", () => {
    expect(() => sestav({ "README.md": "# jen popis" })).toThrow(/není žádná položka/);
  });
});

describe("gen-knowledge-seed — deterministický výstup", () => {
  it("tytéž zdroje dají bajtově týž soubor (i v jiném pořadí zápisu)", () => {
    const a = sestav({ "b-two.md": polozka("b-two"), "a-one.md": polozka("a-one") }).sql;
    const b = sestav({ "a-one.md": polozka("a-one"), "b-two.md": polozka("b-two") }).sql;
    expect(a).toBe(b);
    expect(a.indexOf("'a-one'")).toBeLessThan(a.indexOf("'b-two'"));
  });

  it("výstup nenese čas ani cestu stroje", () => {
    const { sql } = sestav({ "sample-lesson.md": polozka() });
    expect(sql).not.toMatch(/\/(Users|home|tmp|private|var)\//);
    expect(sql).not.toMatch(/20\d\d-\d\d-\d\dT\d\d:\d\d/);
  });

  it("id = md5('ki-' || source_type || ':' || slug) — každá vrstva vlastní řádek", () => {
    const h = createHash("md5").update("ki-platform_knowledge:sample-lesson").digest("hex");
    expect(idPolozky("sample-lesson", "platform_knowledge").replace(/-/g, "")).toBe(h);
    expect(idPolozky("sample-lesson", "instance_knowledge")).not.toBe(idPolozky("sample-lesson", "platform_knowledge"));
    expect(() => idPolozky("sample-lesson", "manual")).toThrow(Vada);
  });

  it("změna obsahu vynuluje safety_scanned_at (nový obsah se znovu skenuje), karanténu seed nepřepíše", () => {
    const { sql } = sestav({ "sample-lesson.md": polozka() });
    expect(sql).toMatch(/safety_scanned_at = NULL,\n {2}version = public\.knowledge_items\.version \+ 1/);
    expect(sql).not.toMatch(/quarantine_/);
  });

  it("apostrof v textu je zdvojený (SQL literál, ne dolarové uvozovky)", () => {
    const { sql } = sestav({ "sample-lesson.md": polozka().replace("Because it was needed once.", "Don't skip it.") });
    expect(sql).toContain("Don''t skip it.");
  });
});

describe("gen-knowledge-seed — neznámý přepínač je STOP", () => {
  it("neznámý přepínač = kód 2 a soubor se nezapíše; kotva: --help = 0", () => {
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka() });
    const koren = path.dirname(zdroj);
    const env = { AISHA_TENANT_SENTINELS: "acme-corp" };
    expect(main(["--zdroj", zdroj, "--cil", cil, "--chek"], env, koren)).toBe(2);
    expect(existsSync(cil)).toBe(false);
    expect(main(["--help"], env, koren)).toBe(0);
    expect(existsSync(cil)).toBe(false);
    expect(main(["--zdroj", zdroj, "--cil", cil], env, koren)).toBe(0);
    expect(existsSync(cil)).toBe(true);
  });
});

describe("gen-knowledge-seed — --check", () => {
  it("shoda = 0, ruční úprava souboru = 1", () => {
    const { zdroj, cil } = adresar({ "sample-lesson.md": polozka() });
    const env = { AISHA_TENANT_SENTINELS: "acme-corp" };
    const koren = path.dirname(zdroj);
    expect(main(["--zdroj", zdroj, "--cil", cil], env, koren)).toBe(0);
    expect(main(["--zdroj", zdroj, "--cil", cil, "--check"], env, koren)).toBe(0);
    writeFileSync(cil, readFileSync(cil, "utf8").replace("A sample lesson", "A hand-edited lesson"));
    expect(main(["--zdroj", zdroj, "--cil", cil, "--check"], env, koren)).toBe(1);
  });
});
