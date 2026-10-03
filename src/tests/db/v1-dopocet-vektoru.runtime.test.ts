/**
 * Platformní dopočet vektorů v1 — ŽIVÁ identita a co se přepočítá (RUNTIME).
 *
 * ⛔ 2026-09-29 (riq, jen čtení): vektorový index zamrzl k 30. 8. a z 90 866 vektorů nesl
 * 47 280 jméno živého modelu `bge-m3-embedding`, ale z JINÉHO runtime (sentence-transformers
 * fp32, model_version 5617a9f6…), a 43 586 jiné jméno (MLX). Majitel: přepočítat „samo na
 * serveru", nahradit na místě. Živý vektor = jméno modelu resolveru v1 + `gguf:<pin>` vah
 * (deklarovaný pin v ai_model_registry.provider_metadata.declared).
 *
 * Měří se:
 *   - výběr: chybějící, starý runtime (totéž jméno, jiná verze), jiný model → ANO;
 *     živý (jakýkoli recept) a vynechaný pro TUTÉŽ identitu → NE; nejstarší položky první;
 *   - vynechání je idempotentní a jen pro service_role;
 *   - discovery (upsert_discovered_model) přepíše změřená metadata celá, ale `declared` zachová.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

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

  it("vynechání je idempotentní", () => {
    psql(`SELECT public.fn_record_embedding_vynechani('${C.vynech}', 'global', '${ID}', 'nad_limitem', 700)`, SLUZBA);
    expect(psql(`SELECT count(*) || '|' || max(tokenu) FROM public.knowledge_embedding_vynechani WHERE chunk_id = '${C.vynech}'`)).toBe("1|700");
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
