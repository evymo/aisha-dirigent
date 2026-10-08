/**
 * Čtení znalostí vydá jen položku v čitelném stavu — CHOVÁNÍ funkcí na skutečné databázi.
 *
 * ⛔ „Nezměřené není čisté.“ Čtení se bránilo výčtem ZAKÁZANÝCH stavů, a to jen někde:
 * nový stav, neznámá hodnota i NULL prošly jako čisté, a několik cest filtr nemělo vůbec.
 * Domovem pravidla je `public.knowledge_state_readable` (allowlist clear / reviewed /
 * reinstated); tady se měří, že ho každá čtecí cesta opravdu drží.
 *
 * Zásady (mutační kontrakt rady):
 *  - každý negativní případ má v TÉMŽE volání pozitivní kotvu — položka v čitelném stavu
 *    se vrátit musí; prázdný výsledek bez kotvy projde i nad rozbitou funkcí;
 *  - měří se i stav, který dnes do sloupce zapsat nejde (`unscanned`) a vymyšlená budoucí
 *    hodnota: test si CHECK sloupce uvolní uvnitř vlastní transakce, která se vrátí;
 *  - databáze je povinná: běží-li test pod wrapperem (AISHA_DB_URL) a DB není dosažitelná,
 *    je to chyba, ne přeskočení.
 *
 * Spouští se přes: npm run test:db:znalosti-cteni (throwaway DB z baseline + heals)
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    { input: sql, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

/** Stavy přípravku: které čtení vydat SMÍ a které ne (včetně hodnot mimo dnešní CHECK). */
const CITELNE = ["clear", "reviewed", "reinstated"] as const;
const NECITELNE = ["quarantined", "flagged", "unscanned", "zk_budouci_stav"] as const;
const STAVY = [...CITELNE, ...NECITELNE];

/** Uvolní CHECK stavu uvnitř transakce — jméno omezení se čte z katalogu, nehádá se. */
const UVOLNI_CHECK = `
DO $zk$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.knowledge_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%quarantine_status%' LOOP
    EXECUTE format('ALTER TABLE public.knowledge_items DROP CONSTRAINT %I', c);
  END LOOP;
END $zk$;`;

const VEKTOR = "array_fill(0.01::real, ARRAY[1024])::vector";
const VEKTOR_V2 = "array_fill(0.01::real, ARRAY[2560])::halfvec";
const jako = (sub: string) =>
  `SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true) \\gset zk_\nSET LOCAL ROLE authenticated;`;

