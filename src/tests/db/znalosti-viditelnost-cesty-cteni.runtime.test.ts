/**
 * Viditelnost znalostí bez příběhu na VŠECH cestách čtení — podmínka pro každou viditelnost,
 * kterou generátor znalostí povolí (scripts/db/gen-knowledge-seed.mjs, VRSTVY).
 *
 * Generátor smí povolit viditelnost jen tehdy, když ji databáze drží na každé cestě, kudy
 * se položka dá přečíst. Tahle zkouška proto měří KAŽDOU viditelnost povolenou kteroukoli
 * vrstvou generátoru — přidání viditelnosti do VRSTVY ji sem automaticky přivede a bez zelené
 * zkoušky to je červená, ne tichý únik. Viditelnost bez očekávání v OCEKAVANI je chyba.
 *
 * Cesty: tabulka pod RLS (přímé čtení přes PostgREST), mcp_search_knowledge_v2 (obě
 * přetížení — kratší, pokud ho jde jménem vůbec zavolat), mcp_search_knowledge_v3,
 * mcp_get_knowledge_item, compose_context (cesta chatu a uzlu hippocampus v svc-ai-chat;
 * příběhové skládání za žadatele). Identity: anonym, přihlášený bez role, správa.
 * Cesta, kterou identita nemá (v3 a compose_context anonymovi), se ověří jako nedostupná.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:znalosti
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VRSTVY } from "../../../scripts/db/gen-knowledge-seed.mjs";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable } from "./test-env-probe";

const ARGS = ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1"];
const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };
const psql = (sql: string) => execFileSync("psql", [...ARGS, "-tA", "-c", sql], { encoding: "utf-8", env: ENV }).trim();
const zkus = (sql: string) => {
  const r = spawnSync("psql", [...ARGS, "-tA", "-c", sql], { encoding: "utf-8", env: ENV });
  return { kod: r.status ?? -1, vystup: (r.stdout ?? "").trim().split("\n").pop() ?? "", chyba: r.stderr ?? "" };
};

type Kdo = "anon" | "prihlaseny" | "sprava";
/** Co má kdo vidět u položky bez příběhu s danou viditelností. */
const OCEKAVANI: Record<string, Record<Kdo, 0 | 1>> = {
  public: { anon: 1, prihlaseny: 1, sprava: 1 },
  members: { anon: 0, prihlaseny: 1, sprava: 1 },
  private: { anon: 0, prihlaseny: 0, sprava: 1 },
};

const POVOLENE = [
  ...new Set((Object.values(VRSTVY) as Array<{ viditelnosti: string[] }>).flatMap((v) => v.viditelnosti)),
].sort();
const BEH = randomUUID().slice(0, 8);
const SPRAVCE = randomUUID();
const UZIVATEL = randomUUID();
const PRIBEH = randomUUID();
const VEKTOR = `'[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? "1" : "0")).join(",")}]'::vector`;
const VSECHNY = ["public", "members", "guild", "private"];
const id = (vis: string) => `00000000-0000-4000-8000-${BEH}${String(VSECHNY.indexOf(vis) + 1).padStart(4, "0")}`;
const slug = (vis: string) => `viditelnost-${vis}-${BEH}`;
const titulek = (vis: string) => `Viditelnostsonda${BEH} ${vis}`;

const relace = (kdo: Kdo) => {
  const sub = kdo === "sprava" ? SPRAVCE : kdo === "prihlaseny" ? UZIVATEL : "";
  const role = kdo === "anon" ? "anon" : "authenticated";
  return (
    `SELECT set_config('request.jwt.claims', '${JSON.stringify(sub ? { role, sub } : { role })}', false); ` +
    `SELECT set_config('request.jwt.claim.sub', '${sub}', false); SET ROLE ${role};`
  );
};

/** Cesty čtení: dotaz vrací 0/1 (najde položku), `null` = identita cestu nemá (ověří se zvlášť). */
const CESTY: Record<string, (vis: string, kdo: Kdo) => string | null> = {
  "tabulka pod RLS": (vis, kdo) => `${relace(kdo)} SELECT count(*) FROM public.knowledge_items WHERE id = '${id(vis)}';`,
  "mcp_search_knowledge_v2 (s příběhem a publikem)": (vis, kdo) =>
    `${relace(kdo)} SELECT count(*) FROM jsonb_array_elements(public.mcp_search_knowledge_v2(
       p_query_text => 'Viditelnostsonda${BEH}', p_limit => 50, p_story_id => NULL::uuid, p_audience_user_id => NULL::uuid)) r
     WHERE r->>'source_slug' = '${slug(vis)}';`,
  "mcp_search_knowledge_v3": (vis, kdo) =>
    kdo === "anon"
      ? null
      : `${relace(kdo)} SELECT count(*) FROM public.mcp_search_knowledge_v3(p_query_embedding_v1 => ${VEKTOR},
           p_limit => 50, p_similarity_threshold => 0.5) r WHERE r.knowledge_item_id = '${id(vis)}';`,
  "mcp_get_knowledge_item": (vis, kdo) =>
    `${relace(kdo)} SELECT CASE WHEN r->>'id' = '${id(vis)}' THEN 1 ELSE 0 END
       FROM (SELECT public.mcp_get_knowledge_item(p_item_id => '${id(vis)}') AS r) x;`,
  "compose_context (příběh, žadatel)": (vis, kdo) =>
    kdo === "anon"
      ? null
      : `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); SET ROLE service_role;
         SELECT count(*) FROM jsonb_array_elements(coalesce(
           public.compose_context('${PRIBEH}'::uuid, 'repo_plus_rules', NULL::uuid, 'Viditelnostsonda${BEH}', NULL,
             '${kdo === "sprava" ? SPRAVCE : UZIVATEL}'::uuid)->'layers'->'kb_retrieval'->'chunks', '[]'::jsonb)) c
         WHERE c->>'source_slug' = '${slug(vis)}';`,
};

