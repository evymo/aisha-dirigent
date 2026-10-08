/**
 * Seed bez duplicit — opakovaný seed nic nepřidá a heal sloučí kopie z doby před opravou.
 *
 * ⛔ PROČ (naměřeno 2026-10-05 na čisté DB, seed 1×/2×/3×): db:seed běží při KAŽDÉM
 * nasazení a dva bloky seedu vkládaly řádky bez stabilního klíče s `ON CONFLICT DO
 * NOTHING` bez cíle — konflikt nikdy nenastal. knowledge_items occipitum (seed/core/30)
 * 18 → 36 → 54, ai_golden_examples (seed/core/22 §22.3) 5 → 10 → 15. Každá kopie znalosti
 * pak dostala vlastní chunky, embedding a audit, každá kopie vzoru vstupovala do hodnocení.
 *
 * Měří se VLASTNOST, ne vzorek:
 *   - každý zdroj znalostí (source_type|item_type|category) má po 3. seedu tolik řádků
 *     jako po 1.; zrcadlo expert_rules je po každém seedu právě jedno na pravidlo;
 *   - žádná dvojice znalostí se stejným obsahem a zařazením, žádný zdvojený vzor;
 *   - heal na DB ve stavu „starý seed 3×" kopie sloučí, vazby přepojí, cizí položky
 *     (uživatelská, instance, příběh) nechá byte po bytu, a co by sloučení ztratilo
 *     (jiný stav, karanténa, citovaný chunk bez protějšku), nesloučí a nahlas ohlásí.
 * KOTVA v témže běhu: měřidla musí duplicitu v uměle vyrobeném stavu opravdu najít —
 * jinak by prázdný nález znamenal slepé měřidlo, ne čistý seed.
 *
 * Zrcadla expert_rules: počet zrcadel se mezi 1. a 2. seedem mění, protože se mění počet
 * PRAVIDEL — core/38–40 potřebují autora z pozdější vrstvy (demo/00, implementation/04)
 * a doběhnou až při druhém seedu. Zrcadel je pořád právě tolik, kolik pravidel (měří
 * se níž); dvouprůchodová konvergence pravidel je samostatný nález, ne duplicita.
 *
 * Probe DB vzniká vedle testovací DB a po testu zmizí (sdílenou DB sady nemění).
 * Stav „starý seed" se vyrábí ze seedu HEAD (kopie bez slugu, nová id) — test tak
 * nezávisí na historii gitu. Skutečný seed předchozího mainu měří
 * seed-upgrade-bez-duplicit.runtime.test.ts.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:seed-bez-duplicit
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import {
  SEED_HEAD,
  blokHeals,
  duplicityVzoru,
  duplicityZnalosti,
  migrate,
  pocetVzoru,
  poctyTabulek,
  skript,
  soubor,
  sql,
  zalozProbe,
  zdrojeZnalosti,
  zrcadla,
  zrusProbe,
} from "./seed-duplicity";

const RUN = randomUUID().slice(0, 8);
const PROBE = `seed_dupl_${RUN}`;
const UZIV = randomUUID();
const ADMIN = randomUUID();
const STORY = randomUUID();
const DATASET = randomUUID();
const EVAL_RUN = randomUUID();
const BEH_A = randomUUID();
const BEH_C = randomUUID();

/** Tvar řádku, jaký vkládal seed occipitum. */
const OCCIPITUM = `category = 'occipitum' AND item_type = 'playbook' AND source_type = 'manual' AND story_id IS NULL AND locale = 'global'`;
const ZRCADLO = "guild_db|expert_rule|";
/** Položky, které heal nesmí změnit: uživatelská, doslovná kopie uživatele, instance ×2, příběh. */
const CIZI = ["U", "V", "I1", "I2", "S"];
/**
 * Deníky: zapisují KAŽDOU akci, i opakovaný upsert seedu (role_updated, *_catalog_seeded,
 * KB_RAGNAROK_SYNC_TRIGGER). Jejich růst s každým seedem je jejich účel, ne duplicita.
 */
const DENIKY = new Set(["public.audit_journal", "public.audit_logs"]);

type Mereni = {
  tabulky: Record<string, number>;
  zdroje: Record<string, number>;
  vzory: number;
  zrcadla: Awaited<ReturnType<typeof zrcadla>>;
  dupl: string[];
  duplVzoru: string[];
  occipitum: number;
  occipitumSeSlugem: number;
};

async function zmer(db: string): Promise<Mereni> {
  const [occ, occSlug] = (
    await sql(db, `SELECT count(*), count(*) FILTER (WHERE source_slug LIKE 'occipitum-%') FROM public.knowledge_items WHERE ${OCCIPITUM}`)
  )
    .split("|")
    .map(Number);
  return {
    tabulky: await poctyTabulek(db),
    zdroje: await zdrojeZnalosti(db),
    vzory: await pocetVzoru(db),
    zrcadla: await zrcadla(db),
    dupl: await duplicityZnalosti(db),
    duplVzoru: await duplicityVzoru(db),
    occipitum: occ,
    occipitumSeSlugem: occSlug,
  };
}

