-- Function: public.mcp_request_unblock
-- Arguments: p_rule_id uuid, p_justification text, p_session_id uuid
-- Security: SECURITY DEFINER (writes a pending decision row; never auto-approves)
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Purpose: Agent flags that a rule feels mis-applied to its current context and
--          requests a temporary relaxation. NEVER auto-approves — inserts a row
--          into moderation_decisions with accepted=NULL (pending). The user (or
--          a senior reviewer) decides via Dirigent UI / n8n approval flow.

CREATE OR REPLACE FUNCTION public.mcp_request_unblock(
  p_rule_id uuid,
  p_justification text,
  p_session_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_decision_id uuid;
  v_session_id uuid;
  v_rule_slug text;
  v_rule_title text;
BEGIN
  -- Auth: require authenticated caller (writes to moderation_decisions + audit)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_rule_id IS NULL OR coalesce(trim(p_justification), '') = '' THEN
    RETURN jsonb_build_object('error', 'rule_id and non-empty justification required');
  END IF;

  -- Resolve rule for evidence + sanity check
  SELECT slug, title INTO v_rule_slug, v_rule_title
  FROM expert_rules
  WHERE id = p_rule_id;

  IF v_rule_slug IS NULL THEN
    RETURN jsonb_build_object('error', 'rule not found', 'rule_id', p_rule_id);
  END IF;

  -- Use provided session_id or fall back to a synthetic one for traceability.
  v_session_id := COALESCE(p_session_id, gen_random_uuid());

  INSERT INTO moderation_decisions (
    session_id, decision_type, severity, context, recommendation, evidence, accepted
  ) VALUES (
    v_session_id,
    'unblock_request',
    'warn',
    jsonb_build_object(
      'rule_id', p_rule_id,
      'rule_slug', v_rule_slug,
      'rule_title', v_rule_title
    ),
    'Agent requests relaxation of rule "' || v_rule_slug || '". Justification: ' || p_justification,
    jsonb_build_object('justification', p_justification),
    NULL  -- pending review
  )
  RETURNING id INTO v_decision_id;

  -- Audit trail
  INSERT INTO audit_journal (action_type, action, entity_type, entity_id, area, severity, summary, metadata)
  VALUES (
    'create', 'mcp_request_unblock', 'moderation_decisions', v_decision_id::text,
    'aisha-supervisor', 'warn',
    'Agent requested unblock for rule ' || v_rule_slug,
    jsonb_build_object('rule_id', p_rule_id, 'session_id', v_session_id)
  );

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'status', 'pending_review',
    'rule_slug', v_rule_slug,
    'note', 'Request logged. Decision pending — agent should proceed without relying on relaxation.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_request_unblock(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_request_unblock(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_request_unblock(uuid, text, uuid) TO service_role;