describe.skipIf(!isPgReachable())("znalosti bez příběhu: viditelnost drží na všech cestách čtení", () => {
  beforeAll(() => {
    const polozky = POVOLENE.map(
      (vis) => `
      INSERT INTO public.knowledge_items (id, item_type, source_type, source_slug, title, summary, body_markdown, visibility, status)
        VALUES ('${id(vis)}', 'engineering_doc', 'manual', '${slug(vis)}', '${titulek(vis)}', 'sonda', 'sonda tělo', '${vis}', 'active');
      INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
        VALUES ('${id(vis).slice(0, -4)}c${id(vis).slice(-3)}', '${id(vis)}', 0, '${titulek(vis)} chunk');
      INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
        VALUES ('${id(vis).slice(0, -4)}c${id(vis).slice(-3)}', '${id(vis)}', ${VEKTOR});`,
    );
    psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${SPRAVCE}', 'vid-s-${BEH}@test.local'), ('${UZIVATEL}', 'vid-u-${BEH}@test.local');
          INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin');
          INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${PRIBEH}', 'viditelnost ${BEH}', '${UZIVATEL}');
          ${polozky.join("\n")}`);
  });
  // Jedna makroúloha mezi synchronními případy: worker vitestu stihne potvrdit průběh
  // (RPC s limitem 60 s; bez toho dlouhá sada končí „Timeout calling onTaskUpdate“).
  afterEach(() => new Promise((r) => setImmediate(r)));
  afterAll(() => {
    psql(`DELETE FROM public.knowledge_items WHERE source_slug LIKE 'viditelnost-%-${BEH}';
          DELETE FROM public.partner_stories WHERE id = '${PRIBEH}';
          DELETE FROM public.user_roles WHERE user_id IN ('${SPRAVCE}', '${UZIVATEL}');
          DELETE FROM aisha_auth.users WHERE id IN ('${SPRAVCE}', '${UZIVATEL}');`);
  });

  it("každá viditelnost, kterou generátor povolí, má očekávání (jinak by ji zkouška neměřila)", () => {
    expect(POVOLENE.length).toBeGreaterThan(0);
    for (const vis of POVOLENE) expect(OCEKAVANI[vis], `chybí očekávání pro viditelnost ${vis}`).toBeDefined();
  });

  it("kotva: správa najde každou sondu na každé cestě, kterou má (cesty umějí položku vrátit)", () => {
    for (const vis of POVOLENE) {
      for (const [cesta, dotaz] of Object.entries(CESTY)) {
        const sql = dotaz(vis, "sprava");
        if (!sql) continue;
        const r = zkus(sql);
        expect(r.kod, `${cesta}/${vis}: ${r.chyba}`).toBe(0);
        expect(r.vystup, `${cesta}/${vis}: správa`).toBe(String(OCEKAVANI[vis].sprava));
      }
    }
  });

  // Brána hlídá ÚNIK: žádná cesta nevydá víc, než identita smí (odepřené právo = nevydáno).
  // Že cesta položku umí vrátit, dokazuje kotva správy výš.
  for (const vis of POVOLENE) {
    for (const kdo of ["anon", "prihlaseny"] as Kdo[]) {
      it(`${vis} · ${kdo}: žádná cesta nevydá víc, než smí (nejvýš ${OCEKAVANI[vis]?.[kdo]})`, () => {
        for (const [cesta, dotaz] of Object.entries(CESTY)) {
          const sql = dotaz(vis, kdo);
          if (!sql) continue;
          const r = zkus(sql);
          if (r.kod !== 0 && /permission denied|42501/.test(r.chyba)) continue; // odepřeno = nevydáno
          expect(r.kod, `${cesta}/${vis}/${kdo}: ${r.chyba}`).toBe(0);
          expect(Number(r.vystup), `${cesta}/${vis}/${kdo}`).toBeLessThanOrEqual(OCEKAVANI[vis][kdo]);
        }
      });
    }
  }

  it("kratší přetížení mcp_search_knowledge_v2: buď ho jménem zavolat nejde, nebo drží totéž", () => {
    for (const vis of POVOLENE) {
      for (const kdo of ["anon", "prihlaseny", "sprava"] as Kdo[]) {
        const r = zkus(`${relace(kdo)} SELECT count(*) FROM jsonb_array_elements(public.mcp_search_knowledge_v2(
          NULL::vector, 'Viditelnostsonda${BEH}'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[], true, 50, 0.3::float8)) r
          WHERE r->>'source_slug' = '${slug(vis)}';`);
        if (r.kod !== 0) {
          expect(r.chyba, `${vis}/${kdo}: jiná chyba než nejednoznačnost`).toMatch(/is not unique/);
          continue;
        }
        expect(Number(r.vystup), `${vis}/${kdo}`).toBeLessThanOrEqual(OCEKAVANI[vis][kdo]);
      }
    }
  });

  it("cesty, které anonym nemá, mu opravdu nejsou dostupné (v3 bez práva, compose_context jen službě a přihlášenému)", () => {
    expect(psql(`SELECT has_function_privilege('anon', 'public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid)', 'EXECUTE')`)).toBe("f");
    expect(psql(`SELECT has_function_privilege('anon', 'public.compose_context(uuid,text,uuid,text,text,uuid)', 'EXECUTE')`)).toBe("f");
  });
});
