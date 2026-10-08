/**
 * Brána: čerstvost bloku se bere Z DAT, ne z hodin serveru.
 *
 * PROČ (naměřeno 2026-09-23 na produkci instance)
 * -----------------------------------------------
 * Faktury v extranetu stály na exportu z 6. 8., ale bloky hlásily čerstvost
 * „dnes, před chvílí": `'freshness_at', to_char(now() …)` v datové větvi říká
 * čtenáři, jak čerstvá jsou data, a přitom měří jen to, kdy se funkce zavolala.
 * Karta protistrany ukazovala u všech bloků čas načtení stránky, ačkoli data byla
 * sedm týdnů stará. Čtenář tak nemá jak poznat, že se dívá na zamrzlý zdroj —
 * lež vypadá přesně jako pravda.
 *
 * CO JE SPRÁVNĚ (vzor `get_twin_metric_*`, upstream #1052)
 * -------------------------------------------------------
 * - čerstvost = nejnovější čas záznamu (max(occurred_at/ingested_at/…)) ve STEJNÉM
 *   dotazu jako hodnota — jinak se okno čísla a času rozejdou;
 * - prázdné univerzum → `trace_id` nese `:no_data` a `now()` smí být JEN záloha:
 *   `COALESCE(v_fresh, v_now)` — poslední argument coalesce, nikdy jinde;
 * - odmítací větve (bez nároku, chybí konfigurace…) žádná data nemají; tam je
 *   `now()` v pořádku a `trace_id` to přizná literálem `…:<důvod>` ze SLOVNIK_DUVODU
 *   (`…:unauthorized`, `…:missing_config`, `…:bad_config`, …).
 *
 * CO SE MĚŘÍ
 * ----------
 * Každý výskyt klíče `'freshness_at'` v `aisha/db/sql/functions/*.sql` (komentáře
 * vyřazené DŘÍV, než se počítají závorky — detektor, který čte komentáře jako kód,
 * už jednou hlásil nesmysly). Hodnota se klasifikuje:
 *   z dat      — nikde `now()`/`current_timestamp` ani jejich alias → v pořádku;
 *   záloha     — `now()` JEN jako poslední argument `coalesce(...)` → v pořádku;
 *   odmítnutí  — `trace_id` TÉŽE obálky je jediný literál `…:<důvod>` → v pořádku;
 *   holé now() — cokoli jiného → VADA.
 * Alias = proměnná přiřazená z `now()` (i přes další přiřazení: `v_to := v_now`).
 * Bez sledování aliasů by `to_char(v_now …)` v datové větvi prošlo — vzorové
 * funkce #1052 drží `now()` právě v `v_now`.
 *
 * ROHATKA: `cerstvost-z-dat.baseline.json` je DLUH, ne povolení. Brána selže na
 * nové funkci s vadou i na funkci, která v seznamu zůstala, ačkoli už je opravená.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
const BASELINE = join(__dirname, "cerstvost-z-dat.baseline.json");

const NOW_FN = /\b(now\s*\(\s*\)|current_timestamp|localtimestamp|clock_timestamp\s*\(\s*\)|statement_timestamp\s*\(\s*\)|transaction_timestamp\s*\(\s*\))/i;
/**
 * SLOVNÍK DŮVODŮ ODMÍTNUTÍ — jediný zdroj pravdy (2026-10-04).
 *
 * Odmítací větev smí vzít čas z hodin JEN proto, že `trace_id` přizná důvod. Důvod
 * proto musí být pravda a mít jeden význam. Do 2026-10-04 tu bylo 17 slov „do zásoby“,
 * funkce používaly 6 a táž podmínka (přihlášený bez role) vracela tři různá
 * (unauthenticated / unauthorized / forbidden); vadná hodnota se hlásila jako chybějící.
 * Testy níž hlídají: slovo ze slovníku nějaká funkce opravdu vrací (žádné mrtvé slovo),
 * zastaralé synonymum není v žádném `trace_id` a důvod předaný pomocníku odmítnutí je
 * ze slovníku. Chování (které slovo kdy) měří pgTAP 37 a 36.
 */
