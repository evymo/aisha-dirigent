/**
 * Brána: co RPC povrchu vydá, musí projít maskou, která to má vykreslit
 *
 * VZNIKLA Z ŽIVÉHO NÁLEZU (produkce, 2026-08-01). Dvě nezávislá měřidla ukázala
 * tutéž patnáctku: **15 z 38 umístěných bloků povrch TIŠE ZAHODIL**. Sekce
 * `Registry` byla celá prázdná, ačkoli databáze za ní měla 1 354 + 121 + 63 + 33
 * + 12 řádků. Uživatel neviděl chybu — viděl „Zatím není co zobrazit."
 *
 * MECHANISMUS: shell validuje odpověď proti `blockSchema`
 * (`apps/workbench-shell/src/api.ts` → `validateBlock(raw)`) a nevalidní blok
 * zahodí (`.catch(() => null)` + `filter(Boolean)`). Kontrakt má DVĚ strany
 * v TOMTO repu — SQL producenta v `aisha/db/sql/functions/` a masku
 * v `packages/surface-blocks/src/schemas.ts` — a nic je nedrželo u sebe. SQL
 * strana rostla (přibylo `data.entity_kind`, sloupec dostal `label` s hotovým
 * českým textem), TS strana ne. Učebnicová „PŮLKA ZMĚNY": jedna strana přistane,
 * druhá visí, a projeví se to jako „nejsou data", ne jako chyba.
 *
 * PROČ RUNTIME, NE STATICKÁ KONTROLA: rozpor je v HODNOTĚ, kterou funkce vydá,
 * ne v jejím zápisu. `jsonb_build_object` se skládá za běhu z několika větví —
 * přečíst zdroj nestačí, musí se zavolat.
 *
 * PROČ TO CHYTÍ I NAD PRÁZDNOU DB: vada je STRUKTURÁLNÍ, ne datová. Naměřeno na
 * produkci 2026-08-01: admin (s daty) i bezrolový člen (0 řádků) dostali shodně
 * nevalidní bloky — `columns` i `entity_kind` se vydávají i k prázdné množině.
 * Brána proto nepotřebuje korpus, stačí jí schéma a živé funkce.
 *
 * OVĚŘENÍ MĚŘIDLA (než se tomuhle testu začne věřit): `validateBlockData` byl
 * puštěn na 82 SKUTEČNÝCH produkčních odpovědí (41 bloků × 2 identity, taženo
 * pod rolí `authenticated`) a označil přesně těch 16 bloků katalogu, které
 * nezávisle našel DOM produkčního bundle — z toho 15 umístěných. Ne 7 (moje
 * první, hrubší kontrola) ani 32 (validace špatného tvaru).
 *
 * ŽIVÝ BĚH 2026-08-01 (throwaway DB ze SoT, cold start, NULA řádků dat):
 *   · patro 1 — 7 producentů vydá tvar, který žádná maska nepřijme;
 *   · patro 2 (po nahrání instančního seedu povrchů) — 8 z 38 umístěných bloků
 *     dispečer vydá a povrch zahodí, bez jediného řádku v databázi.
 *   Zbylých 7 z produkční patnáctky potřebuje k projevu data — ta CI chytí až
 *   nad seedem s řádky. I tak: většina vady je vidět dřív, než vznikne korpus.
 *
 * DVĚ PATRA (druhé jen tam, kde je katalog):
 *   1. PRODUCENTI — každá SoT funkce, která vydává blokový tvar, musí vydat
 *      `data`, které projde aspoň jednou maskou. Univerzum se HLEDÁ ve zdroji.
 *   2. DISPEČER — když jsou v DB instanční bloky, projde se celá cesta
 *      `get_block_data` → validace, tedy přesně to, co dělá prohlížeč.
 *
 * Spouští se přes: npm run test:db -- surface-block-contract
 */

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockSchema, validateBlockData } from "@aisha/surface-blocks";
import { psqlQuery } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
const BASELINE_PATH = join(ROOT, "src/tests/db/surface-block-contract.baseline.json");

