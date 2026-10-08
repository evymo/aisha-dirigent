/**
 * Platformní dopočet vektorů v1 — ŽIVÁ identita a co se přepočítá (RUNTIME).
 *
 * ⛔ 2026-09-29 (riq, jen čtení): vektorový index zamrzl k 30. 8. a z 90 866 vektorů nesl
 * 47 280 jméno živého modelu `bge-m3-embedding`, ale z JINÉHO runtime (sentence-transformers
 * fp32, model_version 5617a9f6…), a 43 586 jiné jméno (MLX). Majitel: přepočítat „samo na
 * serveru", nahradit na místě. Živý vektor = jméno modelu resolveru v1 + `<formát>:<pin>` vah
 * (deklarace v ai_model_registry.provider_metadata.declared; jediný domov fn_ziva_identita_v1).
 *
 * Měří se:
 *   - výběr: chybějící, starý runtime (totéž jméno, jiná verze), jiný model → ANO;
 *     živý (jakýkoli recept) a vynechaný pro TUTÉŽ identitu → NE; nejstarší položky první;
 *   - vynechání je idempotentní a jen pro service_role;
 *   - discovery (upsert_discovered_model) přepíše změřená metadata celá, ale `declared` zachová;
 *   - dopočet a měření pokrytí v brokeru (zmerPokrytiVektoru) čtou TUTÉŽ živou identitu.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";
import { zmerPokrytiVektoru } from "../../../services/svc-source-broker/src/clients/li-driver.js";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const MODEL = `test-embed-${RUN}`;
const PIN = "a".repeat(64);
const ID = `gguf:${PIN}`;
const SLUZBA = '{"role":"service_role"}';

function psql(sql: string, claims?: string, role?: string): string {
  const pre = ["\\o /dev/null", claims ? `SET request.jwt.claims = '${claims}';` : "", role ? `SET ROLE ${role};` : "", "\\o"].join("\n");
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${pre}\n${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const jako = (sql: string, claims?: string, role?: string) => {
  try {
    return { ok: true as const, out: psql(sql, claims, role) };
  } catch (e) {
    return { ok: false as const, err: String((e as { stderr?: string }).stderr ?? e) };
  }
};

const I1 = randomUUID(); // starší položka
const I2 = randomUUID(); // novější položka
const C = Object.fromEntries(["bez", "zivy", "st", "mlx", "vynech", "vynechJina", "novejsi"].map((k) => [k, randomUUID()]));
const vek = "array_fill(0.1::real, ARRAY[1024])::vector";

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("dopočet vektorů v1: živá identita", () => {
  it("příprava: dvě položky, chunky ve všech stavech", () => {
    psql(`INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, created_at)
          VALUES ('${I1}', 'domain_doc', 'starší ${RUN}', 'x', now() - interval '30 days'),
                 ('${I2}', 'domain_doc', 'novější ${RUN}', 'x', now())`);
    const chunk = (id: string, item: string, i: number) =>
      `('${id}', '${item}', ${i}, 'text ${i}', 'global')`;
    psql(`INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale) VALUES
          ${[chunk(C.bez, I1, 0), chunk(C.zivy, I1, 1), chunk(C.st, I1, 2), chunk(C.mlx, I1, 3),
             chunk(C.vynech, I1, 4), chunk(C.vynechJina, I1, 5), chunk(C.novejsi, I2, 0)].join(", ")}`);
    const emb = (chunkId: string, model: string, verze: string) =>
      `('${chunkId}', '${I1}', ${vek}, '${model}', '${verze}', 'global')`;
    psql(`INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, model, model_version, locale) VALUES
          ${[emb(C.zivy, MODEL, `${ID};recipe=embed_text_v1`),
             emb(C.st, MODEL, "5617a9f61b028005a4858fdac845db406aefb181"),
             emb(C.mlx, "mlx-community/bge-m3-mlx-fp16", "a37eddded9a6a1273a87fb8b0da0d1cdbd98aeec")].join(", ")}`);
    psql(`SELECT public.fn_record_embedding_vynechani('${C.vynech}', 'global', '${ID}', 'nad_limitem', 600)`, SLUZBA);
    psql(`SELECT public.fn_record_embedding_vynechani('${C.vynechJina}', 'global', 'gguf:${"b".repeat(64)}', 'nad_limitem', 600)`, SLUZBA);
  });

  it("výběr: chybějící, starý runtime i jiný model ANO; živý a vynechaný pro tutéž identitu NE", () => {
    const out = psql(`SELECT chunk_id FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${ID}', 512, 200)
                       WHERE knowledge_item_id IN ('${I1}', '${I2}')`, SLUZBA, "service_role");
    const vybrane = out.split("\n").filter(Boolean);
    expect(new Set(vybrane)).toEqual(new Set([C.bez, C.st, C.mlx, C.vynechJina, C.novejsi]));
    expect(vybrane).not.toContain(C.zivy);
    expect(vybrane, "vynechání platí jen pro TUTÉŽ identitu").not.toContain(C.vynech);
    expect(vybrane.indexOf(C.novejsi), "nejstarší položky první").toBe(vybrane.length - 1);
  });

  it("vrací identitu a strop pro zápis receptu; neplatná identita = chyba", () => {
    const r = psql(`SELECT identita || '|' || max_tokens FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${ID}', 512, 1)`, SLUZBA, "service_role");
    expect(r).toBe(`${ID}|512`);
    const spatne = jako(`SELECT count(*) FROM public.fn_chunks_bez_zive_identity('${MODEL}', 'gguf:kratky', 512, 1)`, SLUZBA, "service_role");
    expect(spatne.ok).toBe(false);
  });

  it("identita = deklarovaný FORMÁT vah + sha (embedder na GPU: pytorch/safetensors), ne napevno gguf", () => {
    const pytorch = `pytorch:${PIN}`;
    const r = psql(`SELECT identita FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${pytorch}', 512, 1)`, SLUZBA, "service_role");
    expect(r).toBe(pytorch);
    for (const vadna of [`PyTorch:${PIN}`, `:${PIN}`, `pytorch ${PIN}`, `pytorch:${PIN}x`]) {
      const v = jako(`SELECT count(*) FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${vadna}', 512, 1)`, SLUZBA, "service_role");
      expect(v.ok, vadna).toBe(false);
    }
  });

  it("dopočet skládá identitu z DEKLAROVANÉHO formátu vah; bez declared.weights_format výjimka (gguf se nedosazuje)", () => {
    const prov = `test-prov-fmt-${RUN}`;
    const mdl = `test-embed-fmt-${RUN}`;
    // V transakci (ROLLBACK): resolver prostoru v1 vybere JEN testovací model — ostatní embedding modely nedostupné.
    const sql = (meta: string) => `\\o /dev/null
BEGIN;
UPDATE public.ai_model_registry SET is_available = false WHERE is_embedding;
INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind) VALUES ('${prov}', 'test', 'local_vllm');
INSERT INTO public.ai_model_registry (provider, model_id, is_embedding, is_available, is_deprecated, embedding_dimensions, provider_metadata, provider_registry_id)
  SELECT '${prov}', '${mdl}', true, true, false, 1024, '${meta}'::jsonb, id FROM public.ai_provider_registry WHERE slug = '${prov}';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '${SLUZBA}';
\\o
SELECT DISTINCT identita FROM public.fn_get_chunks_needing_v1(5);
\\o /dev/null
ROLLBACK`;
    const s = psql(sql(`{"declared": {"weights_sha256": "${PIN}", "weights_format": "pytorch", "max_tokens": 512}}`));
    expect(s.split("\n").filter(Boolean)).toEqual([`pytorch:${PIN}`]);
    const bez = jako(sql(`{"declared": {"weights_sha256": "${PIN}", "max_tokens": 512}}`));
    expect(bez.ok, "bez deklarovaného formátu se identita nesmí dosadit").toBe(false);
  });

  it("jen service_role: authenticated výběr ani vynechání nezavolá", () => {
    const claims = `{"sub":"${randomUUID()}","role":"authenticated"}`;
    for (const sql of [
      `SELECT count(*) FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${ID}', 512, 1)`,
      `SELECT public.fn_record_embedding_vynechani('${C.bez}', 'global', '${ID}', 'nad_limitem', 1)`,
    ]) {
      const r = jako(sql, claims, "authenticated");
      expect(r.ok, sql).toBe(false);
    }
  });

  it("jen role služby: stráž odmítne přihlášeného, i když EXECUTE má (auth.uid() ≠ NULL NENÍ nárok)", () => {
    // Superuživatelské spojení EXECUTE má vždy — rozhoduje jen stráž v těle funkce.
    const prihlaseny = `{"sub":"${randomUUID()}","role":"authenticated"}`;
    for (const sql of [
      `SELECT count(*) FROM public.fn_ziva_identita_v1()`,
      `SELECT count(*) FROM public.fn_get_chunks_needing_v1(1)`,
      `SELECT count(*) FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${ID}', 512, 1)`,
      `SELECT public.fn_record_embedding_vynechani('${C.bez}', 'global', '${ID}', 'nad_limitem', 1)`,
    ]) {
      const r = jako(sql, prihlaseny);
      expect(r.ok, sql).toBe(false);
      if (!r.ok) expect(r.err, sql).toMatch(/jen role služby/);
    }
  });

  it("granty: anon ani authenticated EXECUTE nemají ani na forku s výchozím EXECUTE pro authenticated; search_path zpevněný", () => {
    // Fork s výchozími oprávněními platformy pro authenticated: dají EXECUTE KAŽDÉ nové funkci a
    // REVOKE … FROM PUBLIC ho neodebere. V transakci (ROLLBACK) funkce zahodit a založit znovu ze SoT.
    const sot = (jmeno: string) => join(process.cwd(), "aisha/db/sql/functions", `${jmeno}.sql`);
    const FUNKCE = ["fn_chunks_bez_zive_identity", "fn_get_chunks_needing_v1", "fn_record_embedding_vynechani", "fn_ziva_identita_v1"];
    const kotva = `zz_kotva_acl_${RUN}`;
    const out = psql(`\\o /dev/null
BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
DROP FUNCTION public.fn_get_chunks_needing_v1(integer);
DROP FUNCTION public.fn_ziva_identita_v1();
DROP FUNCTION public.fn_chunks_bez_zive_identity(text, text, integer, integer);
DROP FUNCTION public.fn_record_embedding_vynechani(uuid, text, text, text, integer);
\\i ${sot("fn_chunks_bez_zive_identity")}
\\i ${sot("fn_ziva_identita_v1")}
\\i ${sot("fn_get_chunks_needing_v1")}
\\i ${sot("fn_record_embedding_vynechani")}
CREATE FUNCTION public.${kotva}() RETURNS integer LANGUAGE sql AS 'SELECT 1';
REVOKE ALL ON FUNCTION public.${kotva}() FROM PUBLIC;
\\o
SELECT p.proname || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|'
       || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|'
       || has_function_privilege('service_role', p.oid, 'EXECUTE') || '|' || coalesce(array_to_string(p.proconfig, ','), '')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (${[...FUNKCE, kotva].map((x) => `'${x}'`).join(", ")})
 ORDER BY p.proname;
\\o /dev/null
ROLLBACK`);
    const radky = Object.fromEntries(out.split("\n").filter(Boolean).map((r) => [r.split("|")[0], r.split("|").slice(1)]));
    // kotva: simulace výchozích oprávnění opravdu dává authenticated EXECUTE (a REVOKE FROM PUBLIC ho nebere)
    expect(radky[kotva]?.slice(0, 2), "simulace forku nedala authenticated EXECUTE — test by nic neměřil").toEqual(["true", "true"]);
    for (const jmeno of FUNKCE) {
      expect(radky[jmeno]?.slice(0, 3), jmeno).toEqual(["false", "false", "true"]);
      expect(radky[jmeno]?.[3], jmeno).toBe("search_path=pg_catalog, public, pg_temp");
    }
  });

  it("vynechání je idempotentní", () => {
    psql(`SELECT public.fn_record_embedding_vynechani('${C.vynech}', 'global', '${ID}', 'nad_limitem', 700)`, SLUZBA);
    expect(psql(`SELECT count(*) || '|' || max(tokenu) FROM public.knowledge_embedding_vynechani WHERE chunk_id = '${C.vynech}'`)).toBe("1|700");
  });

  it("JEDNA živá identita: dopočet i měření pokrytí v brokeru čtou fn_ziva_identita_v1 — ne-gguf formát shodně", async () => {
    const prov = `test-prov-ziva-${RUN}`;
    const mdl = `test-embed-ziva-${RUN}`;
    const story = randomUUID();
    const item = randomUUID();
    // Počty záměrně nesouměrné (2 živé : 1 jiný formát): měření s formátem napevno by je prohodilo.
    const K = { zivy: randomUUID(), zivy2: randomUUID(), gguf: randomUUID(), bez: randomUUID() };
    const c = new pg.Client({ host: PG_HOST, port: Number(PG_PORT), user: PG_USER, password: PG_PASSWORD, database: PG_DATABASE });
    const varovani: string[] = [];
    const log = { warn: (o: { err?: string }, m?: string) => varovani.push(`${m} ${o?.err ?? ""}`) } as unknown as
      Parameters<typeof zmerPokrytiVektoru>[3];
    await c.connect();
    try {
      // V transakci (ROLLBACK): resolver prostoru v1 vybere JEN testovací model.
      await c.query("BEGIN");
      await c.query("UPDATE public.ai_model_registry SET is_available = false WHERE is_embedding");
      await c.query("INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind) VALUES ($1, 'test', 'local_vllm')", [prov]);
      await c.query(
        `INSERT INTO public.ai_model_registry (provider, model_id, is_embedding, is_available, is_deprecated, embedding_dimensions, provider_metadata, provider_registry_id)
           SELECT $1, $2, true, true, false, 1024, $3::jsonb, id FROM public.ai_provider_registry WHERE slug = $1`,
        [prov, mdl, JSON.stringify({ declared: { weights_sha256: PIN, weights_format: "pytorch", max_tokens: 512 } })],
      );
      await c.query("INSERT INTO public.partner_stories (id, title) VALUES ($1, $2)", [story, `pokrytí ${RUN}`]);
      // nejstarší položka — dopočet bere nejstarší první, jiné chunky DB ji nepředběhnou
      await c.query(
        `INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, story_id, category, created_at)
         VALUES ($1, 'domain_doc', $2, 'x', $3, 'contract', now() - interval '100 years')`,
        [item, `identita ${RUN}`, story],
      );
      await c.query(
        `INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale)
         VALUES ($1, $5, 0, 'a', 'global'), ($2, $5, 1, 'b', 'global'), ($3, $5, 2, 'c', 'global'), ($4, $5, 3, 'd', 'global')`,
        [K.zivy, K.zivy2, K.gguf, K.bez, item],
      );
      // živý = deklarovaný formát; týž sha s JINÝM formátem = jiný runtime (starý), ne živý
      await c.query(
        `INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, model, model_version, locale)
         VALUES ($1, $4, ${vek}, $5, $6, 'global'), ($2, $4, ${vek}, $5, $6, 'global'), ($3, $4, ${vek}, $5, $7, 'global')`,
        [K.zivy, K.zivy2, K.gguf, item, mdl, `pytorch:${PIN};recipe=chunk_text_v1`, `gguf:${PIN};recipe=chunk_text_v1`],
      );
      await c.query(`SET LOCAL request.jwt.claims = '${SLUZBA}'`);
      await c.query("SET LOCAL ROLE service_role");

      const ziva = (await c.query("SELECT model_id, identita, max_tokens FROM public.fn_ziva_identita_v1()")).rows;
      expect(ziva).toEqual([{ model_id: mdl, identita: `pytorch:${PIN}`, max_tokens: 512 }]);
      const dopocet = (await c.query(
        "SELECT chunk_id, identita FROM public.fn_get_chunks_needing_v1(200) WHERE knowledge_item_id = $1", [item],
      )).rows;
      expect(new Set(dopocet.map((r) => r.chunk_id)), "dopočet: živý ne, jiný formát a chybějící ano").toEqual(new Set([K.gguf, K.bez]));
      expect(new Set(dopocet.map((r) => r.identita))).toEqual(new Set([`pytorch:${PIN}`]));

      const pokryti = await zmerPokrytiVektoru(c, story, `t-${RUN}`, log);
      expect(pokryti, varovani.join("; ")).toMatchObject({
        model: mdl, identita: `pytorch:${PIN}`, useku: 4, zivy: 2, stary_runtime: 1, jiny_model: 0, nad_limitem: 0, bez_vektoru: 1,
      });

      // Bez deklarovaného formátu: dopočet výjimka s návodem, měření NEZMĚŘENO (null) — ne nuly.
      await c.query("RESET ROLE");
      await c.query("UPDATE public.ai_model_registry SET provider_metadata = provider_metadata #- '{declared,weights_format}' WHERE provider = $1", [prov]);
      await c.query("SET LOCAL ROLE service_role");
      await c.query("SAVEPOINT bez_formatu");
      await expect(c.query("SELECT * FROM public.fn_get_chunks_needing_v1(1)")).rejects.toThrow(/declared\.weights_format.*NEDOSAZUJE.*Oprava/s);
      await c.query("ROLLBACK TO SAVEPOINT bez_formatu");
      expect(await zmerPokrytiVektoru(c, story, `t-${RUN}`, log)).toBeNull();
      expect(varovani.join("; ")).toMatch(/NEZMĚŘENO.*declared\.weights_format/s);
      await c.query("ROLLBACK TO SAVEPOINT bez_formatu");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.end();
    }
  });

  it("discovery přepíše změřená metadata celá, deklarované (`declared`) zachová", () => {
    psql(`INSERT INTO public.ai_model_registry (provider, model_id, is_embedding, provider_metadata)
          VALUES ('test-${RUN}', '${MODEL}', true,
                  '{"stary_zmereny": 1, "declared": {"weights_sha256": "${PIN}", "max_tokens": 512}}'::jsonb)`);
    psql(`SELECT public.upsert_discovered_model(p_provider => 'test-${RUN}', p_model_id => '${MODEL}',
            p_is_chat_capable => false, p_is_embedding => true, p_provider_metadata => '{"novy_zmereny": 2}'::jsonb)`, SLUZBA);
    const meta = JSON.parse(psql(`SELECT provider_metadata::text FROM public.ai_model_registry
                                   WHERE provider = 'test-${RUN}' AND model_id = '${MODEL}'`));
    expect(meta.novy_zmereny).toBe(2);
    expect(meta.stary_zmereny, "klíč, který sken přestal hlásit, nesmí zůstat").toBeUndefined();
    expect(meta.declared).toEqual({ weights_sha256: PIN, max_tokens: 512 });
  });
});
