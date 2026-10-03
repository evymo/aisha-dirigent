-- Function: approve_improvement_proposal_admin
-- Schválení návrhu zlepšení; s p_auto_apply ho i aplikuje na agent_catalog.
-- Snapshot původního stavu jde do current_value (podklad pro rollback).
--
-- Oprava 2026-09-28 (SELF_IMPROVEMENT_LOOP.md §3, K-05) — naměřeno na main 9087ef3df:
--   `fn_create_improvement_proposal` proposal_type NIKDY nenastaví (je NULL) a proposed_value
--   nevyplní. Auto-apply pak prošel `CASE … ELSE NULL` a PŘESTO zapsal status 'applied'
--   a vrátil 'applied' — „aplikováno" bez jediné změny; outcome review a rollback pak
--   měřily a vracely změnu, která nikdy nenastala. Stejně lhal výsledek, když agent
--   neexistoval nebo proposed_value nic neměnil.
-- Teď: 'applied' jen tehdy, když se agent_catalog SKUTEČNĚ změnil. Jinak zůstane
-- 'approved' (schválení platí) a výsledek řekne proč se neaplikovalo (fail-closed):
--   agent_not_found · type_not_auto_appliable · no_effective_change.
-- Funkce nebyla v heals — běžící DB držela verzi z cold startu.

CREATE OR REPLACE FUNCTION public.approve_improvement_proposal_admin(
  p_auto_apply boolean DEFAULT false,
  p_proposal_id uuid DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agent        record;
  v_proposal     record;
  v_new_model    text;
  v_new_overrides jsonb;
  v_new_allowed  text[];
  v_new_denied   text[];
  v_applied      boolean := false;
  v_reason       text := NULL;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  IF p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'proposal_id is required' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_proposal
  FROM improvement_proposals
  WHERE id = p_proposal_id AND status IN ('pending', 'pending_review', 'auto_approved')
  FOR UPDATE;

  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'Proposal not found or not in reviewable status' USING ERRCODE = 'P0002';
  END IF;

  UPDATE improvement_proposals
  SET reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = p_review_note,
      status = 'approved'
  WHERE id = p_proposal_id;

  IF p_auto_apply THEN
    IF v_proposal.agent_slug IS NOT NULL THEN
      SELECT * INTO v_agent
      FROM agent_catalog
      WHERE slug = v_proposal.agent_slug
      FOR UPDATE;
    END IF;

    IF v_agent IS NULL THEN
      v_reason := 'agent_not_found';
    ELSIF v_proposal.proposal_type IS DISTINCT FROM 'model_change'
      AND v_proposal.proposal_type IS DISTINCT FROM 'tool_config_change' THEN
      -- Neznámý i chybějící typ = nic se neaplikuje (fail-closed). Schválení platí.
      v_reason := 'type_not_auto_appliable';
    ELSE
      -- Cílový stav z proposed_value; co návrh neuvádí, zůstává.
      v_new_model := v_agent.default_model;
      v_new_overrides := v_agent.model_overrides;
      v_new_allowed := v_agent.allowed_tools;
      v_new_denied := v_agent.denied_tools;

      IF v_proposal.proposal_type = 'model_change' THEN
        v_new_model := COALESCE(v_proposal.proposed_value->>'default_model', v_agent.default_model);
        IF v_proposal.proposed_value ? 'model_overrides' THEN
          v_new_overrides := v_proposal.proposed_value->'model_overrides';
        END IF;
      ELSE
        IF v_proposal.proposed_value ? 'allowed_tools' THEN
          v_new_allowed := ARRAY(SELECT jsonb_array_elements_text(v_proposal.proposed_value->'allowed_tools'));
        END IF;
        IF v_proposal.proposed_value ? 'denied_tools' THEN
          v_new_denied := ARRAY(SELECT jsonb_array_elements_text(v_proposal.proposed_value->'denied_tools'));
        END IF;
      END IF;

      IF v_new_model IS NOT DISTINCT FROM v_agent.default_model
        AND v_new_overrides IS NOT DISTINCT FROM v_agent.model_overrides
        AND v_new_allowed IS NOT DISTINCT FROM v_agent.allowed_tools
        AND v_new_denied IS NOT DISTINCT FROM v_agent.denied_tools THEN
        v_reason := 'no_effective_change';
      ELSE
        UPDATE improvement_proposals
        SET current_value = jsonb_build_object(
          'allowed_tools', to_jsonb(v_agent.allowed_tools),
          'default_model', v_agent.default_model,
          'denied_tools', to_jsonb(v_agent.denied_tools),
          'model_overrides', v_agent.model_overrides
        )
        WHERE id = p_proposal_id;

        UPDATE agent_catalog
        SET default_model = v_new_model,
            model_overrides = v_new_overrides,
            allowed_tools = v_new_allowed,
            denied_tools = v_new_denied,
            updated_at = now()
        WHERE slug = v_proposal.agent_slug;

        UPDATE improvement_proposals
        SET applied_at = now(), status = 'applied'
        WHERE id = p_proposal_id;

        v_applied := true;
      END IF;
    END IF;
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'IMPROVEMENT_PROPOSAL_APPROVED', jsonb_build_object(
    'agent_slug', v_proposal.agent_slug,
    'auto_apply_requested', p_auto_apply,
    'auto_applied', v_applied,
    'not_applied_reason', v_reason,
    'proposal_id', p_proposal_id,
    'proposal_type', v_proposal.proposal_type
  ));

  RETURN jsonb_build_object(
    'auto_applied', v_applied,
    'not_applied_reason', v_reason,
    'proposal_id', p_proposal_id,
    'status', CASE WHEN v_applied THEN 'applied' ELSE 'approved' END
  );
END;
$$;

COMMENT ON FUNCTION public.approve_improvement_proposal_admin(boolean, uuid, text) IS
  'Schválí návrh zlepšení; s p_auto_apply ho aplikuje na agent_catalog. Status applied jen při '
  'skutečné změně, jinak approved + not_applied_reason (agent_not_found | type_not_auto_appliable | '
  'no_effective_change). Snapshot původního stavu v current_value.';

REVOKE ALL ON FUNCTION public.approve_improvement_proposal_admin(boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_improvement_proposal_admin(boolean, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_improvement_proposal_admin(boolean, uuid, text) TO service_role;