/**
 * Známý dluh, aby brána mohla být ZAPOJENÁ dřív, než se kontrakt opraví.
 * Týž idiom jako `aisha-branding.baseline.json`: dluh smí jen klesat — co
 * v seznamu není, běh shodí; co se opraví, se jen ohlásí (oprava se netrestá).
 */
const baseline: { producers: string[]; blocks: string[]; translation_keys?: string[] } = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : { producers: [], blocks: [], translation_keys: [] };

/** Jméno před šipkou — nálezy nesou i důvod, baseline jen jméno. */
const jmeno = (nalez: string): string => nalez.split(" →")[0]!.split(":")[0]!.trim();

/**
 * Rozdělí nálezy na NOVÉ (shodí bránu) a známé z baseline (jen se ohlásí),
 * a doplní stále vedené položky, které už neplatí — ať seznam nehnije.
 */
function protiBaseline(nalezy: string[], znami: string[]) {
  const jmena = nalezy.map(jmeno);
  return {
    nove: nalezy.filter((n) => !znami.includes(jmeno(n))),
    zname: nalezy.filter((n) => znami.includes(jmeno(n))),
    opravene: znami.filter((z) => !jmena.includes(z)),
  };
}

/**
 * Identita, pod kterou se měří. Role `authenticated` je podstatná: pod
 * `postgres`/`service_role` se obchází RLS, a role, pod kterou měřím, JE součást
 * měřidla. Konkrétní `sub` je libovolné — brána měří TVAR, ne řádky.
 */
const MERICI_SUB = "00000000-0000-4000-8000-000000000001";

/** Značka, kterou se odpověď pozná mezi návěštími psql. */
const ZNACKA_HODNOTA = "@@JSON@@";
const ZNACKA = `'${ZNACKA_HODNOTA}'`;

/** Odstraní SQL komentáře — brána nesmí chytat příklad z dokumentace. */
function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Univerzum producentů: SoT funkce, které skládají blokový tvar (`data`
 * i `provenance`). Hledá se ve zdroji a ověřuje proti `pg_proc` — nikde se
 * nevypisuje, takže nová funkce je pod bránou od prvního commitu.
 */
function producentiZeZdroje(): string[] {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const sql = bezKomentaru(readFileSync(join(FUNCTIONS_DIR, f), "utf8"));
      return /jsonb_build_object/i.test(sql) && /'data'/.test(sql) && /'provenance'/.test(sql);
    })
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}

/**
 * Zavolá výraz pod `authenticated` ve VRÁCENÉ transakci a vrátí jeho jsonb.
 *
 * PSQL vypisuje i návěští příkazů (`BEGIN`, `SET`, `ROLLBACK`) a `set_config`
 * vrací svou hodnotu — odpověď tedy NENÍ poslední řádek výstupu. Brát poslední
 * řádek znamená parsovat „ROLLBACK" a každé volání prohlásit za nezměřitelné;
 * takhle tahle brána poprvé zezelenala nad nulou skutečných měření.
 */
function zavolejPodIdentitou(
  vyraz: string,
): { ok: true; json: unknown } | { ok: false; chyba: string } {
  const sql =
    `begin; ` +
    `select set_config('request.jwt.claims', '{"sub":"${MERICI_SUB}","role":"authenticated"}', true); ` +
    `set local role authenticated; ` +
    `select ${ZNACKA} || (${vyraz})::text; ` +
    `rollback;`;
  try {
    const radek = psqlQuery(sql)
      .split("\n")
      .map((r) => r.trim())
      .find((r) => r.startsWith(ZNACKA_HODNOTA));
    if (radek === undefined) return { ok: false, chyba: "ve výstupu psql není označená odpověď" };
    return { ok: true, json: JSON.parse(radek.slice(ZNACKA_HODNOTA.length)) };
  } catch (e) {
    return { ok: false, chyba: String(e).slice(0, 180) };
  }
}

const dataZOdpovedi = (json: unknown): unknown => (json as { data?: unknown } | null)?.data;

