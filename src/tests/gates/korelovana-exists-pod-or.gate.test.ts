/**
 * Korelovaná EXISTS pod OR v blokových funkcích (CLASS gate)
 *
 * ⛔ NAMĚŘENO na produkci, třikrát touž třídou vady:
 *   · 2026-09-29 get_timing_tower_block: `OR EXISTS` → odhad 7,4 mil. → JIT 1,3–1,5 s (IN: 0,2 s);
 *   · 2026-09-29 get_workflow_timeline_block: nárok po řádcích pod OR, člen 92–95 s;
 *   · 2026-09-30 get_twin_register: rameno `doc_field` (Hash Semi Join 33 180) × řádky twinů →
 *     odhad 132 676 935 → plný JIT (268 funkcí) u KAŽDÉHO registru: 1,9–2,1 s místo 0,11–0,24 s.
 *
 * Proč: korelovanou EXISTS (odkazuje na řádek vnějšího dotazu) pod OR nejde vytáhnout do
 * semi-joinu. Planner z ní udělá AlternativeSubPlan — řádkovou a hashovanou variantu — a
 * OCENÍ ji PRVNÍ, řádkovou („Arbitrarily use the first alternative plan for costing",
 * costsize.c), i když executor pak použije hashovanou. Odhad = počet řádků × cena poddotazu,
 * skutečnost = poddotaz jednou. JIT se rozhoduje podle odhadu (jit_above_cost 100 000), takže
 * dostane ŠPATNOU informaci. Vypnout JIT není oprava — oprava je dát mu správný odhad.
 *
 * Správně: nekorelovaný `x.id in (select … )` (hashovaný SubPlan, oceněný JEDNOU) nebo
 * množina předem (CTE / pole). Nekorelovaná EXISTS (`or exists (select 1 from user_roles
 * where user_id = auth.uid())`) je InitPlan — ta v pořádku je; stejně tak korelovaná EXISTS
 * pod AND (semi-join) a odkaz na proměnnou plpgsql (`r.id` ve smyčce = parametr, ne korelace).
 *
 * Rozsah: blokoví producenti — funkce skládající blokový tvar (`jsonb_build_object` s 'data'
 * a 'provenance'), stejné kritérium jako surface-block-contract. Známý dluh níž smí jen KLESAT.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FN_DIR = join(process.cwd(), "aisha/db/sql/functions");

/**
 * Známý dluh k 2026-09-30 (soubor → počet nálezů). Změřit odhad u každého a opravit v kole 14;
 * po opravě řádek SMAZAT (brána na to upozorní, běh neshodí).
 */
const ZNAMY_DLUH: Record<string, number> = {
  "get_document_digest.sql": 2,
  "get_ingest_recap.sql": 1,
  "get_obligation_queue.sql": 1,
  "get_receivables_overdue.sql": 1,
  "get_twin_metric_table_block.sql": 1,
};

const SCHEMATA = new Set([
  "public", "pg_catalog", "auth", "aisha_auth", "aisha_admin", "extensions", "vault", "storage",
  "pg_temp", "cron", "net", "information_schema", "new", "old", "excluded",
]);
const KLICOVA = new Set([
  "where", "on", "and", "or", "group", "order", "having", "limit", "join", "left", "right", "inner",
  "full", "cross", "lateral", "union", "select", "as", "natural", "using", "window", "offset", "fetch",
  "for", "returning", "set", "values", "outer", "with", "ordinality", "tablesample", "except", "intersect",
]);

/** Komentáře a řetězcové literály → mezery; délka a konce řádků zůstanou (čísla řádků sedí). */
export function bezKomentaruARetezcu(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const mezery = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    if (src.startsWith("--", i)) {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      out += mezery(src.slice(i, j));
      i = j;
    } else if (src.startsWith("/*", i)) {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      out += mezery(src.slice(i, j));
      i = j;
    } else if (src[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'" && src[j + 1] === "'") { j += 2; continue; }
        if (src[j] === "'") break;
        j++;
      }
      out += "'" + mezery(src.slice(i + 1, j)) + "'";
      i = j + 1;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

function parovaZavorka(s: string, i: number): number {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "(") d++;
    else if (s[j] === ")" && --d === 0) return j;
  }
  return s.length - 1;
}

