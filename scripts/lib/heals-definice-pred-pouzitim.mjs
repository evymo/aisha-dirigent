/**
 * heals-definice-pred-pouzitim.mjs — objekt, který heals ZAKLÁDÁ, smí heals
 * použít až POTOM, co ho založil. Výjimkou je jen to, co měla už nejstarší
 * podporovaná databáze (dno).
 *
 * PROČ (naměřeno 2026-09-28): heals.sql zakládal `twin_relations` na ř. 9049,
 * ale `get_twin_detail` a `get_scope_options` (obě LANGUAGE sql) ji četly už na
 * ř. 8207 a 8710. Postgres tělo SQL funkce validuje při CREATE, takže na DB
 * z baseline před 2. 8. migrate spadl dřív, než k tabulce došel, a core
 * instance zůstalo dole. Čerstvá DB i průběžně migrovaná DB mají tabulku
 * z baseline už před heals — proto to nikdo neviděl a žádná brána to neměřila.
 * Pod dnem čeká táž třída dál (DB < 28. 7.: `list_surface_sections` volá
 * `surface_audience_allows` 180 řádků před jejím `\ir`; < 25. 7.:
 * `document_visible_to` a tabulky tc_* heals nezakládá vůbec).
 *
 * CO SE MĚŘÍ (jen to, co Postgres vyhodnotí HNED při provedení příkazu):
 *   - odkazy `public.x` ve všem mimo těla funkcí: policy, index, trigger,
 *     cizí klíč, view, GRANT/COMMENT/ALTER, DO blok (ten se vykoná hned);
 *   - tělo funkce `LANGUAGE sql` (validuje se při CREATE);
 * a CO NE:
 *   - tělo plpgsql funkce — při CREATE se kontroluje jen syntaxe, závislosti
 *     až za běhu; pořadí tam migrate neshodí;
 *   - `DROP … IF EXISTS` a `ALTER TABLE IF EXISTS` — chybějící objekt přeskočí;
 *   - komentáře a řetězcové literály (`to_regclass('public.x')` není odkaz).
 * Nekvalifikované odkazy (bez `public.`) měřidlo nevidí; heals je píše
 * kvalifikovaně a SECURITY DEFINER funkce mají search_path pevný.
 *
 * DNO: seznam objektů z baseline nejstarší podporované DB. Použití objektu,
 * který dno má, před jeho `\ir` je v pořádku (na staré DB už je, heals ho jen
 * srovnává). Dno je měřené, ne zvolené — viz heals-definice-pred-pouzitim.dno.json.
 */

/** @typedef {{ radek: number, soubor: string }} Pozice */
/** @typedef {{ pozice: Pozice, vnejsi: string, tela: string[] }} Prikaz */
/** @typedef {{ jmeno: string, druh: string, definovano: Pozice, pouzito: Pozice[] }} Poruseni */

/**
 * Rozbalí `\ir <cesta>` (psql include relativní k heals.sql) a u každého kusu
 * si pamatuje řádek heals.sql, ze kterého pochází.
 *
 * @param {string} heals obsah heals.sql
 * @param {(rel: string) => string | null} cti vrátí obsah souboru relativně k aisha/db, nebo null
 * @returns {{ radek: number, soubor: string, text: string }[]}
 */
export function rozbalHeals(heals, cti) {
  return heals.split("\n").map((line, i) => {
    const m = /^\s*\\ir\s+(\S+)\s*$/.exec(line);
    if (!m) return { radek: i + 1, soubor: "heals.sql", text: line + "\n" };
    // Zahrnutý soubor nemusí končit středníkem — příkaz za ním by se jinak slepil.
    return { radek: i + 1, soubor: m[1], text: (cti(m[1]) ?? "") + "\n;\n" };
  });
}

/**
 * Rozdělí SQL na příkazy. Komentáře zahodí, řetězcové literály nahradí `''`,
 * dollar-quoted těla vyjme stranou (v textu příkazu zůstane `$TELOn$`).
 * Pozice příkazu je místo jeho PRVNÍHO KÓDU — ne komentáře nad ním, jinak by
 * se porušení v `\ir` připsalo řádku s komentářem.
 *
 * @param {{ radek: number, soubor: string, text: string }[]} kusy
 * @returns {Prikaz[]}
 */
