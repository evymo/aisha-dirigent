-- ============================================================================
-- Source of Truth: fn_get_run_extract_context
-- Step:  Step 7.2 (Hippocampus Graph extraction worker)
-- Used by: services/svc-mcp-knowledge/src/routes/graph-extract.ts
-- Migration: aisha/db/migrations/20260520040000_graph_extraction_worker.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_run_extract_context(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_run         jsonb;
  v_audit       jsonb;
  v_attribs     jsonb;
  v_memories    jsonb;
BEGIN
  SELECT to_jsonb(t) INTO v_run
    FROM (
      SELECT ar.id, ar.kind, ar.status, ar.started_at, ar.finished_at,
             ar.story_id, ar.route_plan, ar.metadata
        FROM public.ai_runs ar
       WHERE ar.id = p_run_id
    ) t;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'ai_run not found: %', p_run_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb)
    INTO v_audit
    FROM (
      SELECT aj.id, aj.action, aj.action_type, aj.severity, aj.summary,
             aj.metadata, aj.created_at
        FROM public.audit_journal aj
       WHERE aj.ai_run_id = p_run_id
         AND (
           aj.action LIKE 'hippocampus.%'
           OR aj.action LIKE 'knowledge.%'
           OR aj.action LIKE 'retrieval.%'
           OR aj.action LIKE 'critic.%'
           OR aj.action LIKE 'rag_eval.%'
           OR aj.action LIKE 'ingestion.%'
         )
       ORDER BY aj.created_at ASC
       LIMIT 50
    ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.attribution_weight DESC NULLS LAST), '[]'::jsonb)
    INTO v_attribs
    FROM (
      SELECT er.slug AS rule_slug, er.title AS rule_title,
             ki.id::text AS item_id, ki.title AS item_title, ki.item_type::text AS item_type,
             ka.attribution_weight, ka.usage_intensity, ka.relevance_score,
             LEFT(COALESCE(ka.context_used, ''), 400) AS context_used
        FROM public.knowledge_attribution ka
        LEFT JOIN public.expert_rules er ON er.id = ka.rule_id
        LEFT JOIN public.knowledge_items ki ON ki.id = ka.knowledge_item_id
       WHERE ka.ai_run_id = p_run_id
       ORDER BY ka.attribution_weight DESC NULLS LAST
       LIMIT 20
    ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.importance DESC NULLS LAST), '[]'::jsonb)
    INTO v_memories
    FROM (
      SELECT am.id::text, am.memory_type, am.importance,
             LEFT(COALESCE(am.content, ''), 200) AS content_excerpt
        FROM public.agent_memories am
       WHERE am.source_run_id = p_run_id
       ORDER BY am.importance DESC NULLS LAST
       LIMIT 10
    ) t;

  RETURN jsonb_build_object(
    'run',          v_run,
    'audit_events', v_audit,
    'attributions', v_attribs,
    'memories',     v_memories
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_run_extract_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_run_extract_context(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_run_extract_context(uuid) IS
  'Step 7.2: returns a single jsonb document aggregating an ai_run + its audit + attribution + memory context, ready to hand to the rag.graph_extract LLM.';