/** Které stavy přípravku jsou ve výstupu (podle id položek). */
function vydaneStavy(vystup: string, ids: Record<string, string>): string[] {
  return STAVY.filter((s) => vystup.includes(ids[s]));
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("čtení znalostí vydá jen položku v čitelném stavu", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    }
  });

  describe("domov pravidla", () => {
    it("allowlist: čitelné stavy ano; karanténa, nezměřeno, neznámá hodnota i NULL ne", () => {
      const out = psql(
        `SELECT string_agg(s || '=' || coalesce(public.knowledge_state_readable(s)::text, 'null'), ',' ORDER BY s)
           FROM unnest(ARRAY[${STAVY.map((s) => `'${s}'`).join(", ")}, NULL]::text[]) AS s`,
      );
      expect(out).toBe("clear=true,flagged=false,quarantined=false,reinstated=true,reviewed=true,unscanned=false,zk_budouci_stav=false");
      expect(psql("SELECT public.knowledge_state_readable(NULL) IS NOT TRUE")).toBe("t");
    });

    it("sloupec stavu je NOT NULL — NULL se do něj nedostane", () => {
      expect(psql("SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.knowledge_items'::regclass AND attname = 'quarantine_status'")).toBe("t");
    });

    it("pomocník není volatelný rolemi API (není to RPC)", () => {
      expect(
        psql("SELECT has_function_privilege('anon', 'public.knowledge_state_readable(text)', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.knowledge_state_readable(text)', 'EXECUTE')"),
      ).toBe("false|false");
    });
  });

  describe("fn_search_personality_context (rysy osobnosti)", () => {
    const ids = Object.fromEntries(STAVY.map((s) => [s, randomUUID()])) as Record<string, string>;
    const kdo = randomUUID();
    const pripravek = `
${UVOLNI_CHECK}
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status) VALUES
${STAVY.map((s) => `  ('${ids[s]}', 'personality_trait', 'ZZ rys ${s}', 'tělo ${s}', 'active', '${s}')`).join(",\n")};
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  SELECT gen_random_uuid(), id, 0, 'úryvek' FROM public.knowledge_items WHERE id IN (${STAVY.map((s) => `'${ids[s]}'`).join(", ")});
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR} FROM public.knowledge_chunks kc WHERE kc.knowledge_item_id IN (${STAVY.map((s) => `'${ids[s]}'`).join(", ")});`;

    it("větev BEZ embeddingu: jen čitelné stavy (kotva: všechny tři čitelné se vrátí)", () => {
      const out = psql(`BEGIN;${pripravek}\n${jako(kdo)}\nSELECT public.fn_search_personality_context(NULL, NULL, 500)::text;\nROLLBACK;`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
    });

    it("větev S embeddingem: jen čitelné stavy (kotva: všechny tři čitelné se vrátí)", () => {
      const out = psql(`BEGIN;${pripravek}\n${jako(kdo)}\nSELECT public.fn_search_personality_context(NULL, ${VEKTOR}, 500)::text;\nROLLBACK;`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
    });
  });
  // ──────────────────────────────────────────────────────────────────────────
  // Druhý index (Ragnarok): nese jen to, co smí vrátit hledání — položku aktivní
  // A v čitelném stavu. Rozhoduje čistá funkce; spoušť ji jen volá.
  // ──────────────────────────────────────────────────────────────────────────
  describe("knowledge_ragnarok_action (co se má stát ve druhém indexu)", () => {
    const STATUSY = ["active", "draft", "archived"] as const;
    type Pripad = { op: string; os: string | null; ost: string | null; ns: string | null; nst: string | null; zmena: boolean };
    const smi = (s: string | null, st: string | null) => s === "active" && (CITELNE as readonly string[]).includes(st ?? "");
    /** Očekávání psané nezávisle na SQL: jeden predikát „smí“ a čtyři kvadranty přechodu. */
    function cekam(p: Pripad): string {
      if (p.op === "DELETE") return "deleted";
      if (p.op === "INSERT") return smi(p.ns, p.nst) ? "created" : "nic";
      const [a, b] = [smi(p.os, p.ost), smi(p.ns, p.nst)];
      if (a && b) return p.zmena ? "updated" : "nic";
      if (a) return p.ns === "archived" ? "archived" : "deleted";
      if (b) return "updated";
      return p.ns === "archived" && p.os !== "archived" ? "archived" : "nic";
    }
    const lit = (x: string | null) => (x === null ? "NULL::text" : `'${x}'::text`);
    function zmer(seznam: Pripad[]): string[] {
      return psql(
        `SELECT coalesce(public.knowledge_ragnarok_action(v.op, v.os, v.ost, v.ns, v.nst, v.zmena), 'nic')
           FROM (VALUES ${seznam.map((p, i) => `(${i}, ${lit(p.op)}, ${lit(p.os)}, ${lit(p.ost)}, ${lit(p.ns)}, ${lit(p.nst)}, ${p.zmena})`).join(", ")}) AS v(i, op, os, ost, ns, nst, zmena)
          ORDER BY v.i`,
      ).split("\n");
    }
    const popis = (p: Pripad) => `${p.op} ${p.os ?? "-"}/${p.ost ?? "-"} → ${p.ns ?? "-"}/${p.nst ?? "-"}${p.zmena ? " +obsah" : ""}`;

    it("tabulka VŠECH přechodů: 3 statusy × 7 stavů, INSERT, DELETE a UPDATE se změnou obsahu i bez", () => {
      const dvojice = STATUSY.flatMap((s) => STAVY.map((st) => ({ s: s as string, st: st as string })));
      const pripady: Pripad[] = [
        ...dvojice.map((n) => ({ op: "INSERT", os: null, ost: null, ns: n.s, nst: n.st, zmena: false })),
        ...dvojice.map((o) => ({ op: "DELETE", os: o.s, ost: o.st, ns: null, nst: null, zmena: false })),
        ...dvojice.flatMap((o) => dvojice.flatMap((n) => [false, true].map((zmena) => ({ op: "UPDATE", os: o.s, ost: o.st, ns: n.s, nst: n.st, zmena })))),
      ];
      expect(pripady).toHaveLength(21 + 21 + 21 * 21 * 2);
      const namereno = zmer(pripady);
      expect(namereno).toHaveLength(pripady.length);
      const rozdily = pripady.flatMap((p, i) => (namereno[i] === cekam(p) ? [] : [`${popis(p)}: čekám ${cekam(p)}, je ${namereno[i]}`]));
      expect(rozdily, "přechody, kde funkce rozhodla jinak než pravidlo „aktivní a čitelná“").toEqual([]);
      // Kotva očekávání: počty spočítané ručně z pravidla (3 kombinace smí, 18 nesmí) — kdyby
      // se očekávání i funkce pohnuly stejným směrem, tabulka výš by to nepoznala.
      const pocty: Record<string, number> = {};
      for (const a of namereno) pocty[a] = (pocty[a] ?? 0) + 1;
      expect(pocty).toEqual({ created: 3, deleted: 87, updated: 117, archived: 196, nic: 521 });
    });

    it("jmenované přechody s doslovným očekáváním (karanténa, nezměřeno, koncept, beze změny)", () => {
      const U = (os: string, ost: string, ns: string, nst: string | null, zmena = false): Pripad => ({ op: "UPDATE", os, ost, ns, nst, zmena });
      const I = (ns: string, nst: string): Pripad => ({ op: "INSERT", os: null, ost: null, ns, nst, zmena: false });
      const seznam: Array<[Pripad, string]> = [
        [U("active", "clear", "active", "quarantined"), "deleted"], // označená po nahrání se z indexu stáhne
        [U("active", "clear", "active", "flagged"), "deleted"],
        [U("active", "unscanned", "active", "clear"), "updated"], // po změření se nahraje
        [U("active", "quarantined", "active", "reinstated"), "updated"],
        [I("active", "unscanned"), "nic"], // vložení nenahraje, dokud položka není změřená
        [I("active", "clear"), "created"],
        [I("draft", "clear"), "nic"],
        [U("active", "clear", "active", "unscanned", true), "deleted"], // úprava obsahu → nezměřeno → starý text nesmí zůstat
        [U("active", "clear", "active", "zk_budouci_stav"), "deleted"], // neznámý stav není čitelný
        [U("active", "clear", "active", null), "deleted"], // ani chybějící
        [U("active", "clear", "active", "clear"), "nic"], // beze změny
        [U("active", "clear", "active", "clear", true), "updated"],
        [U("active", "quarantined", "active", "quarantined", true), "nic"], // v indexu není, není co měnit
        [U("draft", "clear", "draft", "clear", true), "nic"], // koncept se do indexu neposílá ani při úpravě
        [U("active", "clear", "draft", "clear"), "deleted"],
        [U("draft", "clear", "active", "clear"), "updated"],
        [U("active", "clear", "archived", "clear"), "archived"],
        [U("draft", "clear", "archived", "clear"), "archived"],
        [{ op: "DELETE", os: "draft", ost: "quarantined", ns: null, nst: null, zmena: false }, "deleted"],
        [{ op: "TRUNCATE", os: "active", ost: "clear", ns: "active", nst: "clear", zmena: true }, "nic"], // neznámá operace nic neposílá
      ];
      const namereno = zmer(seznam.map(([p]) => p));
      expect(seznam.map(([p], i) => `${popis(p)} = ${namereno[i]}`)).toEqual(seznam.map(([p, c]) => `${popis(p)} = ${c}`));
    });

    it("není volatelná rolemi API (není to RPC)", () => {
      const f = "public.knowledge_ragnarok_action(text, text, text, text, text, boolean)";
      expect(psql(`SELECT has_function_privilege('anon', '${f}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${f}', 'EXECUTE')`)).toBe("false|false");
    });
  });

  describe("spoušť nad knowledge_items → událost kb_ragnarok_sync", () => {
    it("scénář jedné položky: událost vznikne jen tehdy a taková, jak rozhodla funkce", () => {
      const id = randomUUID();
      const kotva = randomUUID();
      const vloz = (i: string, stav: string) =>
        `INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status) VALUES ('${i}', 'domain_doc', 'ZZ druhý index', 'tělo 0', 'active', '${stav}')`;
      const zmen = (set: string) => `UPDATE public.knowledge_items SET ${set} WHERE id = '${id}'`;
      // [co se děje, SQL, id položky, očekávaná událost „akce/operace“ nebo „nic“]
      const kroky: Array<[string, string, string, string]> = [
        ["kotva: vložení čisté položky", vloz(kotva, "clear"), kotva, "created/INSERT"],
        ["vložení nezměřené", vloz(id, "unscanned"), id, "nic"],
        ["nezměřeno → čistá (jen stav)", zmen("quarantine_status = 'clear'"), id, "updated/UPDATE"],
        ["změna těla", zmen("body_markdown = 'tělo 1'"), id, "updated/UPDATE"],
        ["změna jen počitadla", zmen("usage_count = usage_count + 1"), id, "nic"],
        ["čistá → karanténa (jen stav)", zmen("quarantine_status = 'quarantined'"), id, "deleted/UPDATE"],
        ["změna těla v karanténě", zmen("body_markdown = 'tělo 2'"), id, "nic"],
        ["karanténa → posouzeno", zmen("quarantine_status = 'reviewed'"), id, "updated/UPDATE"],
        ["úprava obsahu → nezměřeno", zmen("body_markdown = 'tělo 3', quarantine_status = 'unscanned'"), id, "deleted/UPDATE"],
        ["nezměřeno → čistá", zmen("quarantine_status = 'clear'"), id, "updated/UPDATE"],
        ["aktivní → koncept", zmen("status = 'draft'"), id, "deleted/UPDATE"],
        ["změna těla konceptu", zmen("body_markdown = 'tělo 4'"), id, "nic"],
        ["koncept → aktivní", zmen("status = 'active'"), id, "updated/UPDATE"],
        ["aktivní → archiv", zmen("status = 'archived'"), id, "archived/UPDATE"],
        ["smazání řádku", `DELETE FROM public.knowledge_items WHERE id = '${id}'`, id, "deleted/DELETE"],
      ];
      // Po každém kroku: které NOVÉ záznamy auditu spoušť zapsala (audit nese akci i operaci;
      // pg_notify se v transakci, která se vrátí, nedoručí).
      const zachyt = (n: number, i: string) => `
WITH nove AS (
  INSERT INTO zk_videno SELECT a.id FROM public.audit_journal a
   WHERE a.action = 'KB_RAGNAROK_SYNC_TRIGGER' AND a.metadata->>'entity_id' = '${i}'
     AND NOT EXISTS (SELECT 1 FROM zk_videno v WHERE v.id = a.id)
  RETURNING id)
SELECT 'k${n}=' || coalesce((SELECT string_agg((a.metadata->>'change_action') || '/' || coalesce(a.metadata->>'op', '?'), '+')
                              FROM public.audit_journal a WHERE a.id IN (SELECT id FROM nove)), 'nic');`;
      const out = psql(`BEGIN;${UVOLNI_CHECK}
CREATE TEMPORARY TABLE zk_videno (id uuid PRIMARY KEY) ON COMMIT DROP;
${kroky.map(([, sql, i], n) => `${sql};${zachyt(n, i)}`).join("\n")}
ROLLBACK;`);
      const radky = out.split("\n");
      const namereno = kroky.map((_, n) => radky.find((l) => l.startsWith(`k${n}=`))?.slice(`k${n}=`.length) ?? "(chybí)");
      expect(kroky.map(([co], n) => `${co}: ${namereno[n]}`)).toEqual(kroky.map(([co, , , cekam]) => `${co}: ${cekam}`));
    });
  });

  describe("fn_build_ragnarok_document (obsah pro druhý index)", () => {
    it("dokument jen pro aktivní položku v čitelném stavu; ostatním odpoví bez obsahu", () => {
      const ids = Object.fromEntries(STAVY.map((s) => [s, randomUUID()])) as Record<string, string>;
      const koncept = randomUUID();
      const neni = randomUUID();
      const out = psql(`BEGIN;${UVOLNI_CHECK}
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status) VALUES
${STAVY.map((s) => `  ('${ids[s]}', 'domain_doc', 'ZZ dokument ${s}', 'ZK-TELO-${s}', 'active', '${s}')`).join(",\n")},
  ('${koncept}', 'domain_doc', 'ZZ dokument koncept', 'ZK-TELO-koncept', 'draft', 'clear');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_
SET LOCAL ROLE service_role;
${STAVY.map((s) => `SELECT '${s}=' || public.fn_build_ragnarok_document('knowledge_items', '${ids[s]}')::text;`).join("\n")}
SELECT 'koncept=' || public.fn_build_ragnarok_document('knowledge_items', '${koncept}')::text;
SELECT 'neni=' || public.fn_build_ragnarok_document('knowledge_items', '${neni}')::text;
ROLLBACK;`);
      const odpoved = (k: string) => out.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? "(chybí)";
      // Pozitivní kotva: čitelné stavy obsah dostanou (jinak by „žádný obsah“ prošlo i nad rozbitou funkcí).
      expect(CITELNE.filter((s) => odpoved(s).includes(`ZK-TELO-${s}`) && odpoved(s).includes('"file_content"'))).toEqual([...CITELNE]);
      const bezObsahu = [...NECITELNE, "koncept"];
      expect(bezObsahu.filter((s) => odpoved(s).includes("ZK-TELO"))).toEqual([]);
      expect(bezObsahu.filter((s) => odpoved(s).includes("Item is not readable"))).toEqual(bezObsahu);
      expect(odpoved("neni")).toContain("Row not found");
    });

    it("smí ji volat jen service_role", () => {
      const f = "public.fn_build_ragnarok_document(text, uuid)";
      expect(
        psql(`SELECT has_function_privilege('anon', '${f}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${f}', 'EXECUTE') || '|' || has_function_privilege('service_role', '${f}', 'EXECUTE')`),
      ).toBe("false|false|true");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Citace běhu. Funkce do 2026-10-04 končila při KAŽDÉM volání chybou 42702:
  // sloupce bez aliasu tabulky kolidují s výstupními parametry RETURNS TABLE.
  // Text funkce tu vadu neukáže — projeví se až voláním.
  // ──────────────────────────────────────────────────────────────────────────
  describe("fn_get_run_citations (citace běhu)", () => {
    it("vydá citace běhu vlastníkovi příběhu; položku cizího příběhu ne", () => {
      const [kdo, cizi, pribeh, ciziPribeh, beh, polozka, ciziPolozka] = Array.from({ length: 7 }, () => randomUUID());
      const out = psql(`BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${kdo}', 'zzcit-${kdo}@test.local'), ('${cizi}', 'zzcit-${cizi}@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZ citace', '${kdo}'), ('${ciziPribeh}', 'ZZ citace cizí', '${cizi}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, story_id) VALUES
  ('${polozka}', 'domain_doc', 'ZZ citace položka', 'tělo', 'active', NULL),
  ('${ciziPolozka}', 'domain_doc', 'ZZ citace cizí položka', 'tělo', 'active', '${ciziPribeh}');
INSERT INTO public.knowledge_chunks (knowledge_item_id, chunk_index, chunk_text) VALUES ('${polozka}', 0, 'ZZ citace úryvek'), ('${ciziPolozka}', 0, 'ZZ cizí úryvek');
INSERT INTO public.ai_runs (id, kind, story_id) VALUES ('${beh}', 'chat', '${pribeh}');
INSERT INTO public.knowledge_attribution (story_id, knowledge_item_id, ai_run_id, relevance_score, attribution_weight) VALUES
  ('${pribeh}', '${polozka}', '${beh}', 0.5, 0.25), ('${pribeh}', '${ciziPolozka}', '${beh}', 0.9, 0.75);
${jako(kdo)}
SELECT 'radek=' || item_id || '|' || item_type || '|' || chunk_text || '|' || relevance_score || '|' || attribution_weight FROM public.fn_get_run_citations('${beh}'::uuid);
ROLLBACK;`);
      expect(out).toBe(`radek=${polozka}|domain_doc|ZZ citace úryvek|0.50|0.2500`);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Čtecí funkce: allowlist stavu místo výčtu zakázaných stavů. Výčet zakázaných
  // pouští položku nezměřenou i každý budoucí stav; sedm čtení stav nečetlo vůbec.
  // Každý test: sedm položek (jedna v každém stavu) → funkce vydá právě tři čitelné.
  // ──────────────────────────────────────────────────────────────────────────
  describe("čtecí funkce vydají jen položku v čitelném stavu", () => {
    const SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_\nSET LOCAL ROLE service_role;`;
    const idsStavu = () => Object.fromEntries(STAVY.map((s) => [s, randomUUID()])) as Record<string, string>;
    const seznam = (ids: Record<string, string>) => Object.values(ids).map((x) => `'${x}'`).join(", ");
    /** Sedm aktivních položek, jedna v každém stavu. `navic`: sloupec → SQL výraz (`$s` = stav). */
    const polozky = (ids: Record<string, string>, typ: string, navic: Record<string, string> = {}) => {
      const k = Object.keys(navic);
      const radek = (s: string) =>
        `  ('${ids[s]}', '${typ}', 'ZZALW ${s}', 'ZZALW tělo položky ve stavu ${s} — dost dlouhé, aby z něj šel udělat tréninkový pár.', 'active', '${s}'${k.map((x) => `, ${navic[x].split("$s").join(s)}`).join("")})`;
      return `INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status${k.map((x) => `, ${x}`).join("")}) VALUES\n${STAVY.map(radek).join(",\n")};`;
    };
    const uryvky = (ids: Record<string, string>, v2 = false) => `
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  SELECT gen_random_uuid(), id, 0, 'ZZALW úryvek' FROM public.knowledge_items WHERE id IN (${seznam(ids)});
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding${v2 ? ", embedding_v2" : ""})
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}${v2 ? `, ${VEKTOR_V2}` : ""} FROM public.knowledge_chunks kc WHERE kc.knowledge_item_id IN (${seznam(ids)});`;
    const uzivatelAPribeh = (uzivatel: string, pribeh: string, spravce = false) => `
INSERT INTO aisha_auth.users (id, email) VALUES ('${uzivatel}', 'zzalw-${uzivatel}@test.local');
${spravce ? `INSERT INTO public.user_roles (user_id, role) VALUES ('${uzivatel}', 'admin');` : ""}
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZALW příběh', '${uzivatel}');`;
    /** Položka CIZÍHO příběhu (jiný vlastník), aktivní a čistá — čtenář ji tazateli bez přístupu vydat nesmí. */
    const cizi = (typ: string, navic: Record<string, string> = {}) => {
      const [vlastnik, pribeh, id] = [randomUUID(), randomUUID(), randomUUID()];
      const k = Object.keys(navic);
      const sql = `${uzivatelAPribeh(vlastnik, pribeh)}
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, story_id${k.map((x) => `, ${x}`).join("")}) VALUES
  ('${id}', '${typ}', 'ZZALW cizí příběh', 'ZZALW tělo položky cizího příběhu — dost dlouhé, aby z něj šel udělat tréninkový pár.', 'active', '${pribeh}'${k.map((x) => `, ${navic[x].split("$s").join("cizi")}`).join("")});`;
      return { id, sql };
    };
    const tx = (sql: string) => psql(`BEGIN;${UVOLNI_CHECK}\n${sql}\nROLLBACK;`);

    it("pomocník se do dotazu vloží (žádné volání funkce na řádek)", () => {
      const plan = psql("EXPLAIN (COSTS OFF) SELECT 1 FROM public.knowledge_items ki WHERE public.knowledge_state_readable(ki.quarantine_status)");
      expect(plan).toContain("ANY");
      expect(plan).not.toContain("knowledge_state_readable");
    });

    it("mcp_search_knowledge_v2 má jedno přetížení: volání bez p_story_id projde pozičně i jmenně", () => {
      // Do 2026-10-04 žilo vedle sebe 9- a 11argumentové přetížení lišící se jen dvěma parametry s výchozí
      // hodnotou: každé volání bez p_story_id / p_audience_user_id skončilo „function … is not unique“
      // (změřeno na PG 18), tedy 9argumentové nešlo zavolat vůbec. Zůstalo jedno a obsluhuje všechny tvary.
      expect(psql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'mcp_search_knowledge_v2'")).toBe("1");
      const zkus = (volani: string) => {
        try {
          return psql(`SELECT jsonb_typeof(${volani})`);
        } catch (e) {
          return `chyba: ${String((e as { stderr?: string }).stderr ?? e).slice(0, 160)}`;
        }
      };
      expect(zkus("public.mcp_search_knowledge_v2(NULL::vector, 'x'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[], true, 5, 0.3::double precision)")).toBe("array");
      expect(zkus("public.mcp_search_knowledge_v2(p_query_text => 'x'::text)")).toBe("array");
      expect(zkus("public.mcp_search_knowledge_v2(p_query_text => 'x'::text, p_story_id => NULL::uuid)")).toBe("array");
    });

    it("mcp_search_knowledge_v2 bez příběhu a bez publika vydá jen globální položky čitelné pro roli", () => {
      const [bezny, jiny, spravce, pribehBezneho, pribehJineho] = Array.from({ length: 5 }, () => randomUUID());
      const hledej = (znacka: string, dalsi = "") =>
        `SELECT '${znacka}=' || coalesce((SELECT string_agg(regexp_replace(r->>'title', '^ZZ4C ', ''), ',' ORDER BY r->>'title') FROM jsonb_array_elements(public.mcp_search_knowledge_v2(p_query_text => 'ZZ4C', p_limit => 200${dalsi})) r), '');`;
      const out = psql(`BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${bezny}', 'zz4c-${bezny}@test.local'), ('${jiny}', 'zz4c-${jiny}@test.local'), ('${spravce}', 'zz4c-${spravce}@test.local');
INSERT INTO public.user_roles (user_id, role) VALUES ('${spravce}', 'admin');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribehBezneho}', 'ZZ4C příběh běžného', '${bezny}'), ('${pribehJineho}', 'ZZ4C příběh jiného', '${jiny}');
INSERT INTO public.knowledge_items (item_type, title, body_markdown, status, visibility, story_id, minimum_tier) VALUES
  ('domain_doc', 'ZZ4C glob-public', 't', 'active', 'public', NULL, NULL),
  ('domain_doc', 'ZZ4C glob-members', 't', 'active', 'members', NULL, NULL),
  ('domain_doc', 'ZZ4C glob-guild', 't', 'active', 'guild', NULL, NULL),
  ('domain_doc', 'ZZ4C glob-private', 't', 'active', 'private', NULL, NULL),
  ('domain_doc', 'ZZ4C glob-uroven', 't', 'active', 'public', NULL, 'partner'),
  ('core_value', 'ZZ4C glob-zasada-private', 't', 'active', 'private', NULL, NULL),
  ('domain_doc', 'ZZ4C pribeh-vlastni', 't', 'active', 'public', '${pribehBezneho}', NULL),
  ('domain_doc', 'ZZ4C pribeh-cizi', 't', 'active', 'public', '${pribehJineho}', NULL),
  ('core_value', 'ZZ4C pribeh-cizi-zasada', 't', 'active', 'public', '${pribehJineho}', NULL);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zk_
SET LOCAL ROLE anon;
${hledej("anon")}
SELECT 'anonPozicne=' || jsonb_array_length(public.mcp_search_knowledge_v2(NULL::vector, 'ZZ4C'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[], true, 200, 0.3::double precision));
RESET ROLE;
${jako(bezny)}
${hledej("prihlaseny")}
RESET ROLE;
${jako(spravce)}
${hledej("spravce")}
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_
SET LOCAL ROLE service_role;
${hledej("sluzba")}
${hledej("sluzbaPublikum", `, p_audience_user_id => '${bezny}'::uuid`)}
ROLLBACK;`);
      const vydane = (znacka: string) => (out.split("\n").find((l) => l.startsWith(`${znacka}=`)) ?? `${znacka}=(chybí)`).slice(znacka.length + 1);
      // Jen globální; žádná položka příběhu (vlastního ani cizího), žádná soukromá — ani soukromá ZÁSADA (výjimka
      // podle typu je pryč, 2026-10-05) —, žádná nad úroveň tazatele; `guild` jen gildě (nikdo z těchhle čtyř).
      // Bez identity (anonym, služba bez publika) jen `public`; s identitou navíc `members` (pravidlo majitele 2026-10-04).
      for (const kdo of ["anon", "sluzba"]) expect(`${kdo}: ${vydane(kdo)}`).toBe(`${kdo}: glob-public`);
      for (const kdo of ["prihlaseny", "sluzbaPublikum"]) expect(`${kdo}: ${vydane(kdo)}`).toBe(`${kdo}: glob-members,glob-public`);
      expect(vydane("anonPozicne"), "poziční volání 9 argumenty vrací totéž co jmenné").toBe("1");
      // Správa vidí i soukromé a položky s úrovní — ale bez příběhu pořád jen GLOBÁLNÍ.
      expect(vydane("spravce")).toBe("glob-guild,glob-members,glob-private,glob-public,glob-uroven,glob-zasada-private");
    });

    it("mcp_search_knowledge_v2 bez příběhu (p_story_id NULL)", () => {
      const ids = idsStavu();
      const c = cizi("domain_doc");
      const out = tx(`${polozky(ids, "domain_doc")}\n${c.sql}\n${jako(randomUUID())}
SELECT public.mcp_search_knowledge_v2(p_query_text => 'ZZALW', p_limit => 50, p_story_id => NULL::uuid)::text;`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(out).not.toContain(c.id);
    });

    it("mcp_search_knowledge_v2 s příběhem", () => {
      const ids = idsStavu();
      const [kdo, pribeh] = [randomUUID(), randomUUID()];
      const c = cizi("domain_doc");
      const out = tx(`${uzivatelAPribeh(kdo, pribeh)}\n${polozky(ids, "domain_doc", { story_id: `'${pribeh}'` })}\n${c.sql}\n${jako(kdo)}
SELECT public.mcp_search_knowledge_v2(p_query_text => 'ZZALW', p_limit => 50, p_story_id => '${pribeh}'::uuid)::text;`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(out).not.toContain(c.id);
    });

    it("mcp_search_knowledge_v3, embedding v1", () => {
      const ids = idsStavu();
      const c = cizi("domain_doc");
      const out = tx(`${polozky(ids, "domain_doc")}\n${c.sql}${uryvky({ ...ids, cizi: c.id })}\n${jako(randomUUID())}
SELECT knowledge_item_id::text FROM public.mcp_search_knowledge_v3(p_query_embedding_v1 => ${VEKTOR}, p_limit => 50, p_similarity_threshold => 0.0);`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(out).not.toContain(c.id);
    });

    it("mcp_search_knowledge_v3, embedding v2", () => {
      const ids = idsStavu();
      const c = cizi("domain_doc");
      const out = tx(`${polozky(ids, "domain_doc")}\n${c.sql}${uryvky({ ...ids, cizi: c.id }, true)}\n${jako(randomUUID())}
SELECT knowledge_item_id::text FROM public.mcp_search_knowledge_v3(p_query_embedding_v2 => ${VEKTOR_V2}, p_limit => 50, p_similarity_threshold => 0.0, p_model_pref => 'v2');`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(out).not.toContain(c.id);
    });

    it("fn_get_platform_warmup_state počítá jen čitelné položky výchozího příběhu", () => {
      const ids = idsStavu();
      const c = cizi("domain_doc"); // položka cizího příběhu se do počtu výchozího příběhu nepočítá
      const pocet = "(public.fn_get_platform_warmup_state()->>'default_story_kb_count')";
      const out = tx(`SELECT 'vychozi=' || coalesce((SELECT id::text FROM public.partner_stories WHERE is_stack_default = true LIMIT 1), 'neni');
${SLUZBA}
SELECT 'pred=' || ${pocet};
RESET ROLE;
${polozky(ids, "domain_doc", { story_id: "(SELECT id FROM public.partner_stories WHERE is_stack_default = true LIMIT 1)" })}
${c.sql}
SET LOCAL ROLE service_role;
SELECT 'po=' || ${pocet};`);
      const cti = (k: string) => out.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? "(chybí)";
      expect(cti("vychozi"), "kotva: výchozí příběh existuje, jinak funkce počítá nulu a test neměří nic").not.toBe("neni");
      expect(Number(cti("po")) - Number(cti("pred"))).toBe(CITELNE.length);
    });

    it("mcp_get_knowledge_item vydá položku podle id jen v čitelném stavu", () => {
      const ids = idsStavu();
      const c = cizi("domain_doc");
      const out = tx(`${polozky(ids, "domain_doc")}\n${c.sql}\n${jako(randomUUID())}
${STAVY.map((s) => `SELECT '${s}=' || coalesce(public.mcp_get_knowledge_item('${ids[s]}'::uuid, NULL::text)->>'id', 'nic');`).join("\n")}
SELECT 'cizi=' || coalesce(public.mcp_get_knowledge_item('${c.id}'::uuid, NULL::text)->>'id', 'nic');`);
      expect(STAVY.filter((s) => out.includes(`${s}=${ids[s]}`))).toEqual([...CITELNE]);
      expect(out).toContain("cizi=nic");
    });

    it("fn_get_psyche_traits vydá jen rysy v čitelném stavu", () => {
      const ids = idsStavu();
      const c = cizi("personality_trait", { source_slug: "'zzalw-rys-$s'" });
      const out = tx(`${polozky(ids, "personality_trait", { source_slug: "'zzalw-rys-$s'" })}\n${c.sql}\n${jako(randomUUID())}\nSELECT public.fn_get_psyche_traits()::text;`);
      expect(STAVY.filter((s) => out.includes(`"zzalw-rys-${s}"`))).toEqual([...CITELNE]);
      expect(out).not.toContain('"zzalw-rys-cizi"');
    });

    it("fn_get_tao_principles vydá jen zásady v čitelném stavu", () => {
      const ids = idsStavu();
      const c = cizi("core_value", { source_slug: "'zzalw-zasada-$s'" });
      const out = tx(`${polozky(ids, "core_value", { source_slug: "'zzalw-zasada-$s'" })}\n${c.sql}\n${jako(randomUUID())}\nSELECT public.fn_get_tao_principles()::text;`);
      expect(STAVY.filter((s) => out.includes(`"zzalw-zasada-${s}"`))).toEqual([...CITELNE]);
      expect(out).not.toContain('"zzalw-zasada-cizi"');
    });

    /** Běh s atribucí na každou ze sedmi položek; úryvek obsahu v atribuci nese jméno stavu. */
    const behSAtribuci = (ids: Record<string, string>, kdo: string, pribeh: string, beh: string, navicSql = "") => `${uzivatelAPribeh(kdo, pribeh)}
${polozky(ids, "domain_doc")}
${navicSql}${uryvky(ids)}
INSERT INTO public.ai_runs (id, kind, story_id) VALUES ('${beh}', 'chat', '${pribeh}');
INSERT INTO public.knowledge_attribution (story_id, knowledge_item_id, ai_run_id, context_used)
  SELECT '${pribeh}', id, '${beh}', 'ZZALW-KONTEXT-' || quarantine_status || '-' || id FROM public.knowledge_items WHERE id IN (${seznam(ids)});`;

    it("fn_get_run_citations cituje jen položky v čitelném stavu", () => {
      const ids = idsStavu();
      const [kdo, pribeh, beh] = [randomUUID(), randomUUID(), randomUUID()];
      const c = cizi("domain_doc");
      const out = tx(`${behSAtribuci({ ...ids, cizi: c.id }, kdo, pribeh, beh, c.sql)}\n${jako(kdo)}\nSELECT item_id::text FROM public.fn_get_run_citations('${beh}'::uuid);`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(out).not.toContain(c.id);
    });

    it("fn_get_run_extract_context nevydá atribuci ani úryvek položky v nečitelném stavu", () => {
      const ids = idsStavu();
      const [kdo, pribeh, beh] = [randomUUID(), randomUUID(), randomUUID()];
      const c = cizi("domain_doc");
      const out = tx(`${behSAtribuci({ ...ids, cizi: c.id }, kdo, pribeh, beh, c.sql)}\n${SLUZBA}\nSELECT public.fn_get_run_extract_context('${beh}'::uuid)::text;`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
      expect(STAVY.filter((s) => out.includes(`ZZALW-KONTEXT-${s}-${ids[s]}`))).toEqual([...CITELNE]);
      // Atribuce položky CIZÍHO příběhu (název ani úryvek) do vytěžení pro tenhle příběh nepatří.
      expect(out).not.toContain(c.id);
    });

    it("extract_training_pairs_from_kb udělá tréninkové páry jen z čitelných položek", () => {
      const ids = idsStavu();
      const [kdo, pribeh, sada] = [randomUUID(), randomUUID(), randomUUID()];
      const out = tx(`${uzivatelAPribeh(kdo, pribeh, true)}
INSERT INTO public.training_datasets (id, name, source_type) VALUES ('${sada}', 'ZZALW sada', 'kb_extraction');
${polozky(ids, "domain_doc", { is_verified: "true", ai_context_tags: "ARRAY['zzalw-trenink']" })}
${jako(kdo)}
SELECT 'vysledek=' || public.extract_training_pairs_from_kb('${sada}'::uuid, ARRAY['zzalw-trenink'], 500)::text;
RESET ROLE;
SELECT 'zdroj=' || source_id::text FROM public.training_examples WHERE dataset_id = '${sada}';`);
      expect(STAVY.filter((s) => out.includes(`zdroj=${ids[s]}`))).toEqual([...CITELNE]);
    });

    it("extract_training_pairs_from_kb bere i položky příběhů — OTEVŘENÉ ROZHODNUTÍ, dnešní chování", () => {
      // Funkci volá jen správa a ta čte položky VŠECH příběhů: ověřená položka cizího příběhu se stane
      // tréninkovým příkladem. Jestli to tak má být (obsah příběhu v tréninkové sadě = únik přes váhy
      // modelu), rozhoduje majitel. Test to NEDRŽÍ jako správný stav — drží, aby změna rozhodnutí byla vidět.
      const [kdo, pribeh, sada] = [randomUUID(), randomUUID(), randomUUID()];
      const c = cizi("domain_doc", { is_verified: "true", ai_context_tags: "ARRAY['zzalw-trenink-pribeh']" });
      const out = tx(`${uzivatelAPribeh(kdo, pribeh, true)}
INSERT INTO public.training_datasets (id, name, source_type) VALUES ('${sada}', 'ZZALW sada příběhů', 'kb_extraction');
${c.sql}
${jako(kdo)}
SELECT 'vysledek=' || public.extract_training_pairs_from_kb('${sada}'::uuid, ARRAY['zzalw-trenink-pribeh'], 500)::text;
RESET ROLE;
SELECT 'zdroj=' || source_id::text FROM public.training_examples WHERE dataset_id = '${sada}';`);
      expect(out).toContain(`zdroj=${c.id}`);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Funkce spouští, které zakládají položky znalostí, nemají být vydané nikomu:
  // napřímo je volat nejde a spoušť EXECUTE volajícího nekontroluje.
  // ──────────────────────────────────────────────────────────────────────────
  describe("funkce spouští znalostí nejsou vydané rolím API", () => {
    const FUNKCE = ["sync_expert_rule_to_knowledge_item", "sync_topic_version_to_knowledge_item"] as const;

    it.each(FUNKCE)("%s: žádná role API ji nesmí spustit a PUBLIC grant nemá", (f) => {
      const out = psql(`SELECT string_agg(r || '=' || has_function_privilege(r, 'public.${f}()', 'EXECUTE'), ',' ORDER BY r)
          || '|public=' || EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.${f}()'::regprocedure AND a.grantee = 0)
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r`);
      expect(out).toBe("anon=false,authenticated=false,service_role=false|public=false");
    });

    it("kotva: spoušť dál pracuje i pro roli, která funkci spustit nesmí (verze tématu založí položku)", () => {
      const tema = randomUUID();
      const out = psql(`BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_
SET LOCAL ROLE service_role;
INSERT INTO public.knowledge_topics (id, slug, title_key) VALUES ('${tema}', 'zzn4-${tema}', 'ZZN4 téma');
INSERT INTO public.knowledge_topic_versions (topic_id, version_no, body_markdown) VALUES ('${tema}', 1, 'ZZN4 tělo verze');
RESET ROLE;
SELECT count(*) || '|' || coalesce(max(body_markdown), '') FROM public.knowledge_items WHERE source_type = 'knowledge_topic' AND source_id = '${tema}';
ROLLBACK;`);
      expect(out).toBe("1|ZZN4 tělo verze");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Vrstva mozku (zásady a rysy osobnosti) je „vždy součástí“ jen jako GLOBÁLNÍ položka.
  // Změřeno 2026-10-04: výjimka podle typu neměla podmínku na příběh — zásada i rys
  // z CIZÍHO příběhu šly hledáním komukoli včetně anonyma a čtení osobnosti je dávalo
  // do každé odpovědi všem. Položka příběhu se řídí pravidlem příběhu jako každá jiná.
  // ──────────────────────────────────────────────────────────────────────────
  describe("zásady a rysy osobnosti jsou vrstvou mozku jen jako globální položky", () => {
    const KLICE = ["globZasada", "globRys", "aZasada", "aRys", "bZasada", "bRys"] as const;
    type Klic = (typeof KLICE)[number];
    const JEN_GLOBALNI: Klic[] = ["globZasada", "globRys"];
    const SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_\nSET LOCAL ROLE service_role;`;
    const ANONYM = `SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zk_\nSET LOCAL ROLE anon;`;

    /** Dva vlastníci a správce, příběhy A a B; zásada a rys: globální, v příběhu A, v příběhu B. Vše aktivní, čisté, s úryvkem v obou prostorech. */
    function mozek() {
      const u = { a: randomUUID(), b: randomUUID(), spravce: randomUUID(), nikdo: randomUUID() }; // „nikdo“ nemá příběh ani roli
      const p = { a: randomUUID(), b: randomUUID() };
      const ids = Object.fromEntries(KLICE.map((k) => [k, randomUUID()])) as Record<Klic, string>;
      const slug = (k: Klic) => `zzmozek-${k.toLowerCase()}-${ids[k].slice(0, 8)}`;
      const radek = (k: Klic, typ: string, pribeh: string | null) =>
        `  ('${ids[k]}', '${typ}', 'ZZMOZEK ${k}', 'tělo', 'active', '${slug(k)}', ${pribeh ? `'${pribeh}'` : "NULL"})`;
      const vsechny = KLICE.map((k) => `'${ids[k]}'`).join(", ");
      const sql = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${u.a}', 'zzmozek-${u.a}@test.local'), ('${u.b}', 'zzmozek-${u.b}@test.local'), ('${u.spravce}', 'zzmozek-${u.spravce}@test.local'), ('${u.nikdo}', 'zzmozek-${u.nikdo}@test.local');
INSERT INTO public.user_roles (user_id, role) VALUES ('${u.spravce}', 'admin');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${p.a}', 'ZZMOZEK A', '${u.a}'), ('${p.b}', 'ZZMOZEK B', '${u.b}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, source_slug, story_id) VALUES
${[radek("globZasada", "core_value", null), radek("globRys", "personality_trait", null), radek("aZasada", "core_value", p.a), radek("aRys", "personality_trait", p.a), radek("bZasada", "core_value", p.b), radek("bRys", "personality_trait", p.b)].join(",\n")};
INSERT INTO public.knowledge_chunks (knowledge_item_id, chunk_index, chunk_text) SELECT id, 0, 'ZZMOZEK úryvek' FROM public.knowledge_items WHERE id IN (${vsechny});
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, embedding_v2)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}, ${VEKTOR_V2} FROM public.knowledge_chunks kc WHERE kc.knowledge_item_id IN (${vsechny});`;
      return { u, p, ids, slug, sql };
    }
    type Mozek = ReturnType<typeof mozek>;
    const radekVystupu = (out: string, znacka: string) => out.split("\n").find((l) => l.startsWith(`${znacka}=`)) ?? `(řádek ${znacka} chybí)`;
    /** Které položky přípravku řádek výstupu nese — podle id nebo podle slugu (čtení osobnosti vracejí slug). */
    const nese = (m: Mozek, radek: string) => KLICE.filter((k) => radek.includes(m.ids[k]) || radek.includes(`"${m.slug(k)}"`));
    const v2 = (znacka: string, dalsi: string) => `SELECT '${znacka}=' || public.mcp_search_knowledge_v2(p_query_text => 'ZZMOZEK', p_limit => 100, ${dalsi})::text;`;

    it("v2: zásadu ani rys z CIZÍHO příběhu nedostane nikdo — anonym, přihlášený, služba s publikem i bez", () => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}
${ANONYM}
${v2("anon", "p_story_id => NULL::uuid")}
RESET ROLE;
${jako(m.u.a)}
${v2("prihlaseny", "p_story_id => NULL::uuid")}
RESET ROLE;
${SLUZBA}
${v2("sluzba", "p_story_id => NULL::uuid")}
${v2("sluzbaPublikum", `p_story_id => NULL::uuid, p_audience_user_id => '${m.u.a}'::uuid`)}
ROLLBACK;`);
      for (const kdo of ["anon", "prihlaseny", "sluzba", "sluzbaPublikum"]) {
        const vydane = nese(m, radekVystupu(out, kdo));
        expect(vydane.filter((k) => k.startsWith("b")), `${kdo}: položky cizího příběhu B`).toEqual([]);
        // Přípravek má výchozí viditelnost `public` — proto je dostane každý, i anonym (viditelnost z domova, ne výjimka typu).
        expect(vydane.filter((k) => k.startsWith("glob")), `${kdo}: kotva — globální veřejná zásada a rys`).toEqual(JEN_GLOBALNI);
      }
    });

    it("v2: dotaz bez příběhu nevydá položku žádného příběhu ani tomu, kdo k němu přístup má (filtr příběhu)", () => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}
${jako(m.u.a)}
${v2("vlastnik", "p_story_id => NULL::uuid")}
RESET ROLE;
${jako(m.u.spravce)}
${v2("spravce", "p_story_id => NULL::uuid")}
RESET ROLE;
${SLUZBA}
${v2("sluzbaPublikum", `p_story_id => NULL::uuid, p_audience_user_id => '${m.u.a}'::uuid`)}
ROLLBACK;`);
      for (const kdo of ["vlastnik", "spravce", "sluzbaPublikum"]) expect(nese(m, radekVystupu(out, kdo)), kdo).toEqual(JEN_GLOBALNI);
    });

    it("v2: služba, která se ptá na příběh B za publikum bez přístupu k B, jeho zásadu ani rys nedostane (predikát viditelnosti)", () => {
      // Publikum bez jakéhokoli příběhu: test tak měří jen predikát viditelnosti. S publikem, které má
      // vlastní příběh, by ho shodil i rozbitý filtr příběhu (položky jeho příběhu v dotazu na příběh B).
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}
${SLUZBA}
${v2("bezPristupu", `p_story_id => '${m.p.b}'::uuid, p_audience_user_id => '${m.u.nikdo}'::uuid`)}
${v2("sPristupem", `p_story_id => '${m.p.b}'::uuid, p_audience_user_id => '${m.u.b}'::uuid`)}
ROLLBACK;`);
      expect(nese(m, radekVystupu(out, "bezPristupu"))).toEqual(JEN_GLOBALNI);
      expect(nese(m, radekVystupu(out, "sPristupem"))).toEqual(["globZasada", "globRys", "bZasada", "bRys"]); // kotva: vlastníkovi B ano
    });

    it("v2: zásadu a rys příběhu dostane ten, kdo k němu má přístup a ptá se s p_story_id; bez přístupu dotaz odmítne", () => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}\n${jako(m.u.a)}\n${v2("svuj", `p_story_id => '${m.p.a}'::uuid`)}\nROLLBACK;`);
      expect(nese(m, radekVystupu(out, "svuj"))).toEqual(["globZasada", "globRys", "aZasada", "aRys"]);
      let chyba = "";
      try {
        psql(`BEGIN;${m.sql}\n${jako(m.u.a)}\n${v2("cizi", `p_story_id => '${m.p.b}'::uuid`)}\nROLLBACK;`);
      } catch (e) {
        chyba = String((e as { stderr?: string }).stderr ?? e);
      }
      expect(chyba).toContain("Access denied to story");
    });

    it.each([
      { vetev: "embedding v1", arg: `p_query_embedding_v1 => ${VEKTOR}` },
      { vetev: "embedding v2", arg: `p_query_embedding_v2 => ${VEKTOR_V2}, p_model_pref => 'v2'` },
    ])("v3 ($vetev): bez příběhu jen globální zásady a rysy; s příběhem navíc jen jeho vlastní", ({ arg }) => {
      const m = mozek();
      const v3 = (znacka: string, dalsi: string) =>
        `SELECT '${znacka}=' || coalesce(string_agg(knowledge_item_id::text, ','), '') FROM public.mcp_search_knowledge_v3(${arg}, p_limit => 100, p_similarity_threshold => 0.0${dalsi});`;
      const out = psql(`BEGIN;${m.sql}
${jako(m.u.a)}
${v3("prihlaseny", "")}
${v3("svujPribeh", `, p_story_id => '${m.p.a}'::uuid`)}
RESET ROLE;
${SLUZBA}
${v3("sluzba", "")}
${v3("sluzbaPublikum", `, p_audience_user_id => '${m.u.a}'::uuid`)}
ROLLBACK;`);
      for (const kdo of ["prihlaseny", "sluzba", "sluzbaPublikum"]) expect(nese(m, radekVystupu(out, kdo)), kdo).toEqual(JEN_GLOBALNI);
      expect(nese(m, radekVystupu(out, "svujPribeh"))).toEqual(["globZasada", "globRys", "aZasada", "aRys"]); // kotva
    });

    it("fn_get_psyche_traits vydá jen globální rysy — vlastní ani cizí příběh ne", () => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}\n${jako(m.u.a)}\nSELECT 'prihlaseny=' || public.fn_get_psyche_traits()::text;\nRESET ROLE;\n${SLUZBA}\nSELECT 'sluzba=' || public.fn_get_psyche_traits()::text;\nROLLBACK;`);
      for (const kdo of ["prihlaseny", "sluzba"]) expect(nese(m, radekVystupu(out, kdo)), kdo).toEqual(["globRys"]);
    });

    it("fn_get_tao_principles vydá jen globální zásady — vlastní ani cizí příběh ne", () => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}\n${jako(m.u.a)}\nSELECT 'prihlaseny=' || public.fn_get_tao_principles()::text;\nRESET ROLE;\n${SLUZBA}\nSELECT 'sluzba=' || public.fn_get_tao_principles()::text;\nROLLBACK;`);
      for (const kdo of ["prihlaseny", "sluzba"]) expect(nese(m, radekVystupu(out, kdo)), kdo).toEqual(["globZasada"]);
    });

    it.each([
      { vetev: "bez embeddingu", arg: "NULL, NULL, 500" },
      { vetev: "s embeddingem", arg: `NULL, ${VEKTOR}, 500` },
    ])("fn_search_personality_context ($vetev) vydá jen globální rysy", ({ arg }) => {
      const m = mozek();
      const out = psql(`BEGIN;${m.sql}\n${jako(m.u.a)}\nSELECT 'prihlaseny=' || public.fn_search_personality_context(${arg})::text;\nROLLBACK;`);
      expect(nese(m, radekVystupu(out, "prihlaseny"))).toEqual(["globRys"]);
    });

    it("compose_context od začátku do konce: kontext příběhu A nenese rys ani zásadu příběhu B; kontext bez příběhu nenese položku žádného příběhu", () => {
      const m = mozek();
      const profil = `zzmozek-${randomUUID()}`;
      const out = psql(`BEGIN;${m.sql}
INSERT INTO public.context_profiles (slug, display_name, layers, priority_order, token_budget)
  VALUES ('${profil}', 'ZZMOZEK profil', '{"kb_retrieval": {"enabled": true, "max_chunks": 50}}'::jsonb, ARRAY['governance_context', 'psyche_context', 'kb_retrieval'], 1000000);
${jako(m.u.a)}
SELECT 'pribehA=' || public.compose_context('${m.p.a}'::uuid, '${profil}', NULL::uuid, 'ZZMOZEK', NULL::text, NULL::uuid)::text;
SELECT 'bezPribehu=' || public.compose_context(NULL::uuid, '${profil}', NULL::uuid, 'ZZMOZEK', NULL::text, NULL::uuid)::text;
ROLLBACK;`);
      const a = radekVystupu(out, "pribehA");
      // Kotva: vrstvy mozku i hledání v kontextu opravdu jsou — jinak by „nenese“ prošlo nad prázdným kontextem.
      expect(a).toContain('"governance_context"');
      expect(a).toContain('"psyche_context"');
      expect(a).toContain('"kb_retrieval"');
      // Globální vždy; položky příběhu A přes hledání v příběhu A; z příběhu B nic.
      expect(nese(m, a)).toEqual(["globZasada", "globRys", "aZasada", "aRys"]);
      expect(nese(m, radekVystupu(out, "bezPribehu"))).toEqual(JEN_GLOBALNI);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // mcp_search_knowledge_v3: viditelnost globálních položek a parametry bez plniče.
  // Do 2026-10-04 v3 vydávalo globální položku s JAKOUKOLI viditelností, parametry
  // p_expertise_slug a p_include_ai_instructions přijímalo a ignorovalo a prázdný
  // seznam typů (to posílá volající přes MCP, když typy nezadá) odfiltroval vše.
  // Každé pravidlo se měří v OBOU větvích (embedding v1 i v2).
  // ──────────────────────────────────────────────────────────────────────────
  describe.each([
    { vetev: "embedding v1", arg: `p_query_embedding_v1 => ${VEKTOR}` },
    { vetev: "embedding v2", arg: `p_query_embedding_v2 => ${VEKTOR_V2}, p_model_pref => 'v2'` },
  ])("mcp_search_knowledge_v3 ($vetev): viditelnost a parametry", ({ arg }) => {
    type Polozka = { klic: string; typ?: string; viditelnost?: string; oblast?: string | null; uryvky?: Array<[string, string]> };
    /** Položky s úryvky a embeddingy v obou prostorech; vrací SQL a mapu klíč → id. */
    function pripravek(polozky: Polozka[]) {
      const ids = Object.fromEntries(polozky.map((p) => [p.klic, randomUUID()])) as Record<string, string>;
      const sql = `INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, visibility, expertise_area_id) VALUES
${polozky.map((p) => `  ('${ids[p.klic]}', '${p.typ ?? "domain_doc"}', 'ZZV3 ${p.klic}', 'tělo', 'active', '${p.viditelnost ?? "public"}', ${p.oblast ? `'${p.oblast}'` : "NULL"})`).join(",\n")};
INSERT INTO public.knowledge_chunks (knowledge_item_id, chunk_index, chunk_text, source_field) VALUES
${polozky.flatMap((p) => (p.uryvky ?? [[`uryvek-${p.klic}`, "body"]]).map(([text, pole], i) => `  ('${ids[p.klic]}', ${i}, '${text}', '${pole}')`)).join(",\n")};
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, embedding_v2)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}, ${VEKTOR_V2} FROM public.knowledge_chunks kc WHERE kc.knowledge_item_id IN (${polozky.map((p) => `'${ids[p.klic]}'`).join(", ")});`;
      return { ids, sql };
    }
    const hledej = (znacka: string, dalsi = "") =>
      `SELECT '${znacka}=' || knowledge_item_id::text || '|' || chunk_text FROM public.mcp_search_knowledge_v3(${arg}, p_limit => 50, p_similarity_threshold => 0.0${dalsi});`;
    /** Klíče položek (nebo texty úryvků), které hledání pod značkou vydalo — jen z přípravku testu. */
    const vydane = (out: string, znacka: string, ids: Record<string, string>) =>
      Object.keys(ids).filter((k) => out.split("\n").some((l) => l.startsWith(`${znacka}=${ids[k]}|`)));

    it("globální položku s viditelností mimo public/members/guild vydá jen správě", () => {
      const { ids, sql } = pripravek([
        { klic: "public" },
        { klic: "members", viditelnost: "members" },
        { klic: "guild", viditelnost: "guild" },
        { klic: "private", viditelnost: "private" },
      ]);
      const spravce = randomUUID();
      const out = psql(`BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${spravce}', 'zzv3-${spravce}@test.local');
INSERT INTO public.user_roles (user_id, role) VALUES ('${spravce}', 'admin');
${sql}
${jako(randomUUID())}
${hledej("bezny")}
RESET ROLE;
${jako(spravce)}
${hledej("spravce")}
ROLLBACK;`);
      expect(vydane(out, "bezny", ids)).toEqual(["public", "members"]); // `guild` jen gildě — běžný v ní není
      expect(vydane(out, "spravce", ids)).toEqual(["public", "members", "guild", "private"]);
    });

    it("p_expertise_slug vydá jen položky té oblasti", () => {
      const [x, y] = [randomUUID(), randomUUID()];
      const { ids, sql } = pripravek([{ klic: "oblastX", oblast: x }, { klic: "oblastY", oblast: y }, { klic: "bezOblasti" }]);
      const out = psql(`BEGIN;
INSERT INTO public.guild_expertise_areas (id, slug, name_key) VALUES ('${x}', 'zzv3-x-${x}', 'zzv3.x'), ('${y}', 'zzv3-y-${y}', 'zzv3.y');
${sql}
${jako(randomUUID())}
${hledej("oblast", `, p_expertise_slug => 'zzv3-x-${x}'`)}
${hledej("vse")}
ROLLBACK;`);
      expect(vydane(out, "oblast", ids)).toEqual(["oblastX"]);
      expect(vydane(out, "vse", ids)).toEqual(["oblastX", "oblastY", "bezOblasti"]); // kotva: bez parametru všechny tři
    });

    it("p_include_ai_instructions = false nevydá úryvky instrukcí", () => {
      const { ids, sql } = pripravek([{ klic: "polozka", uryvky: [["ZZV3-TELO", "body"], ["ZZV3-INSTRUKCE", "ai_instructions"]] }]);
      const out = psql(`BEGIN;\n${sql}\n${jako(randomUUID())}\n${hledej("bez", ", p_include_ai_instructions => false")}\n${hledej("s", ", p_include_ai_instructions => true")}\nROLLBACK;`);
      const texty = (znacka: string) => out.split("\n").filter((l) => l.startsWith(`${znacka}=${ids.polozka}|`)).map((l) => l.split("|")[1]).sort();
      expect(texty("bez")).toEqual(["ZZV3-TELO"]);
      expect(texty("s")).toEqual(["ZZV3-INSTRUKCE", "ZZV3-TELO"]); // kotva: s instrukcemi oba úryvky
    });

    it("prázdný seznam typů neznamená „žádný typ“; neprázdný filtruje", () => {
      const { ids, sql } = pripravek([{ klic: "dokument" }, { klic: "inzenyrsky", typ: "engineering_doc" }]);
      const out = psql(`BEGIN;\n${sql}\n${jako(randomUUID())}
${hledej("prazdny", ", p_item_types => '{}'::text[]")}
${hledej("bez")}
${hledej("jeden", ", p_item_types => ARRAY['domain_doc']")}
ROLLBACK;`);
      expect(vydane(out, "prazdny", ids)).toEqual(["dokument", "inzenyrsky"]);
      expect(vydane(out, "bez", ids)).toEqual(["dokument", "inzenyrsky"]);
      expect(vydane(out, "jeden", ids)).toEqual(["dokument"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Viditelnost v hledání má jeden domov; `guild` vydá hledání jen gildě (kdo má profil
  // partnera) a správě. Změřeno 2026-10-04: interní téma správy se do znalostí zapisuje
  // s viditelností `guild` a hledání ho dávalo komukoli — i anonymovi. Tabulka témat,
  // tabulka znalostí ani čtení podle id ho přitom nevydají.
  // ──────────────────────────────────────────────────────────────────────────
  describe("viditelnost `guild` vydá hledání jen gildě", () => {
    const SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_\nSET LOCAL ROLE service_role;`;
    const ANONYM = `SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zk_\nSET LOCAL ROLE anon;`;
    const KLICE = ["globPublic", "globMembers", "globGuild", "globPrivate", "temaInterni", "temaVerejne"] as const;
    type Klic = (typeof KLICE)[number];
    const BEZ_IDENTITY: Klic[] = ["globPublic", "temaVerejne"]; // anonym a služba bez publika: jen `public`
    const BEZ_GILDY: Klic[] = ["globPublic", "globMembers", "temaVerejne"];
    const GILDA: Klic[] = ["globPublic", "globMembers", "globGuild", "temaInterni", "temaVerejne"];

    /** Tři uživatelé (bez profilu partnera, partner, správce); čtyři globální položky a dvě TÉMATA — interní a veřejné — založená
     *  skutečnou spouští (interní se do znalostí zapíše jako `guild`). Vše s úryvkem v obou prostorech. */
    function pripravek() {
      const u = { bezProfilu: randomUUID(), partner: randomUUID(), spravce: randomUUID(), partnerProfil: randomUUID(), studie: randomUUID() };
      const ids = { globPublic: randomUUID(), globMembers: randomUUID(), globGuild: randomUUID(), globPrivate: randomUUID() };
      const temata = { temaInterni: randomUUID(), temaVerejne: randomUUID() };
      const sql = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${u.bezProfilu}', 'zzvid-${u.bezProfilu}@test.local'), ('${u.partner}', 'zzvid-${u.partner}@test.local'), ('${u.spravce}', 'zzvid-${u.spravce}@test.local');
INSERT INTO public.user_roles (user_id, role) VALUES ('${u.spravce}', 'admin');
-- Gilda (G1, rozhodnutí majitele 2026-10-05): schválený konzultant studie s certifikací od správy.
INSERT INTO public.partner_profiles (id, user_id, display_name, city, is_certified) VALUES ('${u.partnerProfil}', '${u.partner}', 'ZZVID partner', 'ZZVID', true);
INSERT INTO public.studies (id, code, name, study_type) VALUES ('${u.studie}', 'zzvid-${u.studie}', 'ZZVID studie', 'community');
INSERT INTO public.study_consultants (study_id, partner_id, status) VALUES ('${u.studie}', '${u.partnerProfil}', 'approved');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, visibility) VALUES
  ('${ids.globPublic}', 'domain_doc', 'ZZVID glob-public', 't', 'active', 'public'),
  ('${ids.globMembers}', 'domain_doc', 'ZZVID glob-members', 't', 'active', 'members'),
  ('${ids.globGuild}', 'domain_doc', 'ZZVID glob-guild', 't', 'active', 'guild'),
  ('${ids.globPrivate}', 'domain_doc', 'ZZVID glob-private', 't', 'active', 'private');
INSERT INTO public.knowledge_topics (id, slug, title_key, visibility) VALUES
  ('${temata.temaInterni}', 'zzvid-interni-${temata.temaInterni}', 'ZZVID téma interní', 'internal'),
  ('${temata.temaVerejne}', 'zzvid-verejne-${temata.temaVerejne}', 'ZZVID téma veřejné', 'public');
INSERT INTO public.knowledge_topic_versions (topic_id, version_no, body_markdown) VALUES ('${temata.temaInterni}', 1, 'ZZVID interní postup'), ('${temata.temaVerejne}', 1, 'ZZVID veřejný text');
INSERT INTO public.knowledge_chunks (knowledge_item_id, chunk_index, chunk_text) SELECT id, 0, 'ZZVID úryvek' FROM public.knowledge_items WHERE title LIKE 'ZZVID %';
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, embedding_v2)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}, ${VEKTOR_V2} FROM public.knowledge_chunks kc JOIN public.knowledge_items ki ON ki.id = kc.knowledge_item_id WHERE ki.title LIKE 'ZZVID %';
SELECT 'id:temaInterni=' || id || '|' || visibility FROM public.knowledge_items WHERE source_type = 'knowledge_topic' AND source_id = '${temata.temaInterni}';
SELECT 'id:temaVerejne=' || id || '|' || visibility FROM public.knowledge_items WHERE source_type = 'knowledge_topic' AND source_id = '${temata.temaVerejne}';`;
      return { u, ids, sql };
    }
    /** Z výstupu: id položek založených spouští (+ jejich viditelnost) a pro každou značku, které položky přípravku řádek nese. */
    function rozbor(out: string, ids: Record<string, string>) {
      const radky = out.split("\n");
      const tema = (k: string) => (radky.find((l) => l.startsWith(`id:${k}=`)) ?? "").slice(`id:${k}=`.length).split("|");
      const vsechna: Record<Klic, string> = { ...(ids as Record<Klic, string>), temaInterni: tema("temaInterni")[0], temaVerejne: tema("temaVerejne")[0] };
      const nese = (znacka: string) => {
        const r = radky.find((l) => l.startsWith(`${znacka}=`)) ?? `(řádek ${znacka} chybí)`;
        return KLICE.filter((k) => vsechna[k] !== "" && r.includes(vsechna[k]));
      };
      return { nese, viditelnostInterniho: tema("temaInterni")[1] };
    }

    it("pomocník viditelnosti: tabulka všech vstupů (viditelnost × je přihlášen × je v gildě)", () => {
      const out = psql(`SELECT coalesce(v, 'NULL') || '/' || coalesce(p::text, 'NULL') || '/' || coalesce(g::text, 'NULL') || '=' || public.knowledge_visibility_searchable(v, p, g)
        FROM unnest(ARRAY['public', 'members', 'guild', 'private', 'zk_neznama', NULL]::text[]) AS v, unnest(ARRAY[false, true, NULL]::boolean[]) AS p, unnest(ARRAY[false, true, NULL]::boolean[]) AS g`);
      // Očekávání psané nezávisle na SQL: public každému, members jen přihlášenému, guild jen gildě; NULL = ne.
      const B: Array<boolean | null> = [false, true, null];
      const ocekavane = (["public", "members", "guild", "private", "zk_neznama", null] as Array<string | null>).flatMap((v) =>
        B.flatMap((p) => B.map((g) => `${v ?? "NULL"}/${p ?? "NULL"}/${g ?? "NULL"}=${v === "public" || (v === "members" && p === true) || (v === "guild" && g === true)}`)),
      );
      expect(out.split("\n")).toHaveLength(54);
      expect(out.split("\n").sort()).toEqual(ocekavane.sort());
      // Domov rolím API vydaný NENÍ (vkládá se do dotazů definer funkcí); politiky volají pomocníka volajícího.
      const f = "public.knowledge_visibility_searchable(text, boolean, boolean)";
      expect(psql(`SELECT has_function_privilege('anon', '${f}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${f}', 'EXECUTE')`)).toBe("false|false");
      expect(psql(`SELECT provolatile::text || '|' || prosecdef::text FROM pg_proc WHERE oid = '${f}'::regprocedure`), "neměnná, ne definer").toBe("i|false");
      const h = "public.knowledge_visibilities_for_caller()";
      expect(psql(`SELECT has_function_privilege('anon', '${h}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${h}', 'EXECUTE')`), "množina štítků pro politiky je vydaná").toBe("true|true");
      const g = "public.knowledge_audience_in_guild(uuid)";
      expect(psql(`SELECT has_function_privilege('anon', '${g}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${g}', 'EXECUTE')`), "domov gildy rolím API nevydaný").toBe("false|false");
      expect(psql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'knowledge_visibility_searchable'"), "jedna signatura — žádný obal vedle").toBe("1");
    });

    it("pomocník viditelnosti se do dotazu vloží (žádné volání funkce na řádek)", () => {
      const plan = psql("EXPLAIN (COSTS OFF) SELECT 1 FROM public.knowledge_items ki WHERE public.knowledge_visibility_searchable(ki.visibility, false, false)");
      expect(plan).toContain("CASE");
      expect(plan).not.toContain("knowledge_visibility_searchable");
    });

    it("v2: `guild` (i interní téma zapsané spouští) dostane jen gilda a správa", () => {
      const p = pripravek();
      const v2 = (znacka: string, dalsi = "") => `SELECT '${znacka}=' || public.mcp_search_knowledge_v2(p_query_text => 'ZZVID', p_limit => 100${dalsi})::text;`;
      const out = psql(`BEGIN;${p.sql}
${ANONYM}
${v2("anon")}
RESET ROLE;
${jako(p.u.bezProfilu)}
${v2("bezProfilu")}
RESET ROLE;
${jako(p.u.partner)}
${v2("partner")}
RESET ROLE;
${jako(p.u.spravce)}
${v2("spravce")}
RESET ROLE;
${SLUZBA}
${v2("sluzba")}
${v2("sluzbaZaBezProfilu", `, p_audience_user_id => '${p.u.bezProfilu}'::uuid`)}
${v2("sluzbaZaPartnera", `, p_audience_user_id => '${p.u.partner}'::uuid`)}
ROLLBACK;`);
      const r = rozbor(out, p.ids);
      expect(r.viditelnostInterniho, "kotva: interní téma se spouští zapsalo jako guild").toBe("guild");
      for (const kdo of ["anon", "sluzba"]) expect(r.nese(kdo), kdo).toEqual(BEZ_IDENTITY);
      for (const kdo of ["bezProfilu", "sluzbaZaBezProfilu"]) expect(r.nese(kdo), kdo).toEqual(BEZ_GILDY);
      for (const kdo of ["partner", "sluzbaZaPartnera"]) expect(r.nese(kdo), kdo).toEqual(GILDA);
      expect(r.nese("spravce")).toEqual([...KLICE]);
    });

    it.each([
      ["embedding v1", `p_query_embedding_v1 => ${VEKTOR}`],
      ["embedding v2", `p_query_embedding_v2 => ${VEKTOR_V2}, p_model_pref => 'v2'`],
    ])("v3 (%s): `guild` (i interní téma zapsané spouští) dostane jen gilda a správa", (_vetev, arg) => {
      const p = pripravek();
      const v3 = (znacka: string, dalsi = "") =>
        `SELECT '${znacka}=' || coalesce(string_agg(knowledge_item_id::text, ','), '') FROM public.mcp_search_knowledge_v3(${arg}, p_limit => 100, p_similarity_threshold => 0.0${dalsi});`;
      const out = psql(`BEGIN;${p.sql}
${jako(p.u.bezProfilu)}
${v3("bezProfilu")}
RESET ROLE;
${jako(p.u.partner)}
${v3("partner")}
RESET ROLE;
${jako(p.u.spravce)}
${v3("spravce")}
RESET ROLE;
${SLUZBA}
${v3("sluzba")}
${v3("sluzbaZaPartnera", `, p_audience_user_id => '${p.u.partner}'::uuid`)}
ROLLBACK;`);
      const r = rozbor(out, p.ids);
      expect(r.nese("sluzba"), "sluzba").toEqual(BEZ_IDENTITY);
      expect(r.nese("bezProfilu"), "bezProfilu").toEqual(BEZ_GILDY);
      for (const kdo of ["partner", "sluzbaZaPartnera"]) expect(r.nese(kdo), kdo).toEqual(GILDA);
      expect(r.nese("spravce")).toEqual([...KLICE]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Graf běhu (co citované položky spojují). Do 2026-10-04 funkce spadla (42702) pokaždé,
  // když běh nějaké citace měl: závěrečný dotaz četl výstupní sloupce bez aliasu. Stejná
  // vada jako u citací běhu — a stejně ji text funkce neukáže, jen volání.
  // ──────────────────────────────────────────────────────────────────────────
  describe("fn_get_run_graph_context (graf běhu)", () => {
    it("vydá hrany grafu od citované položky vlastníkovi příběhu", () => {
      const [kdo, pribeh, beh, polozka, uryvek, uzel, cil] = Array.from({ length: 7 }, () => randomUUID());
      const out = psql(`BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${kdo}', 'zzgraf-${kdo}@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZ graf', '${kdo}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status) VALUES ('${polozka}', 'domain_doc', 'ZZ graf položka', 'tělo', 'active');
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text) VALUES ('${uryvek}', '${polozka}', 0, 'ZZ graf úryvek');
INSERT INTO public.graph_nodes (id, entity_type, entity_slug, entity_label, source_table, source_id) VALUES
  ('${uzel}', 'KnowledgeItem', 'zzgraf-${uzel}', 'ZZ graf položka', 'knowledge_items', '${polozka}'),
  ('${cil}', 'Concept', 'zzgraf-${cil}', 'ZZ graf pojem', NULL, NULL);
INSERT INTO public.graph_edges (source_node_id, target_node_id, relationship, confidence) VALUES ('${uzel}', '${cil}', 'REFERENCES', 0.9);
INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('${beh}', 'chat', '${pribeh}', ARRAY['${uryvek}']::uuid[]);
${jako(kdo)}
SELECT 'radek=' || seed_label || '|' || target_label || '|' || target_entity_type || '|' || depth || '|' || last_relationship || '|' || round(cumulative_confidence, 2)
  FROM public.fn_get_run_graph_context('${beh}'::uuid, NULL, NULL);
ROLLBACK;`);
      expect(out).toBe("radek=ZZ graf položka|ZZ graf pojem|Concept|1|REFERENCES|0.90");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fronty zpracování a graf běhu: stav položky nečetly vůbec. Obsah položky v karanténě tak dál
  // chodil modelu, který píše kontext úryvku, a poskytovateli vektorů; graf běhu z ní dělal
  // výchozí uzel. Fronta skenu (položky k rozdělení na úryvky) na jejich výstupu nezávisí — ta
  // nečitelnou položku vidět MUSÍ, jinak by ji nikdo nezměřil.
  // ──────────────────────────────────────────────────────────────────────────
  describe("fronty zpracování a graf běhu: jen položky v čitelném stavu", () => {
    const SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_\nSET LOCAL ROLE service_role;`;
    const IDENTITA = `gguf:${"c".repeat(64)}`;
    const idsStavu = () => Object.fromEntries(STAVY.map((s) => [s, randomUUID()])) as Record<string, string>;
    const seznam = (ids: Record<string, string>) => Object.values(ids).map((x) => `'${x}'`).join(", ");
    /** Sedm aktivních položek (jedna v každém stavu); každá má úryvek bez kontextu a vektor čekající na v2.
     *  Staré datum vzniku: fronta řazená od nejstarších položek je vydá mezi prvními. */
    const pripravek = (ids: Record<string, string>) => `
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status, created_at) VALUES
${STAVY.map((s) => `  ('${ids[s]}', 'domain_doc', 'ZZFR ${s}', 'ZZFR tělo ${s}', 'active', '${s}', '1971-01-01')`).join(",\n")};
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  SELECT gen_random_uuid(), id, 0, 'ZZFR úryvek' FROM public.knowledge_items WHERE id IN (${seznam(ids)});
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, v2_status)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}, 'pending' FROM public.knowledge_chunks kc WHERE kc.knowledge_item_id IN (${seznam(ids)});`;
    const tx = (sql: string) => psql(`BEGIN;${UVOLNI_CHECK}\n${sql}\nROLLBACK;`);
    const FRONTY: Array<[string, string]> = [
      ["kontext úryvku", "SELECT f.knowledge_item_id::text FROM public.fn_get_chunks_needing_context(100000, NULL) f"],
      ["přepočet vektoru v2", "SELECT f.knowledge_item_id::text FROM public.fn_get_embeddings_needing_v2(100000, NULL) f"],
      ["dopočet vektoru živé identity", `SELECT f.knowledge_item_id::text FROM public.fn_chunks_bez_zive_identity('zzfr-model', '${IDENTITA}', 512, 200) f`],
    ];

    it.each(FRONTY)("fronta „%s“ vydá jen úryvky položek v čitelném stavu", (_jmeno, dotaz) => {
      const ids = idsStavu();
      const out = tx(`${pripravek(ids)}\n${SLUZBA}\n${dotaz};`);
      expect(vydaneStavy(out, ids)).toEqual([...CITELNE]);
    });

    it("položku, kterou sken pustí, vydají všechny tři fronty hned při dalším volání", () => {
      const ids = idsStavu();
      const id = ids.flagged;
      const pocty = (znacka: string) => `SELECT '${znacka}=' || (SELECT count(*) FROM public.fn_get_chunks_needing_context(100000, '${id}'::uuid))
  || '|' || (SELECT count(*) FROM public.fn_get_embeddings_needing_v2(100000, '${id}'::uuid))
  || '|' || (SELECT count(*) FROM public.fn_chunks_bez_zive_identity('zzfr-model', '${IDENTITA}', 512, 200) f WHERE f.knowledge_item_id = '${id}'::uuid);`;
      const out = tx(`${pripravek(ids)}\n${SLUZBA}\n${pocty("pred")}
SELECT public.fn_record_safety_scan_audited('${id}'::uuid, '{}'::jsonb, NULL, 0, 'clear');
${pocty("po")}`);
      expect(out.split("\n").filter(Boolean)).toEqual(["pred=0|0|0", "po=1|1|1"]);
    });

    it("kotva: fronta skenu vydá položku v KAŽDÉM stavu, i tu bez úryvků — na výstupu front zpracování nezávisí", () => {
      const ids = idsStavu();
      const nova = randomUUID();
      const out = tx(`${pripravek(ids)}
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status) VALUES ('${nova}', 'domain_doc', 'ZZFR bez úryvků', 'ZZFR tělo', 'active', 'unscanned');
${SLUZBA}
SELECT 's-uryvky=' || g.id FROM unnest(ARRAY[${seznam(ids)}]::uuid[]) AS x(id) CROSS JOIN LATERAL public.get_knowledge_items_for_embedding(100, true, x.id) g;
SELECT 'bez-uryvku=' || g.id FROM public.get_knowledge_items_for_embedding(100, false, '${nova}'::uuid) g;`);
      expect(vydaneStavy(out, ids)).toEqual([...STAVY]);
      expect(out).toContain(`bez-uryvku=${nova}`);
    });

    /** Položka → úryvek (stejné id jako položka) → uzel grafu → hrana k vlastnímu pojmu. Štítek výchozího uzlu nese značku. */
    const sGrafem = (p: { id: string; znacka: string; stav?: string; status?: string; pribeh?: string }) => {
      const [uzel, cil] = [randomUUID(), randomUUID()];
      const pribeh = p.pribeh ? `'${p.pribeh}'` : "NULL";
      return `
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status, story_id) VALUES
  ('${p.id}', 'domain_doc', 'ZZFR ${p.znacka}', 'ZZFR tělo', '${p.status ?? "active"}', '${p.stav ?? "clear"}', ${pribeh});
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text) VALUES ('${p.id}', '${p.id}', 0, 'ZZFR úryvek');
INSERT INTO public.graph_nodes (id, entity_type, entity_slug, entity_label, source_table, source_id, story_id) VALUES
  ('${uzel}', 'KnowledgeItem', 'zzfr-${uzel}', 'UZEL-${p.znacka}', 'knowledge_items', '${p.id}', ${pribeh}),
  ('${cil}', 'Concept', 'zzfr-${cil}', 'POJEM-${p.znacka}', NULL, NULL, NULL);
INSERT INTO public.graph_edges (source_node_id, target_node_id, relationship, confidence) VALUES ('${uzel}', '${cil}', 'REFERENCES', 0.9);`;
    };
    const uzivatelAPribeh = (uzivatel: string, pribeh: string) => `
INSERT INTO aisha_auth.users (id, email) VALUES ('${uzivatel}', 'zzfr-${uzivatel}@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZFR příběh', '${uzivatel}');`;
    /** Běh v příběhu `pribeh`, který cituje úryvky všech `polozky`; graf čte vlastník příběhu. Vrací štítky výchozích uzlů. */
    const vychoziUzly = (pred: string, kdo: string, pribeh: string, polozky: string[]) => {
      const beh = randomUUID();
      const out = tx(`${pred}
INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('${beh}', 'chat', '${pribeh}', ARRAY[${polozky.map((x) => `'${x}'`).join(", ")}]::uuid[]);
${jako(kdo)}
SELECT 'seed=' || g.seed_label FROM public.fn_get_run_graph_context('${beh}'::uuid, NULL, NULL) g;`);
      return out.split("\n").filter((l) => l.startsWith("seed=")).map((l) => l.slice("seed=UZEL-".length)).sort();
    };

    it("graf běhu bere výchozí uzly jen od položek v čitelném stavu", () => {
      const ids = idsStavu();
      const [kdo, pribeh] = [randomUUID(), randomUUID()];
      const pred = uzivatelAPribeh(kdo, pribeh) + STAVY.map((s) => sGrafem({ id: ids[s], znacka: s, stav: s })).join("");
      expect(vychoziUzly(pred, kdo, pribeh, Object.values(ids))).toEqual([...CITELNE].sort());
    });

    it("graf běhu nebere výchozí uzel od archivované položky", () => {
      const [kdo, pribeh, ziva, archiv] = Array.from({ length: 4 }, () => randomUUID());
      const pred = uzivatelAPribeh(kdo, pribeh) + sGrafem({ id: ziva, znacka: "ziva" }) + sGrafem({ id: archiv, znacka: "archiv", status: "archived" });
      expect(vychoziUzly(pred, kdo, pribeh, [ziva, archiv])).toEqual(["ziva"]);
    });

    it("graf běhu nebere výchozí uzel od položky cizího příběhu; od globální a z příběhu běhu ano", () => {
      const [kdo, pribeh, jiny, ciziPribeh, glob, vlastni, cizi] = Array.from({ length: 7 }, () => randomUUID());
      const pred = uzivatelAPribeh(kdo, pribeh) + uzivatelAPribeh(jiny, ciziPribeh) + sGrafem({ id: glob, znacka: "globalni" })
        + sGrafem({ id: vlastni, znacka: "pribeh-behu", pribeh }) + sGrafem({ id: cizi, znacka: "cizi-pribeh", pribeh: ciziPribeh });
      expect(vychoziUzly(pred, kdo, pribeh, [glob, vlastni, cizi])).toEqual(["globalni", "pribeh-behu"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Statistiky znalostí jsou pohled správy na CELÝ korpus (i položky příběhů a položky
  // v karanténě; klíče items_by_category nesou názvy kategorií). Čtou je nástroje správy
  // a sonda pokrytí, obojí servisní rolí. Do 2026-10-04 je přes PostgREST spustil i nepřihlášený.
  // ──────────────────────────────────────────────────────────────────────────
  describe("statistiky znalostí: pohled správy, jen pro službu", () => {
    it("mcp_get_knowledge_stats: spustit ji smí jen service_role; PUBLIC grant nemá", () => {
      const out = psql(`SELECT string_agg(r || '=' || has_function_privilege(r, 'public.mcp_get_knowledge_stats()', 'EXECUTE'), ',' ORDER BY r)
          || '|public=' || EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.mcp_get_knowledge_stats()'::regprocedure AND a.grantee = 0)
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r`);
      expect(out).toBe("anon=false,authenticated=false,service_role=true|public=false");
    });

    it.each(["anon", "authenticated"])("přímé volání statistik rolí %s databáze odmítne (42501)", (role) => {
      const claims = role === "authenticated" ? `{"role":"authenticated","sub":"${randomUUID()}"}` : `{"role":"anon"}`;
      let chyba = "";
      try {
        psql(`BEGIN;
SELECT set_config('request.jwt.claims', '${claims}', true) \\gset zk_
SET LOCAL ROLE ${role};
SELECT public.mcp_get_knowledge_stats();
ROLLBACK;`);
      } catch (e) {
        chyba = String((e as { stderr?: string }).stderr ?? e);
      }
      expect(chyba).toContain("permission denied for function mcp_get_knowledge_stats");
    });

    it("kotva: služba dál dostane počty celého korpusu — i položku příběhu a položku v karanténě", () => {
      const [kdo, pribeh] = [randomUUID(), randomUUID()];
      const kat = `zzst-${randomUUID()}`;
      const out = psql(`BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${kdo}', 'zzst-${kdo}@test.local');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZST příběh', '${kdo}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, quarantine_status, story_id, category) VALUES
  (gen_random_uuid(), 'domain_doc', 'ZZST globální', 'tělo', 'active', 'clear', NULL, '${kat}'),
  (gen_random_uuid(), 'domain_doc', 'ZZST z příběhu', 'tělo', 'active', 'clear', '${pribeh}', '${kat}'),
  (gen_random_uuid(), 'domain_doc', 'ZZST v karanténě', 'tělo', 'active', 'quarantined', NULL, '${kat}');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_
SET LOCAL ROLE service_role;
SELECT 'pocet=' || (public.mcp_get_knowledge_stats()->'items_by_category'->>'${kat}');
ROLLBACK;`);
      expect(out).toBe("pocet=3");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Čtení podle id ví, PRO KOHO čte. Do 2026-10-04 funkce parametr publika neměla a četla
  // auth.uid(); nástroj MCP ji volá servisní rolí, takže každý uživatel MCP četl podle id jako
  // anonym — úroveň členství se neuznala a položku vlastního příběhu nedostal ani její vlastník.
  // ──────────────────────────────────────────────────────────────────────────
  describe("mcp_get_knowledge_item: čtení podle id ví, pro koho čte", () => {
    const SLUZBA = `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zk_\nSET LOCAL ROLE service_role;`;
    const ANONYM = `SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zk_\nSET LOCAL ROLE anon;`;

    /** Vlastník příběhu, účastník, přihlášený bez přístupu, partner (úroveň partner) a správce; čtyři položky. */
    function pripravek() {
      const u = { vlastnik: randomUUID(), ucastnik: randomUUID(), jiny: randomUUID(), partner: randomUUID(), spravce: randomUUID() };
      const pribeh = randomUUID();
      const ids = { globalni: randomUUID(), sRegistraci: randomUUID(), sPartnerem: randomUUID(), zPribehu: randomUUID() };
      const slug = `zzid-${ids.globalni}`;
      const sql = `
INSERT INTO aisha_auth.users (id, email) VALUES ${Object.values(u).map((x) => `('${x}', 'zzid-${x}@test.local')`).join(", ")};
INSERT INTO public.user_roles (user_id, role) VALUES ('${u.spravce}', 'admin');
INSERT INTO public.partner_profiles (user_id, display_name, city, is_visible, is_production_provider) VALUES ('${u.partner}', 'ZZID partner', 'ZZID', true, true);
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZZID příběh', '${u.vlastnik}');
INSERT INTO public.story_participants (story_id, user_id, role) VALUES ('${pribeh}', '${u.ucastnik}', 'partner');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, visibility, story_id, minimum_tier, source_slug) VALUES
  ('${ids.globalni}', 'domain_doc', 'ZZID globální', 't', 'active', 'public', NULL, NULL, '${slug}'),
  ('${ids.sRegistraci}', 'domain_doc', 'ZZID úroveň registered', 't', 'active', 'public', NULL, 'registered', NULL),
  ('${ids.sPartnerem}', 'domain_doc', 'ZZID úroveň partner', 't', 'active', 'public', NULL, 'partner', NULL),
  ('${ids.zPribehu}', 'domain_doc', 'ZZID z příběhu', 't', 'active', 'public', '${pribeh}', NULL, NULL);
SELECT 'urovne=' || public.audience_compute_actor_tier('${u.jiny}'::uuid) || '|' || public.audience_compute_actor_tier('${u.partner}'::uuid) || '|' || public.audience_compute_actor_tier(NULL::uuid);`;
      return { u, ids, slug, sql };
    }
    /** Jedno čtení: `značka=<id>` když funkce položku vydala, jinak `značka=nic`. */
    const cti = (znacka: string, id: string, publikum?: string) =>
      `SELECT '${znacka}=' || coalesce(public.mcp_get_knowledge_item(p_item_id => '${id}'::uuid${publikum ? `, p_audience_user_id => '${publikum}'::uuid` : ""})->>'id', 'nic');`;
    /** Značky, pod kterými funkce položku VYDALA (v pořadí výstupu). */
    const vydano = (out: string) =>
      out.split("\n").filter((l) => /^[a-zA-Z]+=/.test(l) && !l.startsWith("urovne=") && !l.endsWith("=nic")).map((l) => l.split("=")[0]);

    it("úroveň členství se měří u toho, pro koho se čte: služba za přihlášeného položku s úrovní vydá; bez publika a anonymovi ne", () => {
      const p = pripravek();
      const out = psql(`BEGIN;${p.sql}
${ANONYM}
${cti("anonRegistrace", p.ids.sRegistraci)}
RESET ROLE;
${jako(p.u.jiny)}
${cti("primoRegistrace", p.ids.sRegistraci)}
${cti("primoPartner", p.ids.sPartnerem)}
RESET ROLE;
${SLUZBA}
${cti("sluzbaGlobalni", p.ids.globalni)}
${cti("sluzbaRegistrace", p.ids.sRegistraci)}
${cti("sluzbaZaJinehoRegistrace", p.ids.sRegistraci, p.u.jiny)}
${cti("sluzbaZaJinehoPartner", p.ids.sPartnerem, p.u.jiny)}
${cti("sluzbaZaPartneraPartner", p.ids.sPartnerem, p.u.partner)}
ROLLBACK;`);
      expect(out, "kotva přípravku: úrovně přihlášeného, partnera a nikoho").toContain("urovne=registered|partner|anonymous");
      expect(vydano(out)).toEqual(["primoRegistrace", "sluzbaGlobalni", "sluzbaZaJinehoRegistrace", "sluzbaZaPartneraPartner"]);
    });

    it("položku příběhu dostane vlastník, účastník a správa — přímo i přes službu; bez přístupu a bez publika ne", () => {
      const p = pripravek();
      const z = p.ids.zPribehu;
      const out = psql(`BEGIN;${p.sql}
${ANONYM}
${cti("anon", z)}
RESET ROLE;
${jako(p.u.vlastnik)}
${cti("primoVlastnik", z)}
RESET ROLE;
${jako(p.u.ucastnik)}
${cti("primoUcastnik", z)}
RESET ROLE;
${jako(p.u.jiny)}
${cti("primoJiny", z)}
RESET ROLE;
${SLUZBA}
${cti("sluzba", z)}
${cti("sluzbaZaVlastnika", z, p.u.vlastnik)}
${cti("sluzbaZaUcastnika", z, p.u.ucastnik)}
${cti("sluzbaZaSpravce", z, p.u.spravce)}
${cti("sluzbaZaJineho", z, p.u.jiny)}
ROLLBACK;`);
      expect(vydano(out)).toEqual(["primoVlastnik", "primoUcastnik", "sluzbaZaVlastnika", "sluzbaZaUcastnika", "sluzbaZaSpravce"]);
    });

    it("přihlášený i anonym jsou připnutí na sebe: cizí publikum v parametru se ignoruje", () => {
      const p = pripravek();
      const out = psql(`BEGIN;${p.sql}
${ANONYM}
${cti("anonZaVlastnika", p.ids.zPribehu, p.u.vlastnik)}
${cti("anonZaPartnera", p.ids.sPartnerem, p.u.partner)}
RESET ROLE;
${jako(p.u.jiny)}
${cti("jinyZaVlastnika", p.ids.zPribehu, p.u.vlastnik)}
${cti("jinyZaPartnera", p.ids.sPartnerem, p.u.partner)}
${cti("jinyZaPartneraGlobalni", p.ids.globalni, p.u.partner)}
ROLLBACK;`);
      // Kotva: funkce s parametrem publika pro přihlášeného běží a globální položku vydá.
      expect(vydano(out)).toEqual(["jinyZaPartneraGlobalni"]);
    });

    it("má jedno přetížení: volání jedním i dvěma jmennými parametry, pozičně, slugem i s publikem projde", () => {
      const pretizeni = psql(`SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY 1) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'mcp_get_knowledge_item'`);
      expect(pretizeni).toBe("p_item_id uuid, p_source_slug text, p_audience_user_id uuid");
      const p = pripravek();
      const g = p.ids.globalni;
      const radek = (znacka: string, volani: string) => `SELECT '${znacka}=' || coalesce(public.mcp_get_knowledge_item(${volani})->>'id', 'nic');`;
      const out = psql(`BEGIN;${p.sql}
${SLUZBA}
${radek("jedenJmenny", `p_item_id => '${g}'::uuid`)}
${radek("dvaJmenne", `p_item_id => '${g}'::uuid, p_source_slug => NULL::text`)}
${radek("pozicne", `'${g}'::uuid, NULL::text`)}
${radek("slugem", `p_source_slug => '${p.slug}'`)}
${radek("sPublikem", `p_item_id => '${g}'::uuid, p_audience_user_id => '${p.u.jiny}'::uuid`)}
ROLLBACK;`);
      expect(vydano(out)).toEqual(["jedenJmenny", "dvaJmenne", "pozicne", "slugem", "sPublikem"]);
    });
  });
});