export function prikazy(kusy) {
  // ⛔ Kusy se čtou JAKO JEDEN TEXT: DO blok, `$$` tělo i víceřádkový literál
  // přímo v heals.sql přesahují přes řádky (= přes kusy). Tokenizér po kusech
  // tělo useknul na konci řádku a zbytek četl jako SQL — definice za blokem
  // pak „zmizela" (naměřeno 2026-09-28 na ensure_source_story). Pozice se
  // proto dohledává z posunu v textu, ne z kusu, ve kterém tokenizér zrovna je.
  let t = "";
  /** @type {number[]} */
  const zacatky = [];
  for (const k of kusy) {
    zacatky.push(t.length);
    t += k.text;
  }
  /** @param {number} off @returns {Pozice} */
  const pozice = (off) => {
    let lo = 0;
    let hi = zacatky.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (zacatky[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return { radek: kusy[lo].radek, soubor: kusy[lo].soubor };
  };
  /** @type {Prikaz[]} */
  const out = [];
  let buf = "";
  /** @type {string[]} */
  let tela = [];
  let start = -1;
  const n = t.length;
  let i = 0;
  while (i < n) {
    const c = t[i];
    if (c === "-" && t[i + 1] === "-") {
      const j = t.indexOf("\n", i);
      i = j < 0 ? n : j;
      continue;
    }
    if (c === "/" && t[i + 1] === "*") {
      const j = t.indexOf("*/", i + 2);
      i = j < 0 ? n : j + 2;
      continue;
    }
    if (start < 0 && !/\s/.test(c) && c !== ";") start = i;
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (t[j] === "'" && t[j + 1] === "'") { j += 2; continue; }
        if (t[j] === "'") break;
        j++;
      }
      buf += "''";
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(t.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        let j = t.indexOf(tag, i + tag.length);
        if (j < 0) j = n;
        tela.push(t.slice(i + tag.length, j));
        buf += ` $TELO${tela.length - 1}$ `;
        i = j + tag.length;
        continue;
      }
    }
    if (c === ";") {
      const s = buf.trim();
      if (s && start >= 0) out.push({ pozice: pozice(start), vnejsi: s, tela });
      buf = "";
      tela = [];
      start = -1;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return out;
}

// Jméno ve schématu public: `public.x`, `"public"."x"` i nekvalifikované `x`
// (baseline z července zakládá tabulky bez schématu). `auth.users` sem nepatří:
// jméno nesmí pokračovat tečkou.
const JM = String.raw`(?:"?public"?\s*\.\s*)?"?(\w+)\b"?(?!\s*\.)`;
const DEFINICE = [
  ["tabulka", new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?` + JM, "i")],
  ["funkce", new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+` + JM, "i")],
  ["pohled", new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?` + JM, "i")],
  ["typ", new RegExp(String.raw`^\s*create\s+type\s+` + JM, "i")],
  ["doména", new RegExp(String.raw`^\s*create\s+domain\s+` + JM, "i")],
  ["sekvence", new RegExp(String.raw`^\s*create\s+sequence\s+(?:if\s+not\s+exists\s+)?` + JM, "i")],
  ["index", new RegExp(String.raw`^\s*create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?` + JM, "i")],
];

/**
 * Co příkaz zakládá ve schématu public. DO blok se vykoná hned, takže co
 * založí jeho tělo (typicky výčtový typ s `EXCEPTION WHEN duplicate_object`),
 * je založené tímtéž příkazem.
 * @param {string} vnejsi
 * @param {string[]} [tela]
 * @returns {{ druh: string, jmeno: string }[]}
 */
export function definice(vnejsi, tela = []) {
  const out = [];
  for (const [druh, rx] of DEFINICE) {
    const m = /** @type {RegExp} */ (rx).exec(vnejsi);
    if (m) out.push({ druh: /** @type {string} */ (druh), jmeno: m[1].toLowerCase() });
  }
  if (/^\s*do\b/i.test(vnejsi)) {
    for (const telo of tela) {
      for (const q of prikazy([{ radek: 0, soubor: "", text: telo + "\n;" }])) {
        // Tělo DO bloku začíná `BEGIN`; příkaz za ním se bere od prvního CREATE.
        const i = q.vnejsi.search(/\bcreate\b/i);
        if (i >= 0) out.push(...definice(q.vnejsi.slice(i), q.tela));
      }
    }
  }
  return out;
}

/**
 * Objekty `public.x`, které Postgres při provedení příkazu HNED potřebuje.
 * @param {Prikaz} p
 * @returns {Set<string>}
 */
export function pouziti(p) {
  const low = p.vnejsi.toLowerCase();
  if (/^\s*(drop\s+\w+(\s+\w+)?\s+if\s+exists|alter\s+table\s+if\s+exists)\b/.test(low)) return new Set();
  const jeFunkce = /^\s*create\s+(or\s+replace\s+)?(function|procedure)\b/.test(low);
  const jazyk = /\blanguage\s+(\w+)/.exec(low)?.[1];
  let text = p.vnejsi;
  p.tela.forEach((telo, k) => {
    // Tělo, které se při CREATE nevaliduje (plpgsql a spol.), pořadí neshodí.
    if (jeFunkce && jazyk && jazyk !== "sql") return;
    const vnitrek = prikazy([{ radek: 0, soubor: "", text: telo + "\n;" }]).map((q) => q.vnejsi).join(" ");
    text = text.replace(`$TELO${k}$`, vnitrek);
  });
  const jmena = new Set([...text.matchAll(/\bpublic\.(\w+)/gi)].map((m) => m[1].toLowerCase()));
  // DO blok je plpgsql: příkaz ve větvi, která se neprovede, se nikdy neplánuje.
  // Jméno, jehož existenci blok sám ověřuje (`IF to_regclass('public.x') IS NULL
  // THEN RETURN`), proto na staré DB migrate neshodí — naměřeno na
  // migration_log_dump_jen_cteni.sql (tabulku zakládá až migrační běh).
  if (/^\s*do\b/.test(low)) {
    for (const telo of p.tela) {
      for (const m of telo.matchAll(STRAZ)) jmena.delete((m[1] ?? m[2]).toLowerCase());
    }
  }
  return jmena;
}

/** Ověření existence v těle DO bloku: to_reg*('public.x') nebo dotaz do katalogu. */
const STRAZ =
  /(?:to_reg(?:class|proc|procedure|type)\s*\(\s*'(?:"?public"?\.)?"?(\w+)|\b(?:relname|table_name|proname|typname)\s*=\s*'(\w+)')/gi;

/**
 * Jména objektů, které zakládá SQL (typicky baseline dna).
 * @param {string} sql
 * @returns {string[]}
 */
export function objektySql(sql) {
  const s = new Set();
  for (const p of prikazy([{ radek: 0, soubor: "", text: sql + "\n;" }])) {
    for (const d of definice(p.vnejsi, p.tela)) s.add(d.jmeno);
  }
  return [...s].sort();
}

/**
 * Porušení „definice před použitím" v heals.sql.
 * @param {string} heals obsah heals.sql
 * @param {(rel: string) => string | null} cti čtení souborů relativně k aisha/db
 * @param {Set<string>} dno objekty nejstarší podporované DB
 * @returns {Poruseni[]}
 */
export function poruseni(heals, cti, dno) {
  const P = prikazy(rozbalHeals(heals, cti));
  /** @type {Map<string, { idx: number, druh: string, pozice: Pozice }>} */
  const prvni = new Map();
  P.forEach((p, idx) => {
    for (const d of definice(p.vnejsi, p.tela)) {
      if (!prvni.has(d.jmeno)) prvni.set(d.jmeno, { idx, druh: d.druh, pozice: p.pozice });
    }
  });
  /** @type {Map<string, Poruseni>} */
  const out = new Map();
  P.forEach((p, idx) => {
    const vlastni = new Set(definice(p.vnejsi, p.tela).map((d) => d.jmeno));
    for (const jmeno of pouziti(p)) {
      if (dno.has(jmeno) || vlastni.has(jmeno)) continue;
      const d = prvni.get(jmeno);
      if (d && d.idx < idx) continue;
      // Použité a (zatím) nezaložené: buď heals zakládá POZDĚJI, nebo VŮBEC.
      const z = out.get(jmeno) ?? {
        jmeno,
        druh: d?.druh ?? "?",
        definovano: d?.pozice ?? { radek: 0, soubor: "heals.sql NEZAKLÁDÁ" },
        pouzito: [],
      };
      z.pouzito.push(p.pozice);
      out.set(jmeno, z);
    }
  });
  return [...out.values()].sort((a, b) => a.pouzito[0].radek - b.pouzito[0].radek);
}