export const SLOVNIK_DUVODU: Readonly<Record<string, string>> = {
  unauthorized: "volající nemá nárok (přihlášený bez role); anon k blokům nemá EXECUTE — měří pgTAP 37",
  missing_config: "povinný klíč konfigurace bloku chybí (i JSON null)",
  bad_config: "klíč konfigurace je, ale hodnota je nepoužitelná (typ, rozsah, neznámá hodnota, neexistující sloupec) — nikdy tichý výchozí",
  not_found: "záznam, na který se požadavek ptá, neexistuje",
  no_record: "požadavek neurčuje, který záznam (identita v parametrech chybí nebo je nepoužitelná)",
};

/** Zastaralá synonyma → slovo slovníku, které je nahrazuje (chybová hláška ho jmenuje). */
export const ZASTARALA_SYNONYMA: Readonly<Record<string, string>> = {
  unauthenticated: "unauthorized", forbidden: "unauthorized", denied: "unauthorized",
  no_access: "unauthorized", no_scope: "unauthorized",
  invalid_config: "bad_config", invalid: "bad_config", invalid_params: "bad_config",
  bad_params: "bad_config", bad_column: "bad_config", unsupported: "bad_config", unknown: "bad_config",
  missing_params: "missing_config",
};

/** Důvody, které smí nést odmítací větev (bez dat → čas volání je v pořádku) — odvozeno ze slovníku. */
const DUVODY_ODMITNUTI = new RegExp(`:(${Object.keys(SLOVNIK_DUVODU).join("|")})$`, "i");

/** Všechny literály `'trace_id', '…'` v textu funkce (komentáře pryč). */
export function literalyTrace(sql: string): string[] {
  return [...bezKomentaru(sql).matchAll(/'trace_id'\s*,\s*'((?:[^']|'')*)'/gi)].map((m) => m[1]!);
}

/** Jméno pomocníka odmítnutí, jehož volající brána čte (`duvodyPomocniku`). */
const POMOCNIK_ODMITNUTI = /_block_empty$/;

/** Důvody předané pomocníku odmítnutí: `<něco>_block_empty(<pohled>, '<důvod>', …)` — trace skládá pomocník. */
export function duvodyPomocniku(sql: string): string[] {
  return [...bezKomentaru(sql).matchAll(/\b[a-z_]+_block_empty\s*\([^,()]*,\s*'([a-z_]+)'/gi)].map((m) => m[1]!);
}

/**
 * Funkce bere čas nebo důvod z PARAMETRU (`'freshness_at', p_x` / `'trace_id', '…:' || p_x`).
 * Brána takovou funkci sama nepřečte — klasifikátor vidí „čas z dat“, ačkoli volající předává now(),
 * a důvod skládá až běh. Musí to být jmenovaný pomocník, jehož VOLAJÍCÍ brána čte.
 */
export function berePuvodZParametru(sql: string): boolean {
  const t = bezKomentaru(sql);
  // Skalární parametr použitý PŘÍMO; `p_params->>'klíč'` je konfigurace bloku (datový identifikátor), ne předaný původ.
  return /'freshness_at'\s*,\s*p_[a-z0-9_]+\b(?!\s*->)/i.test(t)
    || /'trace_id'\s*,\s*'[^']*'\s*\|\|\s*(?:coalesce\s*\(\s*)?p_[a-z0-9_]+\b(?!\s*->)/i.test(t);
}

/** Komentáře (`--`, blokové) pryč; řetězcové literály zůstanou, jen se přeskočí. */
export function bezKomentaru(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const k = sql.indexOf("*/", i + 2);
      i = k < 0 ? sql.length : k + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Text bez obsahu řetězcových literálů (nahrazeno mezerami) — pro hledání tokenů. */
function bezRetezcu(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(Math.max(0, m.length - 2)) + "'");
}

/** Konec výrazu argumentu od pozice `od` (do čárky/závorky na úrovni 0). Pracuje nad textem bez řetězců. */
function konecArgumentu(t: string, od: number): number {
  let d = 0;
  for (let k = od; k < t.length; k += 1) {
    const c = t[k];
    if (c === "(") d += 1;
    else if (c === ")") { if (d === 0) return k; d -= 1; }
    else if (c === "," && d === 0) return k;
  }
  return t.length;
}

/**
 * Hranice CELÉHO seznamu argumentů volání kolem pozice `i` (jsonb_build_object):
 * od otevírací závorky po zavírací — `trace_id` může stát před i ZA `freshness_at`.
 */
