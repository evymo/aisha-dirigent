-- ============================================================================
-- Source of Truth: fn_evaluate_proposal_risk
-- Popis: Centrální risk-evaluation RPC. Vrací 'low'|'medium'|'high'|'critical'
--        podle agent slug, category, a metadata. Rozšířeno (2026-04-28) o
--        Phase 1-4 deploy flow kategorie:
--           dashboard_rebuild     → vždy 'low' (read-only)
--           rollback              → 'medium'/'high'/'critical' (vždy >= medium)
--           blue_green_switch     → low/medium/high podle smoke + triggered_by
--           infrastructure_drift  → low/medium/high/critical podle drift_kind
--        Plus original logika pro security/database/auth/rls/function categories.
-- Volá: WF_APPROVAL_GATE, všechny 4 phase observers + orchestrator
-- Auth: authenticated nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_evaluate_proposal_risk(
  p_agent_slug text,
  p_category text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_score int := 0;
  v_agent record;
  v_files_changed int;
  v_drift_kind text;
  v_is_production boolean;
  v_triggered_by text;
  v_smoke_test_passed boolean;
BEGIN
  ----------------------------------------------------------------------------
  -- New category: dashboard_rebuild — always low
  ----------------------------------------------------------------------------
  IF p_category = 'dashboard_rebuild' THEN
    RETURN 'low';
  END IF;

  ----------------------------------------------------------------------------
  -- New category: rollback — always high or critical
  ----------------------------------------------------------------------------
  IF p_category = 'rollback' THEN
    -- Critical conditions
    IF (p_metadata->>'fatal_count')::int >= 10
       AND COALESCE((p_metadata->>'is_production')::boolean, false) THEN
      RETURN 'critical';
    END IF;
    IF (p_metadata->>'unique_users_affected')::int >= 1000
       AND COALESCE((p_metadata->>'is_production')::boolean, false) THEN
      RETURN 'critical';
    END IF;
    -- Production rollback always high
    IF COALESCE((p_metadata->>'is_production')::boolean, false) THEN
      RETURN 'high';
    END IF;
    -- Staging/preview rollback medium
    RETURN 'medium';
  END IF;

  ----------------------------------------------------------------------------
  -- New category: blue_green_switch
  ----------------------------------------------------------------------------
  IF p_category = 'blue_green_switch' THEN
    v_smoke_test_passed := COALESCE((p_metadata->>'smoke_test_passed')::boolean, false);
    v_triggered_by := COALESCE(p_metadata->>'triggered_by', 'manual');

    IF NOT v_smoke_test_passed THEN
      RETURN 'high';
    END IF;

    -- Major semver change → high
    IF p_metadata#>>'{image_tag_change,semver_kind}' = 'major' THEN
      RETURN 'high';
    END IF;

    -- Drift remediation triggered → medium (auto + notify)
    IF v_triggered_by = 'drift_remediation' THEN
      RETURN 'medium';
    END IF;

    -- Manual trigger → medium
    IF v_triggered_by = 'manual' THEN
      RETURN 'medium';
    END IF;

    -- CI push with patch semver → low
    IF v_triggered_by = 'ci_push'
       AND p_metadata#>>'{image_tag_change,semver_kind}' = 'patch' THEN
      RETURN 'low';
    END IF;

    -- CI push with minor semver → medium
    IF v_triggered_by = 'ci_push'
       AND p_metadata#>>'{image_tag_change,semver_kind}' = 'minor' THEN
      RETURN 'medium';
    END IF;

    -- Default for B/G
    RETURN 'medium';
  END IF;

  ----------------------------------------------------------------------------
  -- New category: infrastructure_drift
  ----------------------------------------------------------------------------
  IF p_category = 'infrastructure_drift' THEN
    v_drift_kind := COALESCE(p_metadata->>'drift_kind', 'unknown');
    v_is_production := COALESCE((p_metadata->>'is_production')::boolean, false);

    -- Critical: extra app (potentially rogue), prod database drift
    IF v_drift_kind = 'extra_app' THEN
      RETURN 'critical';
    END IF;
    IF v_is_production AND p_metadata->>'app_role' = 'database' THEN
      RETURN 'critical';
    END IF;

    -- High: secret drift, missing app, auth service drift
    IF v_drift_kind = 'secret_drift' THEN
      RETURN 'high';
    END IF;
    IF v_drift_kind = 'missing_app' THEN
      RETURN 'high';
    END IF;
    IF p_metadata->>'app_role' = 'auth' THEN
      RETURN 'high';
    END IF;

    -- Medium: image_tag in prod, replicas drift, traefik labels, env_var in prod
    IF v_drift_kind = 'image_tag' AND v_is_production THEN
      RETURN 'medium';
    END IF;
    IF v_drift_kind IN ('replicas', 'traefik_labels', 'domain_mismatch') THEN
      RETURN 'medium';
    END IF;
    IF v_drift_kind = 'env_var_value' AND v_is_production THEN
      RETURN 'medium';
    END IF;

    -- Low: env_var in non-prod, image_tag in non-prod, env_var_extra
    IF v_drift_kind IN ('env_var_value', 'env_var_missing', 'env_var_extra', 'image_tag') THEN
      RETURN 'low';
    END IF;

    -- Default for unknown drift kind
    RETURN 'medium';
  END IF;

  ----------------------------------------------------------------------------
  -- Category: task_spend — spend-approval escalations (WF_APPROVAL_GATE)
  -- Metadata: { estimate, threshold, budget_remaining?, kind }
  ----------------------------------------------------------------------------
  IF p_category = 'task_spend' THEN
    -- Critical: estimate dwarfs the threshold by an order of magnitude
    IF COALESCE((p_metadata->>'estimate')::numeric, 0)
       >= COALESCE(NULLIF((p_metadata->>'threshold')::numeric, 0), 1) * 10 THEN
      RETURN 'critical';
    END IF;
    -- High: estimate at 3x threshold or budget already exhausted
    IF COALESCE((p_metadata->>'estimate')::numeric, 0)
       >= COALESCE(NULLIF((p_metadata->>'threshold')::numeric, 0), 1) * 3 THEN
      RETURN 'high';
    END IF;
    IF COALESCE((p_metadata->>'budget_remaining')::numeric, 1) <= 0 THEN
      RETURN 'high';
    END IF;
    -- Default: a human look, no alarm
    RETURN 'medium';
  END IF;

  ----------------------------------------------------------------------------
  -- Original logic for non-deploy categories (unchanged)
  ----------------------------------------------------------------------------
  SELECT safety_level INTO v_agent FROM agent_catalog WHERE slug = p_agent_slug;

  -- Agent safety level score
  v_score := v_score + CASE v_agent.safety_level
    WHEN 'strict' THEN 30
    WHEN 'standard' THEN 15
    WHEN 'minimal' THEN 5
    ELSE 20
  END;

  -- Category risk score
  v_score := v_score + CASE p_category
    WHEN 'security' THEN 40
    WHEN 'database' THEN 35
    WHEN 'authentication' THEN 35
    WHEN 'rls' THEN 30
    WHEN 'function' THEN 20
    WHEN 'performance' THEN 15
    WHEN 'translation' THEN 5
    WHEN 'documentation' THEN 5
    ELSE 10
  END;

  -- Files changed score
  v_files_changed := COALESCE((p_metadata->>'files_changed')::int, 0);
  v_score := v_score + CASE
    WHEN v_files_changed > 10 THEN 25
    WHEN v_files_changed > 5 THEN 15
    WHEN v_files_changed > 2 THEN 10
    ELSE 0
  END;

  -- Sensitive path bonus
  IF p_metadata ? 'files_affected' AND
     p_metadata->>'files_affected' ~* '(security|auth|rls|migration|sensitive)' THEN
    v_score := v_score + 20;
  END IF;

  RETURN CASE
    WHEN v_score >= 70 THEN 'critical'
    WHEN v_score >= 45 THEN 'high'
    WHEN v_score >= 25 THEN 'medium'
    ELSE 'low'
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_evaluate_proposal_risk(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_evaluate_proposal_risk(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_evaluate_proposal_risk(text, text, jsonb) TO service_role;