const bezZrcadel = (z: Record<string, number>) => Object.fromEntries(Object.entries(z).filter(([k]) => !k.startsWith(ZRCADLO)));
const id = async (jmeno: string) => sql(PROBE, `SELECT id FROM zkouska.id WHERE jmeno = '${jmeno.replace(/'/g, "''")}'`);
const radek = async (tabulka: string, rid: string) => sql(PROBE, `SELECT row_to_json(t)::text FROM ${tabulka} t WHERE id = '${rid}'`);
/**
 * Příkaz pod rolí PostgREST (SET ROLE + request.jwt.claims — totéž přepnutí, které dělá
 * PostgREST; granty, RLS i stráže definer funkcí platí). Vrací výstup, nebo text chyby.
 */
async function jako(role: "anon" | "authenticated" | "service_role", sub: string | null, prikaz: string) {
  const claims = JSON.stringify(sub ? { role, sub } : { role });
  try {
    const out = await sql(
      PROBE,
      `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims', '${claims}', true); ${prikaz}; COMMIT;`,
    );
    return { ok: true as const, out };
  } catch (e) {
    return { ok: false as const, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}
const existuje = async (tabulka: string, rid: string) => (await sql(PROBE, `SELECT count(*) FROM ${tabulka} WHERE id = '${rid}'`)) === "1";

describe.skipIf(!isPgReachable())("seed bez duplicit — opakovaný seed a heal kopií starého seedu", () => {
  const po: Mereni[] = [];

  beforeAll(async () => {
    await zalozProbe(PROBE);
    await migrate(PROBE);
    for (let i = 0; i < 3; i++) {
      await soubor(PROBE, SEED_HEAD);
      po.push(await zmer(PROBE));
    }
  }, 900_000);

  afterAll(async () => {
    await zrusProbe(PROBE);
  }, 120_000);

  // jedna makroúloha mezi případy — worker vitestu musí stihnout potvrdit průběh
  afterEach(() => new Promise<void>((r) => setImmediate(r)));

  it("kotva: seed opravdu seeduje měřené zdroje (occipitum, vzory, pravidla)", () => {
    expect(po).toHaveLength(3);
    expect(po[0].occipitum, "seed nevložil occipitum — měřilo by se nic").toBeGreaterThan(0);
    expect(po[0].vzory, "seed nevložil vzory hodnocení").toBeGreaterThan(0);
    expect(po[2].zrcadla.pravidla, "seed nevložil žádné expert_rules — zrcadla by se neměřila").toBeGreaterThan(0);
  });

  it("seed 3×: každý zdroj znalostí má po 3. seedu tolik řádků jako po 1. (zrcadla viz další případ)", () => {
    expect(bezZrcadel(po[1].zdroje)).toEqual(bezZrcadel(po[0].zdroje));
    expect(bezZrcadel(po[2].zdroje)).toEqual(bezZrcadel(po[0].zdroje));
    // pevný bod včetně zrcadel: od druhého seedu se nemění nic
    expect(po[2].zdroje).toEqual(po[1].zdroje);
    expect(po.map((m) => m.vzory)).toEqual([po[0].vzory, po[0].vzory, po[0].vzory]);
  });

  it("seed 3×: od 2. seedu neroste ŽÁDNÁ tabulka (mimo deníky) — třída, ne jen známé zdroje", () => {
    const rostou = Object.keys(po[2].tabulky)
      .filter((t) => !DENIKY.has(t) && po[2].tabulky[t] !== po[1].tabulky[t])
      .map((t) => `${t}: ${po[0].tabulky[t]} → ${po[1].tabulky[t]} → ${po[2].tabulky[t]}`);
    expect(rostou, "tabulka roste s každým seedem = seed v ní nemá stabilní klíč").toEqual([]);
    expect(Object.keys(po[2].tabulky).length, "měřidlo nevidí tabulky").toBeGreaterThan(100);
  });

  it("seed 3×: zrcadlo expert_rules je po každém seedu právě jedno na pravidlo", () => {
    for (const [i, m] of po.entries()) {
      expect(m.zrcadla.viceNezJedno, `seed ${i + 1}: pravidlo s víc zrcadly`).toBe(0);
      expect(m.zrcadla.bezZrcadla, `seed ${i + 1}: pravidlo bez zrcadla`).toBe(0);
      expect(m.zrcadla.zrcadla, `seed ${i + 1}: zrcadel jiný počet než pravidel`).toBe(m.zrcadla.pravidla);
    }
  });

  it("seed 3×: žádná duplicita znalostí ani vzorů; položky occipitum nesou slug", () => {
    for (const [i, m] of po.entries()) {
      expect(m.dupl, `seed ${i + 1}: duplicitní znalosti`).toEqual([]);
      expect(m.duplVzoru, `seed ${i + 1}: duplicitní vzory`).toEqual([]);
      expect(m.occipitumSeSlugem, `seed ${i + 1}: položka occipitum bez slugu`).toBe(m.occipitum);
    }
  });

  it("kotva: měřidla duplicit v uměle vyrobeném stavu duplicitu opravdu najdou", async () => {
    const kopie = randomUUID();
    const kopieVzoru = randomUUID();
    const kopieZrcadla = randomUUID();
    await skript(
      PROBE,
      `INSERT INTO public.knowledge_items
       SELECT (jsonb_populate_record(NULL::public.knowledge_items,
                 to_jsonb(k) || jsonb_build_object('id', '${kopie}', 'source_slug', NULL))).*
         FROM public.knowledge_items k WHERE ${OCCIPITUM} ORDER BY k.id LIMIT 1;
       INSERT INTO public.ai_golden_examples
       SELECT (jsonb_populate_record(NULL::public.ai_golden_examples, to_jsonb(g) || jsonb_build_object('id', '${kopieVzoru}'))).*
         FROM public.ai_golden_examples g WHERE g.message_id IS NULL ORDER BY g.id LIMIT 1;
       INSERT INTO public.knowledge_items
       SELECT (jsonb_populate_record(NULL::public.knowledge_items,
                 to_jsonb(k) || jsonb_build_object('id', '${kopieZrcadla}', 'locale', 'en'))).*
         FROM public.knowledge_items k WHERE k.source_type = 'guild_db' AND k.item_type = 'expert_rule' ORDER BY k.id LIMIT 1;`,
    );
    try {
      expect((await duplicityZnalosti(PROBE)).length, "kopie znalosti bez slugu nenalezena — měřidlo je slepé").toBe(1);
      expect((await duplicityVzoru(PROBE)).length, "kopie vzoru nenalezena — měřidlo je slepé").toBe(1);
      expect((await zrcadla(PROBE)).viceNezJedno, "druhé zrcadlo pravidla nenalezeno — měřidlo je slepé").toBe(1);
    } finally {
      await sql(PROBE, `DELETE FROM public.knowledge_items WHERE id IN ('${kopie}', '${kopieZrcadla}')`);
      await sql(PROBE, `DELETE FROM public.ai_golden_examples WHERE id = '${kopieVzoru}'`);
    }
    expect(await duplicityZnalosti(PROBE)).toEqual([]);
    expect(await duplicityVzoru(PROBE)).toEqual([]);
  });

  describe("heal na DB ve stavu „starý seed 3×“", () => {
    const pred: Record<string, string> = {};
    let stderr = "";
    let poHealu = "";
    let predDupl: string[] = [];
    let predDuplVzoru: string[] = [];

    beforeAll(async () => {
      // ── stav starého seedu: bez slugu, tři kopie (jako po třech nasazeních) ─────────
      await skript(
        PROBE,
        `CREATE SCHEMA zkouska;
         CREATE TABLE zkouska.id (jmeno text PRIMARY KEY, id uuid NOT NULL);
         UPDATE public.knowledge_items SET source_slug = NULL WHERE ${OCCIPITUM};
         INSERT INTO public.knowledge_items
         SELECT (jsonb_populate_record(NULL::public.knowledge_items,
                   to_jsonb(k) || jsonb_build_object('id', gen_random_uuid(),
                                                     'created_at', k.created_at + make_interval(secs => n),
                                                     'updated_at', k.updated_at + make_interval(secs => n)))).*
           FROM public.knowledge_items k CROSS JOIN generate_series(1, 2) n
          WHERE ${OCCIPITUM};
         INSERT INTO public.ai_golden_examples
         SELECT (jsonb_populate_record(NULL::public.ai_golden_examples,
                   to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(),
                                                     'created_at', g.created_at + make_interval(secs => n)))).*
           FROM public.ai_golden_examples g CROSS JOIN generate_series(1, 2) n
          WHERE g.message_id IS NULL AND g.conversation_id IS NULL;
         -- pojmenované kopie: <titulek>#0..2 podle stáří
         INSERT INTO zkouska.id
         SELECT title || '#' || (row_number() OVER (PARTITION BY title ORDER BY created_at, id) - 1), id
           FROM public.knowledge_items WHERE ${OCCIPITUM};
         INSERT INTO zkouska.id
         SELECT 'vzor:' || split_part(user_message, ' ', 1) || '#' || (row_number() OVER (PARTITION BY user_message ORDER BY created_at, id) - 1), id
           FROM public.ai_golden_examples WHERE message_id IS NULL AND conversation_id IS NULL;

         INSERT INTO aisha_auth.users (id, email) VALUES ('${UZIV}', 'seed-dupl-${RUN}@test.local'),
                                                     ('${ADMIN}', 'seed-dupl-admin-${RUN}@test.local');
         INSERT INTO public.roles (name, display_name, is_admin) VALUES ('admin', 'Administrator', true) ON CONFLICT (name) DO NOTHING;
         INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;
         INSERT INTO public.partner_stories (id, user_id, title, status) VALUES ('${STORY}', '${UZIV}', 'seed dupl ${RUN}', 'active');
         INSERT INTO public.training_datasets (id, name, source_type) VALUES ('${DATASET}', 'seed dupl ${RUN}', 'kb_extraction');
         INSERT INTO public.ai_eval_runs (id, trigger_type, status) VALUES ('${EVAL_RUN}', 'manual', 'completed');

         DO $f$
         DECLARE
           a0 uuid; a1 uuid; a2 uuid; c1 uuid; c2 uuid;
           k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
           p1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid();
           v_eval uuid;
         BEGIN
           SELECT id INTO a0 FROM zkouska.id WHERE jmeno = 'Editorial Grid Layout#0';
           SELECT id INTO a1 FROM zkouska.id WHERE jmeno = 'Editorial Grid Layout#1';
           SELECT id INTO a2 FROM zkouska.id WHERE jmeno = 'Editorial Grid Layout#2';
           -- A: kopie #1 nese chunk + embedding (zůstane), kopie #2 shodný chunk, citovaný,
           --    a vazby (atribuce, trénovací příklad, uzel grafu); usage_count se sečte
           INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, source_field)
           VALUES (k1, a1, 0, 'Editorial grid', 'body'), (k2, a2, 0, 'Editorial grid', 'body');
           INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
           VALUES (k1, a1, array_fill(0, ARRAY[1024])::vector);
           INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('${BEH_A}', 'chat', '${STORY}', ARRAY[k2]);
           INSERT INTO public.ai_run_critic_iterations (ai_run_id, iteration, retrieved_chunk_ids, decision)
           VALUES ('${BEH_A}', 1, ARRAY[k2], 'stop_threshold_met');
           INSERT INTO public.rag_eval_runs (golden_id, batch_id, embedding_model, llm_model, retrieved_chunk_ids)
           SELECT g.id, gen_random_uuid(), 'zkouska', 'zkouska', ARRAY[k2] FROM public.rag_eval_golden g ORDER BY g.id LIMIT 1
           RETURNING id INTO v_eval;
           INSERT INTO public.knowledge_attribution (story_id, knowledge_item_id) VALUES ('${STORY}', a2);
           INSERT INTO public.training_examples (dataset_id, instruction, output, source_id, source_type)
           VALUES ('${DATASET}', 'q', 'a', a2, 'knowledge_items');
           INSERT INTO public.graph_nodes (entity_type, entity_slug, entity_label, source_table, source_id)
           VALUES ('KnowledgeItem', 'seed-dupl-${RUN}', 'Editorial Grid', 'knowledge_items', a2);
           UPDATE public.knowledge_items SET usage_count = 3 WHERE id = a0;
           UPDATE public.knowledge_items SET usage_count = 2 WHERE id = a2;
           INSERT INTO zkouska.id VALUES ('A:k1', k1), ('A:k2', k2), ('A:rag', v_eval);

           -- B: kopie #2 archivovaná člověkem → jiný stav, nesloučit
           UPDATE public.knowledge_items SET status = 'archived'
            WHERE id = (SELECT id FROM zkouska.id WHERE jmeno = 'Kinetic Typography Hero#2');

           -- C: kopie #1 má embedding (zůstane), kopie #2 citovaný chunk s JINÝM textem → bez protějšku
           SELECT id INTO c1 FROM zkouska.id WHERE jmeno = 'Scroll-Driven Storytelling#1';
           SELECT id INTO c2 FROM zkouska.id WHERE jmeno = 'Scroll-Driven Storytelling#2';
           INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, source_field)
           VALUES (p1, c1, 0, 'Scroll story P', 'body'), (q2, c2, 0, 'Scroll story Q', 'body');
           INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
           VALUES (p1, c1, array_fill(0, ARRAY[1024])::vector);
           INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids) VALUES ('${BEH_C}', 'chat', '${STORY}', ARRAY[q2]);
           INSERT INTO zkouska.id VALUES ('C:q2', q2);

           -- V (revize 2026-10-05): UŽIVATELSKÁ doslovná kopie položky seedu — všechny sloupce
           -- jako kopie seedu, jen s autorem; starší než kopie seedu a s chunkem + embeddingem,
           -- tedy podle pořadí „embedding, nejstarší" by vyhrála. Nesmí se jí nic stát.
           INSERT INTO public.knowledge_items
           SELECT (jsonb_populate_record(NULL::public.knowledge_items,
                     to_jsonb(k) || jsonb_build_object('id', gen_random_uuid(), 'author_id', '${UZIV}',
                                                       'created_at', k.created_at - interval '1 day'))).*
             FROM public.knowledge_items k WHERE k.id = (SELECT id FROM zkouska.id WHERE jmeno = 'Micro-Interaction Personality#0')
           RETURNING id INTO v_eval;
           INSERT INTO zkouska.id VALUES ('V', v_eval);
           INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, source_field)
           VALUES (gen_random_uuid(), v_eval, 0, 'Micro interaction', 'body');
           INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
           SELECT c.id, v_eval, array_fill(0, ARRAY[1024])::vector FROM public.knowledge_chunks c WHERE c.knowledge_item_id = v_eval;

           -- E: kopie #1 v karanténě → nesloučit
           UPDATE public.knowledge_items SET quarantine_status = 'quarantined', quarantine_reason = 'zkouska'
            WHERE id = (SELECT id FROM zkouska.id WHERE jmeno = 'Brutalist Authenticity#1');

           -- cizí položky: uživatelská (titulek seedu, jiný obsah), instance (obsah seedu, jiný zdroj),
           -- příběh (obsah seedu, story_id)
           INSERT INTO public.knowledge_items (id, item_type, source_type, title, body_markdown, category)
           VALUES ('${randomUUID()}', 'playbook', 'manual', 'Bento Grid Dashboard', 'Vlastní poznámka uživatele k bento gridu.', 'occipitum')
           RETURNING id INTO v_eval;
           INSERT INTO zkouska.id VALUES ('U', v_eval);
           WITH x AS (
             INSERT INTO public.knowledge_items (item_type, source_type, title, body_markdown, category)
             SELECT 'playbook'::public.knowledge_item_type, 'local_ingest', k.title, k.body_markdown, 'occipitum'
               FROM public.knowledge_items k CROSS JOIN generate_series(1, 2) WHERE k.id = a0
             RETURNING id)
           INSERT INTO zkouska.id SELECT 'I' || row_number() OVER (ORDER BY x.id), x.id FROM x;
           INSERT INTO public.knowledge_items (item_type, source_type, title, body_markdown, category, story_id)
           SELECT 'playbook'::public.knowledge_item_type, 'manual', k.title, k.body_markdown, 'occipitum', '${STORY}'
             FROM public.knowledge_items k WHERE k.id = a0
           RETURNING id INTO v_eval;
           INSERT INTO zkouska.id VALUES ('S', v_eval);

           -- vzory: G1 hodnocení na kopiích #1 a #2 (přepojit), G2 kopie #2 s jiným hodnocením (nesloučit)
           INSERT INTO public.ai_eval_results (eval_run_id, golden_example_id, relevance_score, groundedness_score,
                                               safety_score, coherence_score, overall_score, evaluator_model)
           SELECT '${EVAL_RUN}', id, 0.9, 0.9, 1, 0.9, 0.9, 'zkouska' FROM zkouska.id
            WHERE jmeno IN ('vzor:Jak#1', 'vzor:Jak#2');
           UPDATE public.ai_golden_examples SET admin_rating = 1
            WHERE id = (SELECT id FROM zkouska.id WHERE jmeno = 'vzor:TypeError:#2');
         END
         $f$;`,
      );
      for (const j of CIZI) pred[j] = await radek("public.knowledge_items", await id(j));
      predDupl = await duplicityZnalosti(PROBE);
      predDuplVzoru = await duplicityVzoru(PROBE);
      stderr = await skript(PROBE, blokHeals("seed-bez-duplicit"));
    }, 300_000);

    it("kotva: měřidla stav starého seedu vidí — před healem každá položka i vzor ×3", () => {
      // každá položka occipitum je skupina (×3, Micro ×4 s doslovnou kopií uživatele),
      // navíc dvojice položek instance (tu heal nechá)
      expect(predDupl.filter((d) => d.startsWith("manual|"))).toHaveLength(po[0].occipitum);
      expect(predDupl).toContain("manual|playbook|occipitum|-|global|Micro-Interaction Personality ×4");
      expect(predDupl.filter((d) => d.startsWith("local_ingest|"))).toEqual([
        "local_ingest|playbook|occipitum|-|global|Editorial Grid Layout ×2",
      ]);
      expect(predDuplVzoru.filter((d) => d.endsWith(" ×3"))).toHaveLength(po[0].vzory);
    });

    it("po healu měřidla vidí jen to, co heal vědomě nechal (B, C, E), doslovnou kopii uživatele a dvojici instance", async () => {
      expect(await duplicityZnalosti(PROBE)).toEqual([
        "local_ingest|playbook|occipitum|-|global|Editorial Grid Layout ×2",
        "manual|playbook|occipitum|-|global|Brutalist Authenticity ×2",
        "manual|playbook|occipitum|-|global|Kinetic Typography Hero ×2",
        "manual|playbook|occipitum|-|global|Micro-Interaction Personality ×2",
        "manual|playbook|occipitum|-|global|Scroll-Driven Storytelling ×2",
      ]);
      expect((await duplicityVzoru(PROBE)).map((d) => d.split(" ")[0])).toEqual(["TypeError:"]);
    });

    it("každá položka occipitum má právě jednu kopii, kromě těch, které by sloučení ztratilo", async () => {
      const zbylo = await sql(
        PROBE,
        `SELECT title || '=' || count(*) FROM public.knowledge_items
          WHERE ${OCCIPITUM} AND author_id IS NULL AND id <> (SELECT id FROM zkouska.id WHERE jmeno = 'U')
          GROUP BY title HAVING count(*) <> 1 ORDER BY title`,
      );
      expect(zbylo.split("\n").filter(Boolean)).toEqual([
        "Brutalist Authenticity=2",
        "Kinetic Typography Hero=2",
        "Scroll-Driven Storytelling=2",
      ]);
      expect(Number(await sql(PROBE, `SELECT count(DISTINCT source_slug) FROM public.knowledge_items WHERE source_slug LIKE 'occipitum-%'`))).toBe(
        po[0].occipitum,
      );
    });

    it("A: zůstala kopie s embeddingem, vazby kopií přepojené, citace na shodný chunk, usage sečtený", async () => {
      const [a0, a1, a2, k1, k2, rag] = await Promise.all(
        ["Editorial Grid Layout#0", "Editorial Grid Layout#1", "Editorial Grid Layout#2", "A:k1", "A:k2", "A:rag"].map(id),
      );
      expect(await existuje("public.knowledge_items", a1)).toBe(true);
      expect(await existuje("public.knowledge_items", a0)).toBe(false);
      expect(await existuje("public.knowledge_items", a2)).toBe(false);
      expect(await sql(PROBE, `SELECT source_slug || '|' || usage_count FROM public.knowledge_items WHERE id = '${a1}'`)).toBe(
        "occipitum-editorial-grid-layout|5",
      );
      expect(await sql(PROBE, `SELECT count(*) FROM public.knowledge_embeddings WHERE chunk_id = '${k1}' AND knowledge_item_id = '${a1}'`)).toBe("1");
      expect(await existuje("public.knowledge_chunks", k2)).toBe(false);
      expect(await sql(PROBE, `SELECT citation_chunk_ids::text FROM public.ai_runs WHERE id = '${BEH_A}'`)).toBe(`{${k1}}`);
      expect(await sql(PROBE, `SELECT retrieved_chunk_ids::text FROM public.ai_run_critic_iterations WHERE ai_run_id = '${BEH_A}'`)).toBe(`{${k1}}`);
      expect(await sql(PROBE, `SELECT retrieved_chunk_ids::text FROM public.rag_eval_runs WHERE id = '${rag}'`)).toBe(`{${k1}}`);
      expect(await sql(PROBE, `SELECT knowledge_item_id FROM public.knowledge_attribution WHERE story_id = '${STORY}'`)).toBe(a1);
      expect(await sql(PROBE, `SELECT source_id FROM public.training_examples WHERE dataset_id = '${DATASET}'`)).toBe(a1);
      expect(await sql(PROBE, `SELECT source_id FROM public.graph_nodes WHERE entity_slug = 'seed-dupl-${RUN}'`)).toBe(a1);
    });

    it("B, C, E: jiný stav, citovaný chunk bez protějšku a karanténa zůstaly; ponechaná položka nese slug", async () => {
      const [b0, b1, b2, c0, c1, c2, q2, e0, e1, e2] = await Promise.all(
        [
          "Kinetic Typography Hero#0",
          "Kinetic Typography Hero#1",
          "Kinetic Typography Hero#2",
          "Scroll-Driven Storytelling#0",
          "Scroll-Driven Storytelling#1",
          "Scroll-Driven Storytelling#2",
          "C:q2",
          "Brutalist Authenticity#0",
          "Brutalist Authenticity#1",
          "Brutalist Authenticity#2",
        ].map(id),
      );
      const stav = async (rid: string) =>
        sql(PROBE, `SELECT coalesce(source_slug, '-') || '|' || status || '|' || quarantine_status FROM public.knowledge_items WHERE id = '${rid}'`);
      expect(await stav(b0)).toBe("occipitum-kinetic-typography-hero|active|clear");
      expect(await existuje("public.knowledge_items", b1)).toBe(false);
      expect(await stav(b2)).toBe("-|archived|clear");
      expect(await existuje("public.knowledge_items", c0)).toBe(false);
      expect(await stav(c1)).toBe("occipitum-scroll-driven-storytelling|active|clear");
      expect(await stav(c2)).toBe("-|active|clear");
      expect(await existuje("public.knowledge_chunks", q2)).toBe(true);
      expect(await sql(PROBE, `SELECT citation_chunk_ids::text FROM public.ai_runs WHERE id = '${BEH_C}'`)).toBe(`{${q2}}`);
      expect(await stav(e0)).toBe("occipitum-brutalist-authenticity|active|clear");
      expect(await stav(e1)).toBe("-|active|quarantined");
      expect(await existuje("public.knowledge_items", e2)).toBe(false);
    });

    it("uživatelská doslovná kopie s embeddingem zůstala beze změny; kopie seedu se sloučily mezi sebou", async () => {
      const v = await id("V");
      expect(await radek("public.knowledge_items", v), "uživatelská kopie se změnila").toBe(pred.V);
      expect(await sql(PROBE, `SELECT count(*) FROM public.knowledge_embeddings WHERE knowledge_item_id = '${v}'`)).toBe("1");
      expect(
        await sql(
          PROBE,
          `SELECT count(*) || '|' || string_agg(coalesce(source_slug, '-'), ',') FROM public.knowledge_items
            WHERE ${OCCIPITUM} AND title = 'Micro-Interaction Personality' AND author_id IS NULL`,
        ),
      ).toBe("1|occipitum-micro-interaction-personality");
    });

    it("cizí položky (uživatelská, instance, příběh) beze změny", async () => {
      for (const j of CIZI) {
        expect(await radek("public.knowledge_items", await id(j)), `položka ${j} se změnila`).toBe(pred[j]);
      }
    });

    it("vzory: kopie sloučené, hodnocení přepojené na ponechaný vzor; vzor s jiným hodnocením zůstal", async () => {
      const zbylo = await sql(
        PROBE,
        `SELECT split_part(user_message, ' ', 1) || '=' || count(*) FROM public.ai_golden_examples
          WHERE message_id IS NULL AND conversation_id IS NULL GROUP BY user_message HAVING count(*) <> 1`,
      );
      expect(zbylo.split("\n").filter(Boolean)).toEqual(["TypeError:=2"]);
      const g1 = await id("vzor:Jak#1");
      expect(await sql(PROBE, `SELECT count(*) FILTER (WHERE golden_example_id = '${g1}') || '/' || count(*) FROM public.ai_eval_results WHERE eval_run_id = '${EVAL_RUN}'`)).toBe(
        "2/2",
      );
      expect(await existuje("public.ai_golden_examples", await id("vzor:TypeError:#2"))).toBe(true);
    });

    it("sloučení i ponechání je nahlas: WARNING a záznamy v audit_journal s počty", async () => {
      expect(stderr).toMatch(/seed-bez-duplicit: 4 kopií seedu NESLOUČENO/);
      const sloucene = JSON.parse(
        await sql(PROBE, `SELECT metadata::text FROM public.audit_journal WHERE action = 'seed.duplicates_merged'`),
      );
      // 18 položek × 3 kopie = 54, zůstalo 18 + 3 ponechané; 5 vzorů × 3 = 15, zůstalo 5 + 1
      expect(sloucene.knowledge_items).toMatchObject({ slouceno: po[0].occipitum * 3 - po[0].occipitum - 3, slug_doplnen: po[0].occipitum, citace_prepojeno: 3 });
      expect(sloucene.knowledge_items.chunky_smazano).toBe(1);
      expect(sloucene.ai_golden_examples).toEqual({ slouceno: po[0].vzory * 3 - po[0].vzory - 1 });
      const ponechane = JSON.parse(
        await sql(PROBE, `SELECT metadata->'ponechane' FROM public.audit_journal WHERE action = 'seed.duplicates_left'`),
      ) as { duvod: string }[];
      expect(ponechane.map((p) => p.duvod).sort()).toEqual(["citovany_chunk_bez_protejsku", "jiny_stav", "jiny_stav", "jiny_stav"]);
    });

    it("heal je idempotentní: druhý běh nezmění data, jen znovu ohlásí ponechané", async () => {
      const otisk = () =>
        sql(
          PROBE,
          `SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (
             SELECT id || coalesce(source_slug, '') || usage_count || status AS x FROM public.knowledge_items
             UNION ALL SELECT id::text || knowledge_item_id FROM public.knowledge_chunks
             UNION ALL SELECT id::text || knowledge_item_id FROM public.knowledge_embeddings
             UNION ALL SELECT id::text || citation_chunk_ids::text FROM public.ai_runs
             UNION ALL SELECT id::text || coalesce(knowledge_item_id::text, '') FROM public.knowledge_attribution
             UNION ALL SELECT id::text FROM public.ai_golden_examples
             UNION ALL SELECT id::text || coalesce(golden_example_id::text, '') FROM public.ai_eval_results) t`,
        );
      poHealu = await otisk();
      await skript(PROBE, blokHeals("seed-bez-duplicit"));
      expect(await otisk()).toBe(poHealu);
      expect(await sql(PROBE, `SELECT count(*) FROM public.audit_journal WHERE action = 'seed.duplicates_merged'`)).toBe("1");
      // stejná sada ponechaných kopií = žádný nový záznam (audit neroste s každým nasazením)
      expect(await sql(PROBE, `SELECT count(*) FROM public.audit_journal WHERE action = 'seed.duplicates_left'`)).toBe("1");
    });

    it("podvržený záznam útočníka heal neovlivní; záznam píše jen běh, který data změnil", async () => {
      const zaznamy = (akce: string) => sql(PROBE, `SELECT count(*) FROM public.audit_journal WHERE action = '${akce}'`);
      const [b2, e1] = await Promise.all(["Kinetic Typography Hero#2", "Brutalist Authenticity#1"].map(id));
      // člověk smaže ponechanou B#2 → heal nic nezmění → žádný nový záznam (audit neroste s nasazeními)
      await sql(PROBE, `DELETE FROM public.knowledge_items WHERE id = '${b2}'`);
      await skript(PROBE, blokHeals("seed-bez-duplicit"));
      expect(await zaznamy("seed.duplicates_left")).toBe("1");
      expect(await zaznamy("seed.duplicates_merged")).toBe("1");

      // ÚTOČNÍK: přihlášený bez rolí podvrhne „poslední stav" — přesně sadu, která po příštím
      // běhu zbude (bez B#2 a E#1). Heal, který by se podle posledního záznamu řídil, by
      // svůj záznam potlačil.
      const ocekavana = (await sql(
        PROBE,
        `SELECT jsonb_agg(e ORDER BY e->>'tabulka', e->>'kopie')::text
           FROM jsonb_array_elements((SELECT metadata->'ponechane' FROM public.audit_journal
                                       WHERE action = 'seed.duplicates_left' AND user_id IS NULL)) e
          WHERE e->>'kopie' NOT IN ('${b2}', '${e1}')`,
      )).replace(/'/g, "''"); // literál SQL: klíč vzoru nese apostrofy
      const podvrh = await jako(
        "authenticated",
        UZIV,
        `SELECT public.log_audit_event('seed.duplicates_left', jsonb_build_object('ponechane', '${ocekavana}'::jsonb))`,
      );
      // KOTVA: podvrh projde a je posledním záznamem téhle akce — útok je skutečný
      expect(podvrh.ok, podvrh.ok ? "" : podvrh.err).toBe(true);
      expect(
        await sql(PROBE, `SELECT user_id FROM public.audit_journal WHERE action = 'seed.duplicates_left' ORDER BY created_at DESC, id DESC LIMIT 1`),
      ).toBe(UZIV);

      // člověk vrátí E#1 z karantény → kopie je zase shodná → heal ji sloučí a ZAPÍŠE výsledek
      await sql(PROBE, `UPDATE public.knowledge_items SET quarantine_status = 'clear', quarantine_reason = NULL WHERE id = '${e1}'`);
      await skript(PROBE, blokHeals("seed-bez-duplicit"));
      expect(await existuje("public.knowledge_items", e1)).toBe(false);
      expect(await zaznamy("seed.duplicates_merged")).toBe("2");
      expect(
        await sql(
          PROBE,
          `SELECT coalesce(user_id::text, 'heal') || '|' || jsonb_array_length(metadata->'ponechane') || '|' || ((metadata->'ponechane') = '${ocekavana}'::jsonb)
             FROM public.audit_journal WHERE action = 'seed.duplicates_left' ORDER BY created_at DESC, id DESC LIMIT 1`,
        ),
        "heal svůj záznam podle podvrhu potlačil",
      ).toBe("heal|2|true");
    });

    it("útočník (člen i admin přes role PostgREST) globální položku tvaru seedu nezaloží ani nepřepíše", async () => {
      const vzor = await id("Editorial Grid Layout#1"); // ponechaná kopie A (nese slug)
      const tvarSeedu = `INSERT INTO public.knowledge_items (item_type, source_type, title, body_markdown, summary, ai_context_tags, category, is_verified)
                         SELECT item_type, 'manual', title, body_markdown, summary, ai_context_tags, 'occipitum', true
                           FROM public.knowledge_items WHERE id = '${vzor}' RETURNING id`;
      for (const [kdo, sub] of [["člen", UZIV], ["admin", ADMIN]] as const) {
        const vlozeni = await jako("authenticated", sub, tvarSeedu);
        expect(vlozeni.ok, `${kdo}: přímý INSERT tvaru seedu prošel`).toBe(false);
        if (!vlozeni.ok) expect(vlozeni.err).toMatch(/row-level security/);
        const prepis = await jako(
          "authenticated",
          sub,
          `UPDATE public.knowledge_items SET ai_instructions = 'podvrh' WHERE id = '${vzor}' RETURNING id`,
        );
        expect(prepis.ok && prepis.out.split("\n").some((r) => r.trim() === vzor), `${kdo}: přepsal položku seedu`).toBe(false);
        const globalni = await jako(
          "authenticated",
          sub,
          `SELECT public.upsert_story_knowledge_item_audited(p_story_id => NULL, p_title => 'Editorial Grid Layout',
             p_body_markdown => 'x', p_item_type => 'playbook', p_category => 'occipitum')`,
        );
        expect(globalni.ok, `${kdo}: RPC založilo globální položku`).toBe(false);
      }
      // admin smí založit položku PŘÍBĚHU s doslovným obsahem seedu — ta tvar seedu nemá (story, autor)
      // a heal ji nechá
      const vPribehu = await jako(
        "authenticated",
        ADMIN,
        `SELECT public.upsert_story_knowledge_item_audited(p_story_id => '${STORY}', p_title => k.title,
           p_body_markdown => k.body_markdown, p_item_type => 'playbook', p_category => 'occipitum')
           FROM public.knowledge_items k WHERE k.id = '${vzor}'`,
      );
      expect(vPribehu.ok, vPribehu.ok ? "" : vPribehu.err).toBe(true);
      const novaId = vPribehu.ok ? vPribehu.out.split("\n").map((r) => r.trim()).find((r) => /^[0-9a-f-]{36}$/.test(r)) ?? "" : "";
      const predHealem = await radek("public.knowledge_items", novaId);
      expect(predHealem, "položka příběhu nevznikla — sonda by nic neměřila").toMatch(/"story_id":"/);
      await skript(PROBE, blokHeals("seed-bez-duplicit"));
      expect(await radek("public.knowledge_items", novaId)).toBe(predHealem);

      // KOTVA: tentýž řádek zapsaný pod vlastníkem DB (BYPASSRLS jako service_role) heal za kopii
      // seedu MÁ — sonda tedy míří na skutečný výběr healu, ne vedle (transakce se vrátí)
      const kotva = await sql(
        PROBE,
        `BEGIN;
         CREATE TEMP TABLE podvrh (id uuid) ON COMMIT DROP;
         WITH n AS (${tvarSeedu}) INSERT INTO podvrh SELECT id FROM n;
         ${blokHeals("seed-bez-duplicit")}
         SELECT count(*) FROM public.knowledge_items WHERE id IN (SELECT id FROM podvrh);
         ROLLBACK;`,
      ).catch((e) => String((e as { stderr?: string }).stderr ?? e));
      expect(kotva.split("\n").map((r) => r.trim()), "řádek tvaru seedu od vlastníka heal nesloučil — sonda míří vedle").toContain("0");
    });

    it("seed HEAD 2× po healu nic nepřidá a cizí položky nechá", async () => {
      const pocty = () =>
        sql(PROBE, `SELECT (SELECT count(*) FROM public.knowledge_items) || '|' || (SELECT count(*) FROM public.ai_golden_examples)`);
      const predSeedem = await pocty();
      await soubor(PROBE, SEED_HEAD);
      await soubor(PROBE, SEED_HEAD);
      expect(await pocty()).toBe(predSeedem);
      for (const j of CIZI) {
        expect(await radek("public.knowledge_items", await id(j)), `položka ${j} se změnila`).toBe(pred[j]);
      }
    });
  });
});
