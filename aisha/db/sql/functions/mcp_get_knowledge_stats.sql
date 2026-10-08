-- Function: mcp_get_knowledge_stats

CREATE OR REPLACE FUNCTION public.mcp_get_knowledge_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total_items', (SELECT count(*) FROM knowledge_items WHERE status = 'active'),
      'total_chunks', (SELECT count(*) FROM knowledge_chunks),
      'total_embeddings', (SELECT count(*) FROM knowledge_embeddings),
      'items_by_type', COALESCE(
        (SELECT jsonb_object_agg(item_type::text, cnt)
         FROM (
           SELECT item_type, count(*) as cnt
           FROM knowledge_items
           WHERE status = 'active'
           GROUP BY item_type
         ) sub),
        '{}'::jsonb
      ),
      'items_by_category', COALESCE(
        (SELECT jsonb_object_agg(COALESCE(category, 'uncategorized'), cnt)
         FROM (
           SELECT category, count(*) as cnt
           FROM knowledge_items
           WHERE status = 'active'
           GROUP BY category
         ) sub),
        '{}'::jsonb
      ),
      'embedding_coverage', (
        SELECT jsonb_build_object(
          'items_with_chunks', (SELECT count(DISTINCT knowledge_item_id) FROM knowledge_chunks),
          'chunks_with_embeddings', (SELECT count(DISTINCT chunk_id) FROM knowledge_embeddings)
        )
      )
    )
  );
END;
$function$;

-- Pohled správy na CELÝ korpus: počítá i položky příběhů a položky v karanténě a klíče
-- items_by_category nesou názvy kategorií. Čtou ho nástroje správy služby znalostí a sonda
-- pokrytí korpusu, obojí servisní rolí — nikomu jinému vydaný není. Do 2026-10-04 ho přes
-- PostgREST spustil i nepřihlášený. Web a mobil mají vlastní počty (fn_get_platform_warmup_state).
REVOKE ALL ON FUNCTION mcp_get_knowledge_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_stats() TO service_role;
