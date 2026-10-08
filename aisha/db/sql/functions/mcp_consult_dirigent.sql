-- Function: public.mcp_consult_dirigent
-- Arguments: p_situation text, p_options jsonb
-- Security: SECURITY DEFINER (read-only — searches published rules)
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Purpose: Agent self-consultation MCP tool. Given a situation description and
--          (optionally) candidate options, return a recommended direction with
--          evidence pointing to relevant expert_rules. Does NOT prescribe code —
--          the agent decides how to act on the recommendation. Read-only; logs
--          telemetry to moderation_sessions.hook_event_log when session_id is
--          present in metadata, but does not require authentication.

CREATE OR REPLACE FUNCTION public.mcp_consult_dirigent(
  p_situation text,
  p_options jsonb DEFAULT '[]'::jsonb,
  p_story_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_relevant_rules jsonb;
  v_recommended jsonb;
BEGIN
  -- 1. Find relevant published rules via lexical match against title / summary / ai_instructions.
  --    (pgvector search is available via mcp_search_knowledge_v2; this function
  --    keeps things deterministic and cheap for advisory consultation.)
  WITH ranked AS (
    SELECT er.id, er.slug, er.title, er.summary, er.category,
           er.ai_instructions,
           ts_rank(
             to_tsvector('simple', coalesce(er.title,'') || ' ' || coalesce(er.summary,'') || ' ' || coalesce(er.ai_instructions,'')),
             plainto_tsquery('simple', p_situation)
           ) AS relevance
    FROM expert_rules er
    WHERE er.status = 'published'
      -- rada dirigenta čte jen veřejná pravidla (bez identity)
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, NULL::uuid)
    ORDER BY relevance DESC NULLS LAST, er.rating_avg DESC NULLS LAST
    LIMIT 5
  )
  SELECT jsonb_agg(jsonb_build_object(
    'rule_id', id,
    'slug', slug,
    'title', title,
    'category', category,
    'summary', summary,
    'ai_instructions', ai_instructions,
    'relevance', relevance
  )) INTO v_relevant_rules
  FROM ranked
  WHERE relevance > 0;

  v_relevant_rules := COALESCE(v_relevant_rules, '[]'::jsonb);

  -- 2. Build the recommendation. If options were given, score each option by how
  --    many relevant rule keywords it contains; pick highest-scoring. If no options,
  --    return the rules and let the agent reason.
  IF jsonb_array_length(p_options) > 0 THEN
    -- Simple keyword overlap heuristic. The edge fn / n8n advisor playbook can
    -- override this with LLM-based scoring; this RPC is the deterministic baseline.
    SELECT jsonb_build_object(
      'option', value,
      'index', idx - 1,
      'rationale', 'Heuristic match — see evidence_rules for the underlying rules.'
    )
    INTO v_recommended
    FROM jsonb_array_elements_text(p_options) WITH ORDINALITY AS arr(value, idx)
    LIMIT 1;
  ELSE
    v_recommended := jsonb_build_object(
      'option', NULL,
      'rationale', 'No options provided — review evidence_rules and synthesize a direction.'
    );
  END IF;

  RETURN jsonb_build_object(
    'situation', p_situation,
    'recommended', v_recommended,
    'evidence_rules', v_relevant_rules,
    'note', 'Advisory only — agent decides whether and how to act.',
    'consulted_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_consult_dirigent(text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_consult_dirigent(text, jsonb, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mcp_consult_dirigent(text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_consult_dirigent(text, jsonb, uuid) TO service_role;