function obalujiciVolani(t: string, i: number): [number, number] {
  let d = 0;
  let zac = 0;
  for (let k = i; k >= 0; k -= 1) {
    const c = t[k];
    if (c === ")") d += 1;
    else if (c === "(") { if (d === 0) { zac = k + 1; break; } d -= 1; }
  }
  d = 0;
  let kon = t.length;
  for (let k = i; k < t.length; k += 1) {
    const c = t[k];
    if (c === "(") d += 1;
    else if (c === ")") { if (d === 0) { kon = k; break; } d -= 1; }
  }
  return [zac, kon];
}

/** Proměnné přiřazené z `now()` — i tranzitivně (`v_to := v_now`). */
export function aliasyNow(tBezRetezcu: string): Set<string> {
  const aliasy = new Set<string>();
  // Deklarace s typem (`v_now timestamptz := now()` / `DEFAULT now()`) a prosté přiřazení
  // (`v_to := v_now;`). Jméno musí stát PŘÍMO před typem / `:=` — jinak by se za alias
  // vydalo klíčové slovo (`then v_x := now()` → „then") a brána by padala na CASE.
  const deklarace = [...tBezRetezcu.matchAll(
    /\b([a-z_][a-z0-9_]*)\s+(?:timestamptz|timestamp(?:\s+with(?:out)?\s+time\s+zone)?|date)\s*(?:not\s+null\s*)?(?::=|\bdefault\b)\s*([^;]+);/gi)]
    .map((m) => ({ jmeno: m[1]!.toLowerCase(), vyraz: m[2]!.trim() }));
  const prosta = [...tBezRetezcu.matchAll(/\b([a-z_][a-z0-9_]*)\s*:=\s*([^;]+);/gi)]
    .map((m) => ({ jmeno: m[1]!.toLowerCase(), vyraz: m[2]!.trim() }));
  const prirazeni = [...deklarace, ...prosta];
  let zmena = true;
  while (zmena) {
    zmena = false;
    for (const p of prirazeni) {
      if (aliasy.has(p.jmeno)) continue;
      const jeNow = NOW_FN.test(p.vyraz) && /^\(?\s*(now\s*\(\s*\)|current_timestamp|localtimestamp|clock_timestamp\s*\(\s*\)|statement_timestamp\s*\(\s*\)|transaction_timestamp\s*\(\s*\))\s*\)?(\s*(at time zone\s*'[^']*'|::\s*timestamptz))?$/i.test(p.vyraz);
      const jeAlias = /^[a-z_][a-z0-9_]*$/i.test(p.vyraz) && aliasy.has(p.vyraz.toLowerCase());
      if (jeNow || jeAlias) { aliasy.add(p.jmeno); zmena = true; }
    }
  }
  return aliasy;
}

function pouzivaNow(vyraz: string, aliasy: Set<string>): boolean {
  if (NOW_FN.test(vyraz)) return true;
  for (const a of aliasy) if (new RegExp(`\\b${a}\\b`, "i").test(vyraz)) return true;
  return false;
}

/** `now()` smí být JEN poslední argument coalesce; nikde jinde ve výrazu. */
function jeZaloha(vyraz: string, aliasy: Set<string>): boolean {
  const m = /\bcoalesce\s*\(/i.exec(vyraz);
  if (!m) return false;
  const otevrena = m.index + m[0].length;
  const args: string[] = [];
  let od = otevrena;
  for (;;) {
    const k = konecArgumentu(vyraz, od);
    args.push(vyraz.slice(od, k));
    if (k >= vyraz.length || vyraz[k] === ")") {
      const vne = vyraz.slice(0, m.index) + vyraz.slice(k + 1);
      if (pouzivaNow(vne, aliasy)) return false;
      break;
    }
    od = k + 1;
  }
  if (args.length < 2) return false;
  const posledni = args[args.length - 1]!;
  return pouzivaNow(posledni, aliasy) && args.slice(0, -1).every((a) => !pouzivaNow(a, aliasy));
}

export type Trida = "z_dat" | "zaloha" | "odmitnuti" | "hole_now";

/** Klasifikace všech `'freshness_at'` v textu funkce. */
export function klasifikuj(sql: string): Trida[] {
  const t = bezKomentaru(sql);
  const s = bezRetezcu(t);
  const aliasy = aliasyNow(s);
  const tridy: Trida[] = [];
  for (const m of t.matchAll(/'freshness_at'\s*,/gi)) {
    const od = m.index! + m[0].length;
    const vyraz = s.slice(od, konecArgumentu(s, od));
    if (!pouzivaNow(vyraz, aliasy)) { tridy.push("z_dat"); continue; }
    if (jeZaloha(vyraz, aliasy)) { tridy.push("zaloha"); continue; }
    const [zac, kon] = obalujiciVolani(s, m.index!);
    const obalka = t.slice(zac, kon);
    const trace = /'trace_id'\s*,\s*('(?:[^']|'')*')\s*(?=[,)]|$)/i.exec(obalka + ")");
    if (trace && DUVODY_ODMITNUTI.test(trace[1]!.slice(1, -1))) { tridy.push("odmitnuti"); continue; }
    tridy.push("hole_now");
  }
  return tridy;
}

function vadneFunkce(): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of readdirSync(FUNCTIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(FUNCTIONS_DIR, f), "utf8");
    if (!sql.includes("'freshness_at'")) continue;
    const vad = klasifikuj(sql).filter((x) => x === "hole_now").length;
    if (vad > 0) out.set(f.replace(/\.sql$/, ""), vad);
  }
  return out;
}

