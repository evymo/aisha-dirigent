-- ============================================================================
-- Source of Truth: fn_get_chunks_needing_context
-- Popis: Worker pickup queue for contextual retrieval backfill (Step 1).
--        Returns chunks whose contextual_prefix is NULL, joined with parent
--        knowledge_item for prompt construction (title + body excerpt).
-- Caller: services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts
--         (both inline new-chunk path and WF_CHUNK_CONTEXT_BACKFILL batch path)
--
-- Step:   Step 1 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + service_role only
-- Audit:  N/A — read-only pickup, no audit row per worker poll
-- Source migration: aisha/db/migrations/20260518210000_contextual_retrieval.sql
-- ============================================================================

-- Brick3 locale axis: locale added to RETURNS TABLE.
-- Bez DROP: návratový tvar s `locale` (Brick3, 2026-06-28) má i nejstarší podporovaná databáze
-- (dno 2026-07-29), takže CREATE OR REPLACE stačí. Soubor je v heals — DROP téže signatury by
-- běžel při každém migrate a nic nepřidal.

CREATE OR REPLACE FUNCTION public.fn_get_chunks_needing_context(
  p_batch_size integer DEFAULT 20,
  p_item_id    uuid    DEFAULT NULL
)
RETURNS TABLE (
  chunk_id            uuid,
  knowledge_item_id   uuid,
  chunk_index         integer,
  chunk_text          text,
  item_title          text,
  item_body_markdown  text,
  section_title       text,
  locale              text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT kc.id, kc.knowledge_item_id, kc.chunk_index, kc.chunk_text,
         ki.title, ki.body_markdown, kc.section_title, kc.locale
    FROM public.knowledge_chunks kc
    JOIN public.knowledge_items ki ON ki.id = kc.knowledge_item_id
   WHERE kc.contextual_prefix IS NULL
     AND ki.status = 'active'
     -- Jen položka v čitelném stavu: úryvek i tělo položky jdou modelu, který kontext píše.
     AND public.knowledge_state_readable(ki.quarantine_status)
     AND (p_item_id IS NULL OR kc.knowledge_item_id = p_item_id)
   ORDER BY kc.knowledge_item_id, kc.chunk_index
   LIMIT p_batch_size;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_chunks_needing_context(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_chunks_needing_context(integer, uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_chunks_needing_context(integer, uuid) IS
  'Backfill / new-chunk worker queue: returns up to p_batch_size chunks (from active items in a readable safety state) whose contextual_prefix is NULL. Service-role only.';
