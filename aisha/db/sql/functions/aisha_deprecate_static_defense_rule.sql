-- ============================================================================
-- Source of Truth: aisha_deprecate_static_defense_rule
-- Popis: State transition active → deprecated. Pravidlo se přestane objevovat
--        v gen-static-defense výstupu (a Semgrep ho přestane enforce), ale
--        řádek zůstane v tabulce pro audit/historii a pro fail-loud guard:
--        budoucí propose se stejným rule_id selže (musíš použít nový name).
--
-- Volá: Appsmith operator UI (retire), Aisha autonomní decay logic
-- Auth: Admin only
-- Audit: insert do audit_journal s rationale (proč rule retired)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_deprecate_static_defense_rule(
  p_rule_id              text,
  p_deprecation_rationale text
)
RETURNS public.aisha_static_defense_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      public.aisha_static_defense_rules;
  v_existing public.aisha_static_defense_rules;
BEGIN
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Unauthorized: deprecating static-defense rules requires admin role'
      USING ERRCODE = '22023';
  END IF;

  IF p_deprecation_rationale IS NULL OR length(p_deprecation_rationale) < 20 THEN
    RAISE EXCEPTION 'Deprecation rationale required (min 20 chars) — explain WHY this rule is being retired'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.aisha_static_defense_rules
  WHERE rule_id = p_rule_id;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'Rule % not found', p_rule_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.status = 'deprecated' THEN
    RAISE EXCEPTION 'Rule % is already deprecated', p_rule_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.aisha_static_defense_rules
  SET status = 'deprecated'
  WHERE rule_id = p_rule_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'static_defense_rule_deprecated',
    jsonb_build_object(
      'rule_id', p_rule_id,
      'category', v_row.category,
      'previous_status', v_existing.status,
      'deprecation_rationale', p_deprecation_rationale,
      'reminder', 'Operator must add migration capturing this status change + regenerate YAML + commit. CI gate static-defense-generator-integrity.gate.test.ts enforces sync.'
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.aisha_deprecate_static_defense_rule(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_deprecate_static_defense_rule(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_deprecate_static_defense_rule(text, text) TO service_role;