function rohatka(): Record<string, string> {
  if (!existsSync(BASELINE)) return {};
  const j = JSON.parse(readFileSync(BASELINE, "utf8")) as { funkce?: Record<string, string> };
  return j.funkce ?? {};
}

describe("čerstvost z dat — měřidlo umí říct ANO i NE (kontrolní vzorky)", () => {
  const obal = (hodnota: string, trace = "'x:' || v_k") =>
    `select jsonb_build_object('provenance', jsonb_build_object('source_slug','s','freshness_at', ${hodnota}, 'trace_id', ${trace}));`;

  it("holé now() v datové větvi = vada (i zabalené v to_char)", () => {
    expect(klasifikuj(obal("now()"))).toEqual(["hole_now"]);
    expect(klasifikuj(obal("to_char(now() at time zone 'UTC', 'YYYY')"))).toEqual(["hole_now"]);
    expect(klasifikuj(obal("current_timestamp"))).toEqual(["hole_now"]);
  });

  it("alias now() se pozná, i tranzitivně (v_to := v_now) a přes DEFAULT", () => {
    const sql = `declare v_now timestamptz := now(); v_to timestamptz; begin v_to := v_now; ${obal("to_char(v_to, 'YYYY')")} end;`;
    expect(klasifikuj(sql)).toEqual(["hole_now"]);
    expect(klasifikuj(`declare v_t timestamptz DEFAULT now(); begin ${obal("v_t")} end;`)).toEqual(["hole_now"]);
  });

  it("klíčové slovo před přiřazením se za alias nevydá (then v_x := now())", () => {
    const sql = `begin if a then v_x := now(); end if; ${obal("case when v_fresh is null then null else to_char(v_fresh,'Y') end")} end;`;
    expect(klasifikuj(sql)).toEqual(["z_dat"]);
  });

  it("čas z dat projde; coalesce(z_dat, now()) projde; coalesce(now(), x) ne", () => {
    expect(klasifikuj(obal("to_char(v_fresh, 'YYYY')"))).toEqual(["z_dat"]);
    expect(klasifikuj(obal("to_char(coalesce(v_fresh, now()) at time zone 'UTC', 'YYYY')"))).toEqual(["zaloha"]);
    expect(klasifikuj(obal("to_char(coalesce((select fresh from c), now()) at time zone 'UTC', 'YYYY')"))).toEqual(["zaloha"]);
    expect(klasifikuj(obal("coalesce(now(), v_fresh)"))).toEqual(["hole_now"]);
    expect(klasifikuj(obal("greatest(coalesce(v_fresh, now()), now())"))).toEqual(["hole_now"]);
  });

  it("odmítací větev s literálem …:<důvod> projde — před i za freshness_at; podmíněné :no_data ne", () => {
    expect(klasifikuj(obal("now()", "'k:unauthorized'"))).toEqual(["odmitnuti"]);
    expect(klasifikuj(`select jsonb_build_object('trace_id', 'k:missing_config', 'freshness_at', now());`)).toEqual(["odmitnuti"]);
    expect(klasifikuj(obal("now()", "'k:' || case when v_fresh is null then ':no_data' else '' end"))).toEqual(["hole_now"]);
    expect(klasifikuj(obal("now()", "'k:hotovo'"))).toEqual(["hole_now"]);
  });

  it("každé slovo SLOVNÍKU projde jako odmítnutí; zastaralé synonymum a slovo mimo slovník NE", () => {
    const vzorek = (duvod: string) => `select jsonb_build_object('trace_id', 'k:${duvod}', 'freshness_at', now());`;
    for (const d of Object.keys(SLOVNIK_DUVODU)) expect(klasifikuj(vzorek(d)), d).toEqual(["odmitnuti"]);
    for (const d of Object.keys(ZASTARALA_SYNONYMA)) expect(klasifikuj(vzorek(d)), d).toEqual(["hole_now"]);
    // Případ z 2026-10-04 (blok skupin sjednocení): vadný strop dávky hlášený slovem mimo slovník.
    expect(klasifikuj(vzorek("invalid_config"))).toEqual(["hole_now"]);
    // Důvod platí jen jako POSLEDNÍ úsek literálu.
    expect(klasifikuj(vzorek("missing_config:x"))).toEqual(["hole_now"]);
  });

  it("slovník a synonyma se nepřekrývají; každé synonymum míří na slovo slovníku", () => {
    const slova = new Set(Object.keys(SLOVNIK_DUVODU));
    expect(Object.keys(ZASTARALA_SYNONYMA).filter((s) => slova.has(s))).toEqual([]);
    expect(Object.entries(ZASTARALA_SYNONYMA).filter(([, cil]) => !slova.has(cil))).toEqual([]);
  });

  it("měřidla literálů: trace_id i důvod pomocníka se najdou, v komentáři ne", () => {
    expect(literalyTrace(`-- 'trace_id', 'x:komentar'\nselect jsonb_build_object('trace_id', 'k:missing_config');`))
      .toEqual(["k:missing_config"]);
    expect(duvodyPomocniku(`return public.audience_record_block_empty(v_view, 'not_found', v_now);`)).toEqual(["not_found"]);
    expect(duvodyPomocniku(`-- audience_record_block_empty(v_view, 'komentar', v_now)`)).toEqual([]);
    expect(berePuvodZParametru(`select jsonb_build_object('trace_id', 'r:' || coalesce(p_reason, 'x'), 'freshness_at', p_now);`)).toBe(true);
    expect(berePuvodZParametru(`select jsonb_build_object('trace_id', 'k:' || coalesce(p_params->>'metric', '?'), 'freshness_at', v_f);`)).toBe(false);
  });

  it("now() v komentáři ani v řetězci se nepočítá", () => {
    expect(klasifikuj(`-- 'freshness_at', now()\n${obal("to_char(v_fresh,'Y')")}`)).toEqual(["z_dat"]);
    expect(klasifikuj(obal("to_char(v_fresh, 'now()')"))).toEqual(["z_dat"]);
  });

  it("vzorové funkce #1052 (get_twin_metric_*) projdou bez jediné vady", () => {
    for (const f of ["get_twin_metric_kpi_block", "get_twin_metric_table_block", "get_twin_metric_chart_block"]) {
      const p = join(FUNCTIONS_DIR, `${f}.sql`);
      expect(existsSync(p), `${f} chybí — vzor zmizel, brána by neměla s čím srovnat`).toBe(true);
      const tridy = klasifikuj(readFileSync(p, "utf8"));
      expect(tridy.length, `${f}: měřidlo nenašlo žádné freshness_at`).toBeGreaterThan(0);
      expect(tridy.filter((x) => x === "hole_now"), f).toEqual([]);
    }
  });
});

