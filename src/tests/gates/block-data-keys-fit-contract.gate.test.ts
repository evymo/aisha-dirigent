/**
 * Brána: co RPC dá do `data`, musí kontrakt umět PŘIJMOUT.
 *
 * PROČ (naměřeno 2026-08-08 na produkci, v prohlížeči přihlášeného majitele)
 * -------------------------------------------------------------------------
 * Detail faktury hlásil „Data se nepodařilo načíst." Odposlech vlastního volání
 * appky ukázal HTTP 200 a v těle 25 správně načtených polí. Nepadal tedy přenos,
 * padala VALIDACE:
 *
 *   kontrakt record_detail.data dovolil   record_id, badges, fields, quote
 *   get_document_detail vydával           + line_items, lines_pending, missing,
 *                                           source_record   (přibyly 2026-08-05)
 *
 * Ajv je VŠECHNO NEBO NIC. Čtyři neznámé vlastnosti neznamenají čtyři ignorované
 * klíče — zneplatní CELÝ blok, takže se zahodí i těch 25 polí, která dorazila
 * v pořádku. Přesně před tímhle tvarem varuje poznámka u `layoutSchema`, jenže
 * u bloku samotného to nikdo neměřil.
 *
 * Vada přitom NEBYLA hlasitá: uživatel viděl obyčejnou chybovou hlášku, která
 * vypadá na výpadek sítě. A nebyla nová — detail dokladu byl rozbitý i z registru;
 * proklik z faktur ho jen konečně ZPŘÍSTUPNIL.
 *
 * CO SE MĚŘÍ
 * ----------
 * Pro každou dvojici (blok, jeho zdrojová RPC) se přečtou DOSLOVNÉ klíče objektu
 * `data` a porovnají s větví kontraktu pro DEKLAROVANÝ `block_type`.
 *
 * ⭐ UNIVERZUM SI BRÁNA HLEDÁ, NEPÍŠE — a první pokus to spletl. Měřit „všechny
 * funkce, co mají data+provenance" vypadá bezpečněji, ale je to širší množina než
 * „bloky": `get_scope_options` má tutéž obálku a přitom se nikdy nečte jako blok
 * (má vlastní `fetchScopeOptions`). Taková brána vydá poplach nad kódem, který je
 * v pořádku, a ten se pak umlčí výjimkou — čímž se ztratí i pravé nálezy.
 * Autorita je proto REGISTR BLOKŮ (`surface_blocks`): jedině on říká, co je blok,
 * jakého je typu a která RPC ho plní. Navíc je to měření SILNĚJŠÍ — proti jedné
 * konkrétní větvi, ne proti „aspoň nějaké".
 *
 * ⭐ ZDROJ JE PROKAZATELNĚ TADY. Registr žije v instančním overlayi, funkce
 * v platformě. Že se ty dva nerozejdou, hlídá už brána `allowlisted-rpc-has-source`
 * (každá deklarovaná RPC musí mít soubor v `aisha/db/sql/functions`) — a overlay
 * sám nedefinuje ŽÁDNÉ funkce (změřeno 2026-08-08: 0 výskytů
 * `create or replace function`). Skenovat overlay na těla funkcí by tedy nepřidalo
 * pokrytí, jen zdání.
 *
 * SONDA UMÍ ODPOVĚDĚT „NE": funkci, jejíž `data` nejde přečíst doslovně
 * (skládaný klíč, `data` z proměnné), brána NAHLÁSÍ. Tiché přeskočení nečitelného
 * vstupu je způsob, jak brána zezelená nad kódem, který nikdy neviděla. Totéž
 * platí o chybějícím overlayi: brána řekne nahlas, že neměřila nic.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockSchema } from "../../../packages/surface-blocks/src/schemas";
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = join(__dirname, "../../..");
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
// Jedny dveře k overlayi, stejné jako `allowlisted-rpc-has-source`. Bez něj tahle
// brána MĚŘÍ NULU, takže volí volitelný režim s hlasitým přiznáním — a v CI, kde
// overlay k dispozici je, ho AISHA_OVERLAY_REQUIRED=1 povýší na povinný.
const INSTANCE_DIR = overlayDirOrRequired("block-data-keys-fit-contract");
const BASELINE = join(__dirname, "block-data-keys-fit-contract.baseline.json");

/** Konec řetězcového literálu od pozice otevírající apostrofy. */
function endOfString(sql: string, open: number): number {
  let i = open + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") { i += 2; continue; } // '' = escapovaný apostrof
      return i;
    }
    i += 1;
  }
  return sql.length;
}