/** Text jen na úrovni 0: obsah vnořených závorek nahradí mezerami. */
function uroven(s: string): string {
  let out = "";
  let d = 0;
  for (const ch of s) {
    if (ch === "(") { out += d === 0 ? ch : " "; d++; continue; }
    if (ch === ")") { d--; out += d === 0 ? ch : " "; continue; }
    out += d === 0 ? ch : " ";
  }
  return out;
}

/** Konec klauzule FROM: klíčové slovo na téže úrovni nebo nepárová zavírací závorka. */
function konecFrom(rest: string): number {
  let d = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === "(") d++;
    else if (ch === ")") { if (d === 0) return i; d--; }
    else if (ch === ";" && d === 0) return i;
    else if (d === 0 && (i === 0 || !/[\w]/.test(rest[i - 1]!)) &&
      /^(where|group|order|having|limit|window|union|except|intersect|returning|offset|fetch)\b/i.test(rest.slice(i, i + 12))) {
      return i;
    }
  }
  return rest.length;
}

/** Jména tabulek, funkcí a aliasů deklarovaná uvnitř poddotazu (FROM/JOIN na všech úrovních, CTE). */
function vnitrniJmena(sub: string): Set<string> {
  const jmena = new Set<string>();
  for (const m of sub.matchAll(/\bfrom\b/gi)) {
    const rest = sub.slice(m.index! + m[0].length);
    const oblast = rest.slice(0, konecFrom(rest));
    const lv = uroven(oblast);
    const rezy = [0, ...[...lv.matchAll(/,|\bjoin\b/gi)].map((x) => x.index! + x[0].length)];
    rezy.forEach((a, k) => {
      let polozka = uroven(oblast.slice(a, rezy[k + 1] ?? oblast.length));
      const podm = /\b(on|using|left|right|inner|full|cross|natural)\b/i.exec(polozka.slice(1));
      if (podm) polozka = polozka.slice(0, podm.index + 1);
      polozka = polozka.replace(/^\s*lateral\b/i, "");
      const mm = /^\s*([\w.]+)?\s*(\([^\n]*?\))?\s*(?:as\s+)?(\w+)?/i.exec(polozka);
      if (!mm) return;
      if (mm[1]) jmena.add(mm[1].split(".").pop()!.toLowerCase());
      if (mm[3] && !KLICOVA.has(mm[3].toLowerCase())) jmena.add(mm[3].toLowerCase());
    });
  }
  for (const m of sub.matchAll(/\b(\w+)\s+as\s+(?:not\s+)?(?:materialized\s+)?\(/gi)) jmena.add(m[1]!.toLowerCase());
  return jmena;
}

/** Proměnné plpgsql typu záznam (`for r in`, `r record`, `x tab%rowtype`) — odkaz na ně NENÍ korelace. */
function plpgsqlZaznamy(s: string): Set<string> {
  const v = new Set<string>();
  for (const m of s.matchAll(/\bfor\s+(\w+)\s+in\b/gi)) v.add(m[1]!.toLowerCase());
  for (const m of s.matchAll(/^\s*(\w+)\s+(?:record\b|[\w.]+%rowtype)/gim)) v.add(m[1]!.toLowerCase());
  return v;
}

/** Kvalifikátory `x.sloupec` v poddotazu, které poddotaz sám nedeklaruje = odkazy ven. */
function odkazyVen(sub: string, zaznamy: Set<string>): string[] {
  const uvnitr = vnitrniJmena(sub);
  const odkazy = new Set<string>();
  for (const m of sub.matchAll(/(?<![\w.$])([a-z_]\w*)\.(?:[a-z_]\w*|\*)/gi)) odkazy.add(m[1]!.toLowerCase());
  return [...odkazy].filter((o) => !uvnitr.has(o) && !SCHEMATA.has(o) && !zaznamy.has(o)).sort();
}

/** Klauzule (WHERE/ON/HAVING/WHEN …) obsahující pozici `rel` v textu úrovně `seg` — je v ní OR? */
function orVKlauzuli(seg: string, rel: number): boolean {
  const zac = [...seg.slice(0, rel).matchAll(/\b(where|on|having|when|select|then|else)\b|;/gi)]
    .map((x) => x.index! + x[0].length);
  const b = zac.length ? zac[zac.length - 1]! : 0;
  const e = /\b(group|order|having|limit|window|union|from|join|then|else|end|returning|loop)\b|;/i.exec(seg.slice(rel));
  const oblast = seg.slice(b, rel + (e ? e.index : seg.length - rel));
  return /\bor\b/i.test(oblast);
}

/** Leží EXISTS na pozici `pos` ve výrazu s OR (v téže booleovské klauzuli)? */
function podOr(s: string, pos: number): boolean {
  const zasobnik: number[] = [];
  for (let i = 0; i < pos; i++) {
    if (s[i] === "(") zasobnik.push(i);
    else if (s[i] === ")") zasobnik.pop();
  }
  for (let k = zasobnik.length - 1; k >= 0; k--) {
    const start = zasobnik[k]!;
    const konec = parovaZavorka(s, start);
    const seg = uroven(s.slice(start + 1, konec));
    const rel = pos - start - 1;
    if (/^\(\s*(select|with)\b/i.test(s.slice(start, start + 200))) return orVKlauzuli(seg, rel);
    if (/\bor\b/i.test(seg)) return true;
  }
  // příkaz na nejvyšší úrovni (plpgsql `return query select … where a or exists …`)
  return orVKlauzuli(uroven(s), pos);
}

export interface Nalez { radek: number; odkazy: string[] }

/** Korelované EXISTS / NOT EXISTS pod OR v jednom SQL souboru. */
export function korelovaneExistsPodOr(src: string): Nalez[] {
  const s = bezKomentaruARetezcu(src);
  const zaznamy = plpgsqlZaznamy(s);
  const out: Nalez[] = [];
  for (const m of s.matchAll(/\bexists\s*\(/gi)) {
    const otevreni = s.indexOf("(", m.index!);
    const sub = s.slice(otevreni + 1, parovaZavorka(s, otevreni));
    if (!podOr(s, m.index!)) continue;
    const odkazy = odkazyVen(sub, zaznamy);
    if (odkazy.length) out.push({ radek: s.slice(0, m.index!).split("\n").length, odkazy });
  }
  return out;
}

/** Blokoví producenti — stejné kritérium jako surface-block-contract (producentiZeZdroje). */
function producenti(): string[] {
  return readdirSync(FN_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const sql = bezKomentaruARetezcu(readFileSync(join(FN_DIR, f), "utf8"));
      const surove = readFileSync(join(FN_DIR, f), "utf8").replace(/--[^\n]*/g, "");
      return /jsonb_build_object/i.test(sql) && /'data'/.test(surove) && /'provenance'/.test(surove);
    })
    .sort();
}

describe("korelovaná EXISTS pod OR v blokových funkcích (gate)", () => {
  const soubory = producenti();

  test("brána vůbec něco čte (blokoví producenti ze SoT)", () => {
    expect(soubory.length).toBeGreaterThan(40);
  });

  test("žádný producent nemá korelovanou EXISTS pod OR nad rámec známého dluhu", () => {
    const nad: string[] = [];
    const opraveno: string[] = [];
    for (const f of soubory) {
      const nalezy = korelovaneExistsPodOr(readFileSync(join(FN_DIR, f), "utf8"));
      const dluh = ZNAMY_DLUH[f] ?? 0;
      if (nalezy.length > dluh) {
        nad.push(...nalezy.map((x) => `${f}:${x.radek} (odkaz ven: ${x.odkazy.join(", ")})`));
      } else if (nalezy.length < dluh) {
        opraveno.push(`${f}: ${dluh} → ${nalezy.length}`);
      }
    }
    if (opraveno.length) {
      console.warn(`[korelovaná EXISTS pod OR] dluh klesl — sniž ZNAMY_DLUH:\n  ${opraveno.join("\n  ")}`);
    }
    expect(
      nad,
      "korelovanou EXISTS pod OR planner ocení PO ŘÁDCÍCH (AlternativeSubPlan), i když ji spočítá " +
        "jednou → nafouknutý odhad → JIT. Přepiš na nekorelovaný `x.id in (select …)` nebo množinu " +
        "předem (CTE / pole):\n" + nad.join("\n"),
    ).toEqual([]);
  });

  test("známý dluh míří na existující soubory (seznam nezastará potichu)", () => {
    for (const f of Object.keys(ZNAMY_DLUH)) expect(soubory, f).toContain(f);
  });

  test("detektor chytí tvary z 2026-09-29/30 a nechá projít správné (mutace)", () => {
    const hlava = "create function f(p jsonb) returns jsonb language sql as $$\n";
    const pata = "\n$$;";
    const zle = [
      // get_twin_register has_param (2026-09-30)
      "select 1 from twin_entities t where t.status = 'active'\n and (p->>'x' is null or exists (select 1 from twin_events he where he.twin_id = t.id))",
      // rameno uvnitř AND pod OR (doc_field)
      "select 1 from twin_entities t, cfg where (cfg.firma is null or (cfg.via = 'doc_field' and exists (\n select 1 from latest lf, cfg where lf.twin_id = t.id)))",
      // NOT EXISTS s dvojitou negací (param_eq)
      "select 1 from twin_entities t where (jsonb_typeof(p->'e') is distinct from 'object' or not exists (\n select 1 from jsonb_each_text(p->'e') pe where not exists (select 1 from latest lq where lq.twin_id = t.id)))",
      // věž (2026-09-29), OR přímo na úrovni WHERE poddotazu
      "select jsonb_agg(x) from (\n        select b.id from production_batches b\n         where sc.is_admin or exists (select 1 from production_workflow_steps s where s.batch_id = b.id)) x",
      // plpgsql return query bez závorek
      "begin return query select t.id from twin_entities t where v_all or exists (select 1 from twin_events e where e.twin_id = t.id); end",
    ];
    const dobre = [
      // nekorelovaný IN (oprava)
      "select 1 from twin_entities t where (p->>'x' is null or t.id in (select he.twin_id from twin_events he where he.attrs->>'code' = p->>'x'))",
      // nekorelovaná EXISTS pod OR = InitPlan
      "select 1 from stories ps where ps.is_public or exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')",
      // korelovaná EXISTS pod AND = semi-join
      "select 1 from twin_entities t where t.status = 'active' and exists (select 1 from twin_events e where e.twin_id = t.id)",
      // OR v jiné klauzuli než EXISTS
      "select case when a.x or a.y then 1 end from a where exists (select 1 from b where b.a_id = a.id)",
      // záznam plpgsql ve smyčce = parametr, ne korelace
      "declare r record; begin for r in select * from x loop if r.a is null or exists (select 1 from y where y.id = r.id) then null; end if; end loop; end",
      // odkaz ve stringu / komentáři se nečte
      "select 1 from a where a.x or exists (select 1 from b where b.note = 'c.id') -- or exists (select 1 from z where z.id = a.id)",
    ];
    for (const z of zle) expect(korelovaneExistsPodOr(hlava + z + pata).length, z).toBeGreaterThan(0);
    for (const d of dobre) expect(korelovaneExistsPodOr(hlava + d + pata), d).toEqual([]);
  });
});