describe("čerstvost z dat — slovník důvodů = praxe", () => {
  const funkce = readdirSync(FUNCTIONS_DIR).filter((x) => x.endsWith(".sql")).sort()
    .map((f) => ({ jmeno: f.replace(/\.sql$/, ""), sql: readFileSync(join(FUNCTIONS_DIR, f), "utf8") }));
  const posledniUsek = (trace: string) => trace.slice(trace.lastIndexOf(":") + 1);

  // KOTVY: měřidla musí najít známé výskyty, jinak by „nic nenalezeno“ znamenalo NEZMĚŘENO, ne zelenou.
  const kod = (jmeno: string) => funkce.find((f) => f.jmeno === jmeno)?.sql ?? "";
  it("kotva: měřidla čtou skutečné funkce (známé výskyty se najdou) — jinak NEZMĚŘENO", () => {
    const vse = funkce.flatMap(({ sql }) => literalyTrace(sql)).filter((t) => t.includes(":"));
    expect(vse.length, "NEZMĚŘENO: měřidlo nenašlo literály trace_id — čte špatný adresář nebo tvar").toBeGreaterThan(30);
    expect(literalyTrace(kod("get_twin_ref_group_block")), "NEZMĚŘENO: kotva skupin identit").toContain("twin-ref-group:unauthorized");
    expect(literalyTrace(kod("get_document_detail")), "NEZMĚŘENO: kotva detailu dokladu").toContain("doc-detail:not_found");
    expect(duvodyPomocniku(kod("get_audience_view_record_block")).sort(), "NEZMĚŘENO: kotva volajícího pomocníka")
      .toEqual(["missing_config", "no_record", "not_found", "unauthorized"]);
    expect(berePuvodZParametru(kod("audience_record_block_empty")), "NEZMĚŘENO: kotva pomocníka s původem z parametru").toBe(true);
  });

  it("dynamicky skládaný původ je JMENOVANÝ: kdo bere čas/důvod z parametru, je pomocník, jehož volající brána čte", () => {
    const pomocnici = funkce.filter(({ sql }) => berePuvodZParametru(sql)).map((f) => f.jmeno);
    expect(pomocnici.length, "NEZMĚŘENO: nenalezen ani známý pomocník").toBeGreaterThan(0);
    const necteni = pomocnici.filter((j) => !POMOCNIK_ODMITNUTI.test(j));
    expect(necteni, "funkce skládá čas/důvod z parametru, ale brána nečte její volající — přejmenuj na *_block_empty, nebo rozšiř duvodyPomocniku").toEqual([]);
  });

  it("žádné mrtvé slovo: každé slovo slovníku nějaká funkce opravdu vrací", () => {
    const pouzita = new Set<string>();
    for (const { sql } of funkce) {
      for (const t of literalyTrace(sql)) if (t.includes(":")) pouzita.add(posledniUsek(t));
      for (const d of duvodyPomocniku(sql)) pouzita.add(d);
    }
    expect(pouzita.size, "NEZMĚŘENO: měřidlo nenašlo žádný důvod").toBeGreaterThan(0);
    const mrtva = Object.keys(SLOVNIK_DUVODU).filter((d) => !pouzita.has(d));
    expect(mrtva, "slovo ze slovníku nevrací žádná funkce — smaž ho ze SLOVNIK_DUVODU (slovník = praxe, ne zásoba)").toEqual([]);
  });

  it("zastaralé synonymum není v žádném trace_id — ani mimo obálku s čerstvostí", () => {
    const nalezy: string[] = [];
    for (const { jmeno, sql } of funkce) {
      for (const t of literalyTrace(sql)) {
        const d = posledniUsek(t);
        if (t.includes(":") && d in ZASTARALA_SYNONYMA) nalezy.push(`${jmeno}: '${t}' → použij :${ZASTARALA_SYNONYMA[d]}`);
      }
    }
    expect(nalezy, "důvod odmítnutí je zastaralé synonymum — viz SLOVNIK_DUVODU").toEqual([]);
  });

  it("důvod předaný pomocníku odmítnutí (`*_block_empty(…, '<důvod>')`) je ze slovníku", () => {
    const nalezy: string[] = [];
    for (const { jmeno, sql } of funkce) {
      for (const d of duvodyPomocniku(sql)) if (!(d in SLOVNIK_DUVODU)) nalezy.push(`${jmeno}: '${d}'`);
    }
    expect(nalezy, "pomocník skládá trace_id sám, brána čerstvosti ho jinak nevidí — důvod musí být ze SLOVNIK_DUVODU").toEqual([]);
  });
});

describe("čerstvost z dat — rohatka", () => {
  const vadne = vadneFunkce();
  const dluh = rohatka();

  it("žádná funkce mimo rohatku nebere čerstvost z hodin serveru", () => {
    const nove = [...vadne.keys()].filter((f) => !(f in dluh));
    expect(nove, "holé now() v datové větvi 'freshness_at' — ber čas z dat (vzor get_twin_metric_*), prázdno → :no_data + coalesce(v_fresh, now())").toEqual([]);
  });

  it("rohatka jen klesá — opravená funkce se z ní musí vyškrtnout", () => {
    const opravene = Object.keys(dluh).filter((f) => !vadne.has(f));
    expect(opravene, "tyhle funkce už čerstvost z hodin nebere — smaž je z cerstvost-z-dat.baseline.json").toEqual([]);
  });
});
