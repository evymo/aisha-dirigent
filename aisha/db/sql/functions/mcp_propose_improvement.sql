-- Function: public.mcp_propose_improvement
-- Arguments: p_rule_id uuid, p_suggestion text, p_rationale text
-- Security: SECURITY DEFINER (writes a draft proposal — never auto-applies)
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Purpose: Agent suggests an improvement to a rule (or to platform behavior in
--          general) based on what it observed. Inserts into improvement_proposals
--          with status='draft' for human review. Mirrors the proposer_mode of
--          participant.ts in the VS Code extension.

CREATE OR REPLACE FUNCTION public.mcp_propose_improvement(
  p_rule_id uuid,
  p_suggestion text,
  p_rationale text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal_id uuid;
  v_rule_slug text;
  v_rule_title text;
  v_proposed_value jsonb;
BEGIN
  -- Auth: require authenticated caller (writes to improvement_proposals + audit)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_rule_id IS NULL OR coalesce(trim(p_suggestion), '') = '' THEN
    RETURN jsonb_build_object('error', 'rule_id and non-empty suggestion required');
  END IF;

  SELECT er.slug, er.title INTO v_rule_slug, v_rule_title
  FROM expert_rules er
  WHERE er.id = p_rule_id
    -- pravidlo, které volající nevidí, je pro něj „nenalezeno“ (viditelnost pravidel, revize B1)
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid());

  IF v_rule_slug IS NULL THEN
    RETURN jsonb_build_object('error', 'rule not found', 'rule_id', p_rule_id);
  END IF;

  v_proposed_value := jsonb_build_object(
    'rule_id', p_rule_id,
    'rule_slug', v_rule_slug,
    'suggested_change', p_suggestion
  );

  INSERT INTO improvement_proposals (
    proposal_type, status, title, description, proposed_value, rationale,
    source, priority, category, risk_level, agent_slug, metadata
  ) VALUES (
    'rule_improvement',
    'draft',
    'Rule improvement: ' || v_rule_slug,
    p_suggestion,
    v_proposed_value,
    coalesce(p_rationale, 'Submitted via mcp_propose_improvement (autonomous agent observation).'),
    'mcp_propose_improvement',
    5,
    'expert_rules',
    'low',
    'aisha-claude-code',
    jsonb_build_object('rule_id', p_rule_id, 'origin', 'claude_code_agent')
  )
  RETURNING id INTO v_proposal_id;

  -- Audit
  INSERT INTO audit_journal (action_type, action, entity_type, entity_id, area, severity, summary, metadata)
  VALUES (
    'create', 'mcp_propose_improvement', 'improvement_proposals', v_proposal_id::text,
    'aisha-supervisor', 'info',
    'Agent proposed improvement for rule ' || v_rule_slug,
    jsonb_build_object('rule_id', p_rule_id)
  );

  RETURN jsonb_build_object(
    'proposal_id', v_proposal_id,
    'status', 'draft',
    'rule_slug', v_rule_slug,
    'note', 'Proposal logged for human review. No automatic application.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_propose_improvement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_propose_improvement(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_propose_improvement(uuid, text, text) TO service_role;
