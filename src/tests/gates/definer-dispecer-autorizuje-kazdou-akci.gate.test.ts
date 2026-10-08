/**
 * Brána: SECURITY DEFINER dispečer (p_action) autorizuje KAŽDOU akci, ne jen některé.
 *
 * VZNIKLA Z NÁLEZU 2026-10-06 (main 0f992f647; ve GitHub stagingu opraveno už
 * 10-04, upstream to nedostal). `edge_bank_transactions` má GRANT pro authenticated
 * a `auth.uid()` v těle — jenže jen v JEDNÉ akci (get_order_bank_transfer).
 * Ostatní akce téže funkce se nikoho na nic neptaly: přihlášený si přímým
 * /rpc/edge_bank_transactions označil vlastní objednávku za zaplacenou, vložil
 * falešnou platbu a přečetl účty plátců. Totéž edge_subscriptions (aktivace bez
 * platby), edge_mobile_notifications (cizí push tokeny, phishing), edge_blockchain_audit
 * (podvržený auditní řetězec), edge_payment_sessions, edge_public_partners_directory.
 *
 * ⭐ PROČ TO DOSAVADNÍ BRÁNY NEVIDĚLY. `security.gate` (SEC_DEF_NO_AUTH) i
 * `check-definer-rpc-security` se ptají, jestli funkce obsahuje kontrolu VŮBEC —
 * jeden `auth.uid()` kdekoli v těle stačí. Dispečer je ale N funkcí v jednom
 * těle; nárok se musí ptát v každé akci. A seznam KNOWN_NO_AUTH_FUNCTIONS vedl
 * edge_* jako „volá je jen služba" — premisa, kterou GRANT pro authenticated
 * popíral (hlídka přežila svou premisu).
 *
 * CO MĚŘÍ (SoT aisha/db/sql/functions): každá funkce, která je SECURITY DEFINER,
 * má parametr `p_action` s větvemi `IF p_action = '…'` a je spustitelná klientem
 * (GRANT EXECUTE anon/authenticated/PUBLIC v SoT nebo heals, nebo chybí REVOKE
 * FROM PUBLIC), musí mít pro KAŽDOU akci jedno z:
 *   1. stráž PŘED dispečerem, která akci kryje — výchozí odmítnutí
 *      (`p_action IS DISTINCT FROM 'x' AND <nárok> IS NOT TRUE → RAISE`,
 *      `p_action NOT IN (…) AND …`), výčet (`p_action IN (…) AND … → RAISE`),
 *      nebo stráž bez p_action (`IF <nárok> … RAISE` před první akcí);
 *   2. nárok uvnitř své větve (is_service_role / is_admin_or_staff / has_role /
 *      auth.uid() jako VLASTNICTVÍ …) — „auth.uid() IS NULL" (jen přihlášení) se
 *      nepočítá: přihlášení není nárok;
 *   3. vědomé rozhodnutí „veřejná akce" v definer-dispecer-verejne-akce.json.
 *
 * MEZ: statika pozná, že se akce na nárok PTÁ, ne že se ptá SPRÁVNĚ. Chování
 * (anon / cizí přihlášený / vlastník / služba) měří runtime
 * src/tests/db/edge-dispecer-narok.runtime.test.ts. Nerozpoznaný tvar dispečera
 * (CASE p_action) brána odmítne hlasitě — nikdy tichá zelená.
 *
 * Spouští se přes: npm run test:gates -- definer-dispecer-autorizuje
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
const HEALS = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");
const VEREJNE_JSON = "src/tests/gates/definer-dispecer-verejne-akce.json";
const VEREJNE = (JSON.parse(readFileSync(join(ROOT, VEREJNE_JSON), "utf8")) as {
  funkce: Record<string, Record<string, string>>;
}).funkce;

/** Predikáty, které se ptají na ROLI / NÁROK volajícího (samy o sobě jsou otázka). */
const NAROK_FUNKCE =
  /is_service_role\s*\(|is_admin_or_staff\s*\(|is_user_admin\s*\(|has_role\s*\(|has_permission\s*\(|auth\.role\s*\(|get_jwt_role\s*\(|request\.jwt\.claim|can_access_story\s*\(|is_story_participant\s*\(|surface_audience_allows\s*\(/i;
/** Identita volajícího — nárok je teprve její POROVNÁNÍ (vlastnictví), ne zápis do auditu. */
const IDENTITA = /auth\.uid\s*\(\s*\)/i;

/** Odstraní SQL komentáře — prosa o pravidle nesmí pravidlo splnit. */
function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

interface Promenne {
  /** v_is_service := is_service_role() … — každý odkaz je otázka na roli */
  role: string[];
  /** v_uid := auth.uid() — nárok je až porovnání */
  identita: string[];
}

/** Lokální proměnné, do kterých se ukládá role nebo identita volajícího. */
function promenneNaroku(sql: string): Promenne {
  const prirazeni = [...sql.matchAll(/\b(v_[a-z0-9_]+)\s*:=\s*([^;]+);/gi)];
  return {
    role: prirazeni.filter((m) => NAROK_FUNKCE.test(m[2])).map((m) => m[1].toLowerCase()),
    identita: prirazeni.filter((m) => IDENTITA.test(m[2]) && !NAROK_FUNKCE.test(m[2])).map((m) => m[1].toLowerCase()),
  };
}

/**
 * Ptá se text na nárok? Predikát role ano; identita (auth.uid() / její proměnná)
 * jen v POROVNÁNÍ (=, <>, IS DISTINCT FROM). „X IS [NOT] NULL" je jen přihlášení
 * a `VALUES (auth.uid())` v auditu není otázka — ani jedno se nepočítá.
 */
function ptaSeNaNarok(text: string, p: Promenne): boolean {
  const id = [String.raw`auth\.uid\s*\(\s*\)`, ...p.identita.map((v) => String.raw`\b${v}\b`)].join("|");
  const bezPrihlaseni = text.replace(new RegExp(`(?:${id})\\s+IS\\s+(?:NOT\\s+)?NULL`, "gi"), " ");
  if (NAROK_FUNKCE.test(bezPrihlaseni)) return true;
  if (p.role.some((v) => new RegExp(`\\b${v}\\b`, "i").test(bezPrihlaseni))) return true;
  const op = String.raw`(?:(?<![:<>!])=|<>|!=|IS\s+(?:NOT\s+)?DISTINCT\s+FROM)`;
  return new RegExp(`(?:${id})\\s*${op}|${op}\\s*(?:${id})`, "i").test(bezPrihlaseni);
}

const seznam = (s: string): string[] => [...s.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]);

interface Dispecer {
  soubor: string;
  jmeno: string;
  akce: string[];
  bezNaroku: string[];
  tvar?: string;
}

function analyzuj(soubor: string): Dispecer | null {
  const sql = bezKomentaru(readFileSync(join(FUNCTIONS_DIR, soubor), "utf8"));
  if (!/security\s+definer/i.test(sql) || !/\bp_action\s+text\b/i.test(sql)) return null;
  const jmeno = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/i)?.[1] ?? soubor;

  // Spustitelná klientem? (grant v SoT/heals, nebo EXECUTE pro PUBLIC nikdo nevzal)
  const grantKlientovi = new RegExp(
    `GRANT\\s+(?:ALL|EXECUTE)[^;]*ON\\s+FUNCTION\\s+(?:public\\.)?${jmeno}\\b[^;]*\\bTO\\b[^;]*\\b(anon|authenticated|public)\\b`,
    "i",
  );
  const revokePublic = new RegExp(`REVOKE\\s+(?:ALL|EXECUTE)[^;]*ON\\s+FUNCTION\\s+(?:public\\.)?${jmeno}\\b[^;]*FROM\\s+PUBLIC`, "i");
  const vystavena =
    grantKlientovi.test(sql) || grantKlientovi.test(bezKomentaru(HEALS)) || !revokePublic.test(sql);
  if (!vystavena) return null;

  // Hlavy větví: `IF/ELSIF p_action = 'x' THEN` i `CASE p_action … WHEN 'x' THEN`.
  const hlavy: Array<{ index: number; delka: number; akce: string }> = [
    ...[...sql.matchAll(/\b(?:ELS)?IF\s+p_action\s*=\s*'([a-z0-9_]+)'\s+THEN/gi)].map((m) => ({
      index: m.index ?? 0,
      delka: m[0].length,
      akce: m[1],
    })),
  ];
  for (const c of sql.matchAll(/\bCASE\s+p_action\b([\s\S]*?)\bEND\s+CASE\b/gi)) {
    const zacatek = (c.index ?? 0) + (c[0].match(/^CASE\s+p_action\b/i)?.[0].length ?? 0);
    for (const w of c[1].matchAll(/\bWHEN\s+((?:'[a-z0-9_]+'\s*,?\s*)+)THEN/gi)) {
      for (const a of seznam(w[1])) hlavy.push({ index: zacatek + (w.index ?? 0), delka: w[0].length, akce: a });
    }
  }
  if (/\bCASE\s+p_action\b/i.test(sql) && !/\bEND\s+CASE\b/i.test(sql)) {
    return { soubor, jmeno, akce: [], bezNaroku: [], tvar: "CASE p_action bez END CASE — brána tvar nezná" };
  }
  hlavy.sort((a, b) => a.index - b.index);
  if (hlavy.length === 0) return null; // p_action je data (jméno auditní akce), ne dispečer

  const promenne = promenneNaroku(sql);
  const akce = [...new Set(hlavy.map((h) => h.akce))];
  const kryte = new Set<string>();

  // 1. Stráže s RAISE: IF/ELSIF <podmínka> THEN RAISE … (podmínka bez THEN a bez `;`,
  //    aby se regulár nepřelil přes několik příkazů a nepřipsal si cizí nárok).
  const pAction = String.raw`(?:COALESCE\s*\(\s*)?p_action(?:\s*,\s*''\s*\))?`;
  for (const m of sql.matchAll(/\b(?:ELS)?IF\s+((?:(?!\bTHEN\b)[^;])+?)\s+THEN\s+RAISE\s+EXCEPTION/gi)) {
    const podminka = m[1];
    if (!ptaSeNaNarok(podminka, promenne)) continue;
    const krome =
      podminka.match(new RegExp(`${pAction}\\s*(?:IS\\s+DISTINCT\\s+FROM|<>|!=)\\s*('[a-z0-9_]+')`, "i")) ??
      podminka.match(new RegExp(`${pAction}\\s*NOT\\s+IN\\s*\\(([^)]*)\\)`, "i"));
    const vycet =
      podminka.match(new RegExp(`${pAction}\\s+IN\\s*\\(([^)]*)\\)`, "i")) ??
      podminka.match(new RegExp(`${pAction}\\s*=\\s*('[a-z0-9_]+')`, "i"));
    if (krome) {
      const vyjimky = seznam(krome[1]);
      for (const a of akce) if (!vyjimky.includes(a)) kryte.add(a);
    } else if (vycet) {
      for (const a of seznam(vycet[1])) kryte.add(a);
    }
  }
  // 1b. Stráž bez p_action PŘED první akcí — i vnořená (IF auth.role() <> … THEN IF NOT
  //     has_role(…) THEN RAISE) nebo s měkkým odmítnutím (RETURN {"error": …}).
  const predDispecerem = sql.slice(0, hlavy[0].index);
  const podminkyPred = [...predDispecerem.matchAll(/\b(?:ELS)?IF\s+((?:(?!\bTHEN\b)[^;])+?)\s+THEN/gi)].map((m) => m[1]);
  if (
    /RAISE\s+EXCEPTION|\bRETURN\b/i.test(predDispecerem) &&
    podminkyPred.some((p) => !/p_action/i.test(p) && ptaSeNaNarok(p, promenne))
  ) {
    for (const a of akce) kryte.add(a);
  }

  // 2. Nárok uvnitř větve (od hlavy k další hlavě).
  hlavy.forEach((h, i) => {
    const konec = i + 1 < hlavy.length ? hlavy[i + 1].index : sql.length;
    const telo = sql.slice(h.index + h.delka, konec);
    if (ptaSeNaNarok(telo, promenne)) kryte.add(h.akce);
  });

  // 3. Vědomě veřejné akce.
  for (const a of Object.keys(VEREJNE[jmeno] ?? {})) kryte.add(a);

  return { soubor, jmeno, akce, bezNaroku: akce.filter((a) => !kryte.has(a)) };
}

const dispecery = readdirSync(FUNCTIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map(analyzuj)
  .filter((d): d is Dispecer => d !== null);

describe("SECURITY DEFINER dispečer (p_action) autorizuje každou akci", () => {
  test("měřidlo má co měřit (klientem spustitelné dispečery existují)", () => {
    // Na main 0f992f647 jich bylo 14 (edge_* + importy + rezervace). Pokles pod
    // tuhle mez znamená, že se změnil idiom nebo brána měří vedle.
    expect(dispecery.length, dispecery.map((d) => d.jmeno).join(", ")).toBeGreaterThan(8);
    expect(dispecery.map((d) => d.jmeno)).toEqual(expect.arrayContaining(["edge_bank_transactions", "edge_subscriptions"]));
  });

  test("žádná akce klientem spustitelného dispečera se nespoléhá na to, že ji nikdo nezavolá", () => {
    const vady = dispecery
      .filter((d) => d.tvar || d.bezNaroku.length > 0)
      .map((d) => (d.tvar ? `${d.jmeno}: ${d.tvar}` : `${d.jmeno}: ${d.bezNaroku.join(", ")}`));
    expect(
      vady,
      `SECURITY DEFINER vypíná RLS a funkce je spustitelná klientem — akce bez nároku je ` +
        `otevřená každému přihlášenému přímým /rpc/:\n  ${vady.join("\n  ")}\n\n` +
        `Vzor (výchozí odmítnutí před dispečerem, edge_mobile_notifications.sql):\n` +
        `  IF p_action IS DISTINCT FROM '<akce pro člena>' AND public.is_service_role() IS NOT TRUE THEN\n` +
        `    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';\n  END IF;\n` +
        `Akce, která je opravdu veřejná, patří vědomě do ${VEREJNE_JSON}.`,
    ).toEqual([]);
  });

  test("výčet veřejných akcí je živý: funkce i akce existují a jsou spustitelné klientem", () => {
    const vady: string[] = [];
    for (const [fn, akce] of Object.entries(VEREJNE)) {
      const d = dispecery.find((x) => x.jmeno === fn);
      if (!d) {
        vady.push(`${fn}: není klientem spustitelný dispečer — smaž položku`);
        continue;
      }
      for (const [a, duvod] of Object.entries(akce)) {
        if (!d.akce.includes(a)) vady.push(`${fn}.${a}: akce neexistuje — smaž položku`);
        if (duvod.length < 60) vady.push(`${fn}.${a}: důvod musí vysvětlit, proč je akce veřejná`);
      }
    }
    expect(vady).toEqual([]);
  });
});