/**
 * Komentáře pryč DŘÍV než se počítají závorky. Vysvětlivky v těchhle funkcích
 * jsou dlouhé a plné závorek i apostrofů, takže scanner, který je nevyřadí,
 * ztratí hloubku a začne vydávat nesmysly — přesně to potkalo první, zahozenou
 * verzi tohohle měřidla.
 */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      const e = endOfString(sql, i);
      out += sql.slice(i, e + 1);
      i = e + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Doslovné klíče objektu, který začíná závorkou na `open`.
 * `null` = nečitelné (klíč není literál nebo objekt není uzavřený).
 */
function literalKeys(sql: string, open: number): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let arg = 0;
  let started = false; // už jsme v tomhle argumentu viděli první token?
  for (let i = open; i < sql.length; i += 1) {
    const c = sql[i];
    if (c === "(") { depth += 1; continue; }
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return keys;
      continue;
    }
    if (depth !== 1) {
      if (c === "'") i = endOfString(sql, i);
      continue;
    }
    if (c === ",") { arg += 1; started = false; continue; }
    if (/\s/.test(c)) continue;
    if (!started) {
      started = true;
      if (arg % 2 === 0) {
        // sudý argument = KLÍČ. Musí být doslovný, jinak se čtou domněnky.
        if (c !== "'") return null;
        const e = endOfString(sql, i);
        keys.push(sql.slice(i + 1, e));
        i = e;
        continue;
      }
    }
    if (c === "'") i = endOfString(sql, i);
  }
  return null;
}

/** Každý objekt `data`, který funkce skládá (větev nálezu i větev prázdna). */
function dataObjects(sql: string): Array<string[] | null> {
  const out: Array<string[] | null> = [];
  const re = /'data'\s*,\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const after = sql.slice(m.index + m[0].length);
    const call = /^jsonb_build_object\s*\(/.exec(after);
    if (!call) {
      out.push(null); // `data` z proměnné / skládané — nečitelné, ne „v pořádku"
      continue;
    }
    out.push(literalKeys(sql, m.index + m[0].length + call[0].length - 1));
  }
  return out;
}

interface Vetev {
  typ: string;
  vlastnosti: Set<string>;
  povinne: string[];
}

/** Větve kontraktu: co která umí přijmout do `data`. */
function vetve(): Vetev[] {
  const anyOf = (blockSchema as unknown as {
    anyOf: Array<{
      properties: {
        block_type: { const: string };
        data: { properties: Record<string, unknown>; required?: string[] };
      };
    }>;
  }).anyOf;
  return anyOf.map((b) => ({
    typ: b.properties.block_type.const,
    vlastnosti: new Set(Object.keys(b.properties.data.properties)),
    povinne: b.properties.data.required ?? [],
  }));
}

function sedne(klice: string[], v: Vetev): { ok: true } | { ok: false; navic: string[]; chybi: string[] } {
  const navic = klice.filter((k) => !v.vlastnosti.has(k));
  const chybi = v.povinne.filter((r) => !klice.includes(r));
  return navic.length === 0 && chybi.length === 0 ? { ok: true } : { ok: false, navic, chybi };
}

interface Blok {
  slug: string;
  typ: string;
  rpc: string;
}

/**
 * Registr bloků instance: co je blok, jakého typu a která RPC ho plní.
 *
 * Čte se z TÝCHŽ SQL souborů, které nasazení aplikuje, takže se brána nemůže
 * rozejít s tím, co se opravdu nainstaluje.
 */
