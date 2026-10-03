-- ============================================================================
-- Source of Truth: aisha_publish_static_defense_rule
-- Popis: State transition draft → active. Marks rule as live; from this point
--        gen-static-defense includes it in .semgrep/aisha-rules.yml output
--        and Semgrep CI enforces it.
--
--        Důležité: po úspěšném publish operator MUSÍ vytvořit migration
--        (nebo nový timestamp s INSERT statement) + spustit gen:static-defense
--        + commit. CI gates verifies sync mezi DB seed migrations a checked-in
--        YAML — bez tohoto follow-up by se rule v live YAML neobjevila.
--
-- Volá: Appsmith operator approve action, WF_APPROVAL_GATE callback
-- Auth: Admin only (publish je závazné rozhodnutí, ne autonomní)
-- Audit: insert do audit_journal s reviewer + rationale
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_publish_static_defense_rule(
  p_rule_id           text,
  p_publish_rationale text DEFAULT NULL
)
RETURNS public.aisha_static_defense_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.aisha_static_defense_rules;
  v_existing public.aisha_static_defense_rules;
BEGIN
  -- Auth: publish je závazné, jen admin
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Unauthorized: publishing static-defense rules requires admin role'
      USING ERRCODE = '22023';
  END IF;

  -- Validation: rule must exist as draft
  SELECT * INTO v_existing
  FROM public.aisha_static_defense_rules
  WHERE rule_id = p_rule_id;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'Rule % not found', p_rule_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.status = 'active' THEN
    RAISE EXCEPTION 'Rule % is already active', p_rule_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.status = 'deprecated' THEN
    RAISE EXCEPTION 'Rule % is deprecated — propose a new rule_id', p_rule_id USING ERRCODE = '22023';
  END IF;

  -- Transition draft → active
  UPDATE public.aisha_static_defense_rules
  SET status      = 'active',
      approved_by = auth.uid()
      -- updated_at via trigger
  WHERE rule_id = p_rule_id
  RETURNING * INTO v_row;

  -- Audit trail — link reviewer + rationale to the state change
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'static_defense_rule_published',
    jsonb_build_object(
      'rule_id', p_rule_id,
      'category', v_row.category,
      'severity', v_row.severity,
      'version', v_row.version,
      'previous_status', v_existing.status,
      'publish_rationale', p_publish_rationale,
      'reminder', 'Operator must add INSERT migration + regenerate YAML + commit. CI gate static-defense-generator-integrity.gate.test.ts will fail until both are committed.'
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.aisha_publish_static_defense_rule(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_publish_static_defense_rule(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_publish_static_defense_rule(text, text) TO service_role;