/**
 * Míří payload vůbec na nějakou masku?
 *
 * Univerzum se hledá podle TVARU zdroje (`data` + `provenance`), a ten tvar má
 * i pár RPC, které blok nikdy nevykresluje — `get_scope_options` plní přepínač
 * pohledu, ne masku. Bez tohohle filtru je hlásí jako porušení a brána, která
 * křičí na správné chování, se přestane číst. Kdo nesdílí s žádnou maskou ani
 * jeden povinný klíč, blokový producent není; hlásí se, ale neshazuje běh.
 */
function miriNaMasku(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const klice = Object.keys(data as Record<string, unknown>);
  type Vetev = { properties?: { data?: { required?: string[] } } };
  const vetve = (blockSchema as unknown as { anyOf?: Vetev[] }).anyOf ?? [];
  return vetve.some((v) => (v.properties?.data?.required ?? []).some((k) => klice.includes(k)));
}

describe("kontrakt bloku: co RPC vydá, musí projít maskou", () => {
  let dbZije = false;
  let volatelni: string[] = [];

  beforeAll(async () => {
    dbZije = await isPgReachable();
    if (!dbZije) return;
    const kandidati = producentiZeZdroje();
    if (kandidati.length === 0) return;
    // Volatelné = všechny argumenty mají default. Brána si parametry NEVYMÝŠLÍ;
    // co bez nich zavolat nejde, se níž vypíše jako nezměřené.
    const seznam = kandidati.map((n) => `'${n}'`).join(",");
    volatelni = psqlQuery(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace ` +
        `where n.nspname = 'public' and p.proname in (${seznam}) ` +
        `and p.pronargs = p.pronargdefaults group by p.proname order by 1;`,
    )
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
  });

  it("měřidlo má co měřit (SoT vydává blokové producenty)", () => {
    expect(
      producentiZeZdroje().length,
      "ve zdroji nejsou funkce skládající blokový tvar — brána by zezelenala nad prázdnem",
    ).toBeGreaterThan(15);
  });

  it("každý producent vydá `data`, které projde aspoň jednou maskou", () => {
    if (!dbZije) {
      console.warn("[brána bloků] DB není dostupná — patro 1 NEBĚŽELO (spusť přes npm run test:db)");
      return;
    }
    expect(volatelni.length, "žádný producent nejde zavolat bez parametrů").toBeGreaterThan(10);

    const porusuje: string[] = [];
    const nezmereno: string[] = [];
    const mimoKatalog: string[] = [];
    let zmereno = 0;
    for (const fn of volatelni) {
      const r = zavolejPodIdentitou(`public.${fn}()`);
      if (!r.ok) {
        nezmereno.push(`${fn}: ${r.chyba}`);
        continue;
      }
      const data = dataZOdpovedi(r.json);
      if (data === undefined) continue; // za běhu nevydává blokový tvar — není předmětem brány
      if (!miriNaMasku(data)) {
        mimoKatalog.push(fn);
        continue;
      }
      zmereno += 1;
      const v = validateBlockData(data);
      if (!v.ok) porusuje.push(`${fn} → maska '${v.mask}': ${v.errors.slice(0, 3).join(" · ")}`);
    }
    if (mimoKatalog.length > 0) {
      console.warn(
        `[brána bloků] ${mimoKatalog.length} RPC vydává tvar s 'data', ale nemíří na žádnou masku ` +
          `(nejsou to blokoví producenti): ${mimoKatalog.join(", ")}`,
      );
    }

    // Nezměřené se HLÁSÍ, ne mlčky přeskakují — jinak brána zdědí díru vstupu.
    if (nezmereno.length > 0) {
      console.warn(`[brána bloků] ${nezmereno.length} producentů nešlo změřit:\n  ${nezmereno.join("\n  ")}`);
    }
    // A hlavně: zelená se NESMÍ dát vyrobit tím, že měření selže. Přesně takhle
    // tahle brána poprvé prošla — všech 21 volání spadlo na parsování výstupu
    // a prázdný seznam porušení vypadal jako úspěch.
    expect(
      zmereno,
      `Brána nezměřila prakticky nic (${zmereno} z ${volatelni.length}) — zelená by ` +
        `znamenala „nic jsem nenašel", ne „nic tam není". Nezměřené:\n  ${nezmereno.join("\n  ")}`,
    ).toBeGreaterThanOrEqual(Math.ceil(volatelni.length / 2));
    const proti = protiBaseline(porusuje, baseline.producers);
    if (proti.zname.length > 0) {
      console.warn(`[brána bloků] známý dluh (baseline), neshazuje:\n  ${proti.zname.join("\n  ")}`);
    }
    if (proti.opravene.length > 0) {
      // POZOR na formulaci: nad databází bez dat se řada vad NEPROJEVÍ (sloupce
      // i entity_kind se u některých bloků skládají až z řádků). „Neprojevilo se"
      // proto NENÍ „opraveno" — kdo by to vzal doslova a smazal položku z baseline,
      // přišel by o záznam vady, kterou produkce s daty pořád má.
      console.warn(
        `[brána bloků] v TOMHLE prostředí se neprojevilo (může být opraveno, nebo jen ` +
          `chybí data — ověř nad seedem s řádky, než smažeš z baseline): ${proti.opravene.join(", ")}`,
      );
    }
    expect(
      proti.nove,
      `Tyhle funkce vydávají tvar, který žádná maska nepřijme — povrch je ZAHODÍ ` +
        `a uživateli napíše „Zatím není co zobrazit.":\n  ${proti.nove.join("\n  ")}\n\n` +
        `Oprava patří do SoT (funkce vydá, co maska umí) NEBO do schemas.ts ` +
        `(maska přijme, co doména potřebuje) — které z toho, rozhoduje majitel. ` +
        `NEOPRAVOVAT tolerantní validací v shellu: tím se zruší jediný mechanismus, ` +
        `který rozpor dnes hlásí.`,
    ).toEqual([]);
  });

  it("celá cesta dispečerem: každý umístěný blok projde validací prohlížeče", () => {
    if (!dbZije) {
      console.warn("[brána bloků] DB není dostupná — patro 2 NEBĚŽELO");
      return;
    }
    const umisteni = Number(psqlQuery("select count(*) from public.surface_layouts;") || "0");
    if (umisteni === 0) {
      // Katalog bloků je INSTANČNÍ DATUM (seed instančního repa), ne součást
      // platformy. Nad čistou platformou nemá patro 2 co měřit — a tiše zelená
      // brána nad prázdnem je horší než žádná, proto to říká nahlas.
      console.warn(
        "[brána bloků] surface_layouts je prázdná — patro 2 PŘESKOČENO. Aby běželo, " +
          "musí být před testem nahrán instanční seed povrchů (surface_sections, " +
          "surface_blocks, surface_layouts).",
      );
      return;
    }

    // Vazba je přes `surface_layouts.block_id` → `surface_blocks.id`; slug nese
    // katalog jako `block_slug`. (Napsat `b.slug` a `l.block_slug` znamená
    // vymyslet si tvar schématu — brána pak spadne na sobě, ne na nálezu.)
    const slugy = psqlQuery(
      "select distinct b.block_slug from public.surface_layouts l " +
        "join public.surface_blocks b on b.id = l.block_id " +
        "where l.is_active and b.is_active order by 1;",
    )
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    expect(slugy.length, "umístění existují, ale žádné nemá blok v katalogu").toBeGreaterThan(0);

    const zahozene: string[] = [];
    for (const slug of slugy) {
      const r = zavolejPodIdentitou(`public.get_block_data('${slug}', '{}'::jsonb)`);
      if (!r.ok) {
        zahozene.push(`${slug}: volání selhalo — ${r.chyba}`);
        continue;
      }
      const v = validateBlockData(dataZOdpovedi(r.json));
      if (!v.ok) zahozene.push(`${slug} → maska '${v.mask}': ${v.errors.slice(0, 3).join(" · ")}`);
    }

    const proti = protiBaseline(zahozene, baseline.blocks);
    if (proti.zname.length > 0) {
      console.warn(`[brána bloků] známý dluh (baseline), neshazuje:\n  ${proti.zname.join("\n  ")}`);
    }
    if (proti.opravene.length > 0) {
      console.warn(`[brána bloků] OPRAVENO — smaž z baseline: ${proti.opravene.join(", ")}`);
    }
    expect(
      proti.nove,
      `Tyhle bloky layout vydá, ale povrch je zahodí — uživatel uvidí prázdnou sekci ` +
        `(naměřeno na produkci 2026-08-01: 15 z 38):\n  ${proti.nove.join("\n  ")}`,
    ).toEqual([]);
  });
});