function registrBloku(dir: string): Blok[] {
  const out: Blok[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = stripComments(readFileSync(join(dir, f), "utf8"));
    for (const ins of sql.matchAll(
      /insert\s+into\s+(?:public\.)?surface_blocks\s*\(([^)]*)\)\s*values([\s\S]*?);/gi,
    )) {
      const cols = ins[1].split(",").map((c) => c.trim().toLowerCase());
      const iSlug = cols.indexOf("block_slug");
      const iTyp = cols.indexOf("block_type");
      const iRpc = cols.indexOf("source_rpc");
      if (iSlug < 0 || iTyp < 0 || iRpc < 0) continue;
      for (const tuple of ins[2].matchAll(/\(([\s\S]*?)\)\s*(?=,\s*\(|$|\s*on\s+conflict)/gi)) {
        // Dělí se jen čárkami MIMO závorky a řetězce — `'{"a":1}'::jsonb` jinak
        // rozpadne sloupce a posune indexy.
        const parts: string[] = [];
        let buf = "";
        let d = 0;
        for (let i = 0; i < tuple[1].length; i += 1) {
          const c = tuple[1][i];
          if (c === "'") { const e = endOfString(tuple[1], i); buf += tuple[1].slice(i, e + 1); i = e; continue; }
          if (c === "(") d += 1;
          if (c === ")") d -= 1;
          if (c === "," && d === 0) { parts.push(buf.trim()); buf = ""; continue; }
          buf += c;
        }
        parts.push(buf.trim());
        const lit = (s?: string): string | null => {
          const m = s ? /^'([^']*)'/.exec(s.trim()) : null;
          return m ? m[1] : null;
        };
        const slug = lit(parts[iSlug]);
        const typ = lit(parts[iTyp]);
        const rpc = lit(parts[iRpc]);
        if (slug && typ && rpc) out.push({ slug, typ, rpc });
      }
    }
  }
  return out;
}

