/**
 * RAG golden set po seedu: platformní sada (plat-*) označuje AKTIVNÍ knowledge_items v DB.
 *
 * Statická brána (rag-golden-nad-platformnim-obsahem) čte SQL soubory a ví, co je seed/core.
 * Tenhle test ověří na databázi po skutečném seedu, že položky platformní sady prošly
 * INSERTem, jsou `active`, nejsou v karanténě a mají source_slug, ze kterého
 * mcp_search_knowledge_v3 skládá chunk_slug (`<source_slug>:<index>`). Starší řádky
 * (rp-*, es-*, …) se tu neměří: throwaway DB nese DEMO seed, takže by jejich demo labely
 * prošly, i když na produkční instanci bez demo KB nemají obsah.
 *
 * ⛔ NAMĚŘENO 2026-09-13: 26 labelů v 15 otázkách odkazovalo na obsah, který seed/core
 * nezakládá; česky byly nad platformním obsahem označené jen 2 otázky.
 *
 * Běh: node scripts/db/with-throwaway-db.mjs -- npx vitest run src/tests/db/rag-golden-platformni-obsah-runtime.test.ts
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
    { encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

describe.skipIf(!isPgReachable())("RAG golden set označuje obsah, který v DB po seedu je", () => {
  it("kontrolní vzorek: golden set i platformní položky v DB jsou", () => {
    expect(Number(psql(`SELECT count(*) FROM public.rag_eval_golden WHERE status = 'active'`))).toBeGreaterThan(20);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug = 'aisha-platform-overview' AND status = 'active'`)).toBe("1");
  });

  it("⛔ žádný label platformní sady nemíří mimo aktivní, nekaranténní knowledge_items", () => {
    const chybi = psql(`
      SELECT coalesce(string_agg(g.slug || ' → ' || e.label, E'\\n' ORDER BY g.slug, e.label), '')
        FROM public.rag_eval_golden g
        CROSS JOIN LATERAL unnest(g.expected_chunk_slugs) AS e(label)
       WHERE g.status = 'active'
         AND g.slug LIKE 'plat-%'
         AND NOT EXISTS (
           SELECT 1 FROM public.knowledge_items ki
            WHERE ki.source_slug = regexp_replace(e.label, ':[0-9]+$', '')
              AND ki.status = 'active'
              AND ki.quarantine_status NOT IN ('flagged', 'quarantined'))`);
    expect(chybi, "labely bez obsahu v DB").toBe("");
  });

  it("platformní sada má označené otázky v češtině i angličtině", () => {
    const pocty = psql(`
      SELECT string_agg(language || '=' || n, ',' ORDER BY language) FROM (
        SELECT language, count(*) AS n FROM public.rag_eval_golden
         WHERE status = 'active' AND slug LIKE 'plat-%' AND cardinality(expected_chunk_slugs) > 0
         GROUP BY language) t`);
    const mapa = Object.fromEntries(pocty.split(",").map((p) => p.split("=")));
    expect(Number(mapa.cs ?? 0)).toBeGreaterThanOrEqual(5);
    expect(Number(mapa.en ?? 0)).toBeGreaterThanOrEqual(5);
  });
});