/**
 * Brána: překladový klíč, který blok VYDÁ, musí mít překlad
 *
 * VZNIKLA ZE ŽIVÉHO NÁLEZU (produkce, 2026-08-01): **226 položek ve dvou sekcích
 * ukazovalo uživateli surový klíč** místo textu (`app.wb.finding.date_gap_exceeded`
 * a spol.) — tři klíče nechyběly v jednom slovníku, chyběly v OBOU.
 *
 * ⭐ PROČ TO STATICKÁ KONTROLA NEMŮŽE CHYTIT — a proč tahle brána musí být runtime:
 * klíč se skládá až za běhu Z DATOVÉ HODNOTY:
 *
 *     aisha/db/sql/functions/get_evidence_findings.sql:37
 *     'title_key', 'app.wb.finding.' || items.finding
 *
 * Ve zdrojovém kódu tedy takový klíč NEEXISTUJE. Repo má i18n bránu
 * (`npm run check:i18n`) a ta je poctivá — sama hlásí, co neprohlédla — ale
 * skenuje volání `t('app.*')` v shellu a `title_key` z katalogu bloků. Klíč
 * poskládaný z obsahu databáze je pro ni neviditelný; ověřeno, že s propojeným
 * instančním adresářem projde zeleně (111 klíčů) i ve chvíli, kdy těch 226
 * položek na produkci svítí syrově.
 *
 * CO BRÁNA MĚŘÍ: zavolá každý umístěný blok, VYBERE Z ODPOVĚDI všechny hodnoty
 * polí končících na `_key` (title_key, label_key, unit_key…) — tedy přesně to,
 * co povrch pošle překladači — a ověří, že pro každý klíč existuje řádek
 * v `translations`. Obě množiny se HLEDAJÍ, ani jedna se nevypisuje.
 */