describe("brána: klíče `data` musí sednout na kontrakt bloku", () => {
  const katalog = vetve();
  const bloky = INSTANCE_DIR && existsSync(INSTANCE_DIR) ? registrBloku(INSTANCE_DIR) : null;

  it("měřidlo vůbec něco našlo", () => {
    expect(katalog.length, "kontrakt bloku nemá větve — import blockSchema selhal").toBeGreaterThan(5);
    if (bloky === null) {
      // Ne tiché přeskočení: nahlas říct, že se NEMĚŘILO nic.
      console.warn(
        "block-data-keys-fit-contract: AISHA_INSTANCE_CONFIG_DIR není nastaveno — " +
          "registr bloků NEPŘEČTEN (0 bloků změřeno).",
      );
      return;
    }
    // Prázdný odečet není čistý strom, ale rozbité měřidlo: registr bloky vždycky
    // deklaruje, takže nula znamená, že parser přestal sedět na tvar SQL.
    expect(
      bloky.length,
      `z ${INSTANCE_DIR} přečteno 0 deklarací bloků — parser přestal odpovídat tvaru SQL`,
    ).toBeGreaterThan(5);
  });

  it("každý objekt `data` je čitelný doslovně", () => {
    if (bloky === null) return;
    const necitelne: string[] = [];
    for (const rpc of [...new Set(bloky.map((b) => b.rpc))].sort()) {
      const soubor = join(FUNCTIONS_DIR, `${rpc}.sql`);
      // Chybějící zdroj hlásí `allowlisted-rpc-has-source`; tady se jen neměří.
      if (!existsSync(soubor)) continue;
      const sql = stripComments(readFileSync(soubor, "utf8"));
      dataObjects(sql).forEach((klice, i) => {
        if (klice === null) necitelne.push(`${rpc}.sql (${i + 1}. výskyt \`data\`)`);
      });
    }
    expect(
      necitelne,
      "tyhle funkce skládají `data` tak, že brána neumí přečíst klíče:\n" +
        necitelne.map((n) => `  ${n}`).join("\n") +
        "\n\nCO S TÍM: napsat `data` doslovným `jsonb_build_object('klic', …)`. Klíče JSOU\n" +
        "kontrakt, takže mají být vidět ve zdroji. Když to tvar dovolit nemůže, patří\n" +
        "sem výslovná výjimka s důvodem — ne tiché přeskočení.",
    ).toEqual([]);
  });

  it("žádný blok nevydává klíč, který jeho kontrakt nezná", () => {
    if (bloky === null) return;
    // ROHATKA: dluh naměřený 2026-08-08 smí zůstat, ale nesmí RŮST — a jakmile
    // se opraví, musí ze seznamu zmizet (viz tvrzení níž). Není to whitelist:
    // whitelist mlčí, tohle se hlásí a smršťuje.
    const dluh = new Set<string>(
      (JSON.parse(readFileSync(BASELINE, "utf8")) as { znamy_dluh: string[] }).znamy_dluh,
    );
    const nalezy: string[] = [];
    const potkanyDluh = new Set<string>();
    // Táž RPC může plnit víc bloků (i různých typů). Měří se proti VŠEM typům,
    // pod kterými je deklarovaná — sednout musí aspoň na jeden, protože právě
    // tak ji za běhu potká `get_block_data`.
    const podleRpc = new Map<string, Blok[]>();
    for (const b of bloky) podleRpc.set(b.rpc, [...(podleRpc.get(b.rpc) ?? []), b]);

    for (const [rpc, deklarace] of [...podleRpc.entries()].sort()) {
      const soubor = join(FUNCTIONS_DIR, `${rpc}.sql`);
      if (!existsSync(soubor)) continue;
      const sql = stripComments(readFileSync(soubor, "utf8"));
      const typy = [...new Set(deklarace.map((d) => d.typ))];
      dataObjects(sql).forEach((klice, i) => {
        if (klice === null) return; // hlásí test výš
        const vysledky = typy.map((t) => {
          const v = katalog.find((x) => x.typ === t);
          return { typ: t, r: v ? sedne(klice, v) : null };
        });
        if (vysledky.some((x) => x.r?.ok)) return;
        if (dluh.has(rpc)) { potkanyDluh.add(rpc); return; }
        const detail = vysledky.map((x) => {
          if (!x.r) return `      ${x.typ}: takový typ kontrakt vůbec nezná`;
          // Sem se dojde jen tehdy, když NEsedla ani jedna větev (viz `return`
          // výš), takže tohle je zúžení typu, ne mrtvá větev navíc.
          if (x.r.ok) return `      ${x.typ}: sedí`;
          const casti = [
            x.r.navic.length > 0 ? `navíc ${x.r.navic.join(", ")}` : null,
            x.r.chybi.length > 0 ? `chybí povinné ${x.r.chybi.join(", ")}` : null,
          ].filter(Boolean);
          return `      ${x.typ}: ${casti.join("; ")}`;
        });
        nalezy.push(
          `  ${rpc}.sql (${i + 1}. výskyt \`data\`) — plní bloky: ${deklarace.map((d) => d.slug).join(", ")}\n` +
            `    vydává: ${klice.join(", ")}\n` +
            `    proti deklarovanému typu:\n${detail.join("\n")}`,
        );
      });
    }
    expect(
      nalezy,
      "RPC vydává do `data` klíče, které kontrakt bloku nezná:\n\n" +
        nalezy.join("\n\n") +
        "\n\nCO TO UDĚLÁ UŽIVATELI: Ajv je všechno-nebo-nic, takže se nezahodí ten jeden\n" +
        "neznámý klíč, ale CELÝ blok — na obrazovce je „Data se nepodařilo načíst“ i nad\n" +
        "daty, která dorazila v pořádku.\n\n" +
        "CO S TÍM — jedno ze dvou, nikdy nic mezi tím:\n" +
        "  (a) klíč je užitečný ⇒ doučit kontrakt v packages/surface-blocks/src/schemas.ts\n" +
        "      A ZÁROVEŇ ho vykreslit; přijmout data a zahodit je je táž vada jinde;\n" +
        "  (b) klíč užitečný není ⇒ přestat ho posílat.\n" +
        "Kontrakt se rozšiřuje ve vydání, které jde VEN DŘÍV než ta RPC (viz poznámka\n" +
        "u `provenance` v schemas.ts): starý bundle nesmí potkat nový klíč.",
    ).toEqual([]);

    // Druhá půlka rohatky: co je opravené, musí ze seznamu ZMIZET. Bez tohohle
    // by dluh tiše zvěčněl — a příští čtenář by seznam četl jako povolení místo
    // jako záznam o tom, co se ještě nestihlo.
    const uzOpravene = [...dluh].filter((r) => !potkanyDluh.has(r)).sort();
    expect(
      uzOpravene,
      "tyhle funkce jsou v baseline jako známý dluh, ale kontrakt už jim sedí:\n" +
        uzOpravene.map((r) => `  ${r}`).join("\n") +
        "\n\nCO S TÍM: vyškrtnout je z block-data-keys-fit-contract.baseline.json.\n" +
        "Rohatka se smí jen utahovat.",
    ).toEqual([]);
  });
});