describe("překladový klíč, který blok vydá, musí mít překlad", () => {
  it("žádný blok neposílá na obrazovku klíč, který slovník nezná", async () => {
    if (!(await isPgReachable())) {
      console.warn("[brána klíčů] DB není dostupná — NEBĚŽELO (spusť přes npm run test:db)");
      return;
    }
    const umisteni = Number(psqlQuery("select count(*) from public.surface_layouts;") || "0");
    if (umisteni === 0) {
      console.warn(
        "[brána klíčů] surface_layouts je prázdná — PŘESKOČENO. Aby běželo, musí být " +
          "před testem nahrán instanční seed povrchů a překladů.",
      );
      return;
    }

    const slugy = psqlQuery(
      "select distinct b.block_slug from public.surface_layouts l " +
        "join public.surface_blocks b on b.id = l.block_id " +
        "where l.is_active and b.is_active order by 1;",
    )
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);

    /** Posbírá hodnoty všech polí `*_key` z libovolně zanořené odpovědi. */
    const klice = new Set<string>();
    const sesbirej = (uzel: unknown): void => {
      if (Array.isArray(uzel)) return uzel.forEach(sesbirej);
      if (uzel === null || typeof uzel !== "object") return;
      for (const [k, v] of Object.entries(uzel as Record<string, unknown>)) {
        if (k.endsWith("_key") && typeof v === "string" && v.length > 0) klice.add(v);
        else sesbirej(v);
      }
    };

    for (const slug of slugy) {
      const r = zavolejPodIdentitou(`public.get_block_data('${slug}', '{}'::jsonb)`);
      if (r.ok) sesbirej(r.json);
    }

    expect(
      klice.size,
      "žádný blok nevydal ani jeden překladový klíč — brána by zezelenala nad prázdnem",
    ).toBeGreaterThan(10);

    // ZÁMĚR: překlady mají být DYNAMICKÉ V DB — editovatelné bez rebuildu, přes
    // tutéž tabulku, do které píše administrace. Build-time inventář
    // (instances/<slug>/i18n.json) je záchranná síť pro selhaný fetch, ne cíl:
    // klíč, který zná jen on, jde změnit až přenasazením.
    const seznam = [...klice].map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
    const vDb = new Set(
      psqlQuery(`select distinct key from public.translations where key in (${seznam});`)
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
    );

    // Co drží jen inventář v balíku — pro rozlišení DVOU různých závažností.
    const vBalíku = new Set<string>();
    const instDir = join(ROOT, "instances");
    if (existsSync(instDir)) {
      for (const slug of readdirSync(instDir)) {
        const soubor = join(instDir, slug, "i18n.json");
        if (!existsSync(soubor)) continue;
        const inv = JSON.parse(readFileSync(soubor, "utf8")) as Record<string, unknown>;
        for (const [locale, mapa] of Object.entries(inv)) {
          if (locale.startsWith("_") || mapa === null || typeof mapa !== "object") continue;
          for (const k of Object.keys(mapa as Record<string, string>)) vBalíku.add(k);
        }
      }
    }

    const mimoDb = [...klice].filter((k) => !vDb.has(k)).sort();
    const nikde = mimoDb.filter((k) => !vBalíku.has(k)); // uživatel vidí SYROVÝ KLÍČ
    const jenBalík = mimoDb.filter((k) => vBalíku.has(k)); // vykreslí se, ale needitovatelné

    if (jenBalík.length > 0) {
      console.warn(
        `[brána klíčů] ${jenBalík.length} klíčů drží jen build-time inventář, ne DB — ` +
          `vykreslí se správně, ale změna vyžaduje rebuild, ne editaci v administraci. ` +
          `Posun do DB je dluh, ne havárie:\n  ${jenBalík.join("\n  ")}`,
      );
    }

    const noveKlice = nikde.filter((k) => !(baseline.translation_keys ?? []).includes(k));
    const znameKlice = nikde.filter((k) => (baseline.translation_keys ?? []).includes(k));
    if (znameKlice.length > 0) {
      console.warn(`[brána klíčů] známý dluh (baseline), neshazuje: ${znameKlice.join(", ")}`);
    }
    expect(
      noveKlice,
      `Tyhle klíče blok pošle na obrazovku a NEZNÁ JE ANI DB, ANI inventář v balíku — ` +
        `uživatel uvidí syrový klíč místo textu (naměřeno na produkci 2026-08-01: ` +
        `226 položek ve dvou sekcích):\n  ${nikde.join("\n  ")}\n\n` +
        `Statická i18n brána (npm run check:i18n) tuhle třídu chytit NEMŮŽE: klíč ` +
        `vzniká až za běhu spojením s daty — get_evidence_findings.sql skládá ` +
        `'app.wb.finding.' || items.finding, a sloupec li_findings.finding je prostý ` +
        `text BEZ číselníku. Množina klíčů, které povrch může vyslat, je tím ` +
        `NEOHRANIČENÁ: doplnit tři překlady problém neuzavře, protože příští typ ` +
        `nálezu z ingestu přinese další. Rozhodnutí patří majiteli — buď doméně dát ` +
        `uzavřený číselník (pak jdou klíče vyjmenovat a hlídat staticky), nebo klíč ` +
        `přestat skládat z hodnoty a vydávat ho z katalogu, který překlad vynucuje.`,
    ).toEqual([]);
  });
});
