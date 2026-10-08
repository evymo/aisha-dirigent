-- ============================================================================
-- Source of Truth: aisha_propose_static_defense_rule
-- Popis: Insert nebo overwrite-draft rule v aisha_static_defense_rules. Pokud
--        rule_id už existuje a má status='active' nebo 'deprecated', vyhazuje
--        chybu — používej rather aisha_publish_static_defense_rule pro
--        status transitions a aisha_deprecate_static_defense_rule pro retire.
--
-- Volá:  WF_AISHA_TOOLING_OBSERVER (autonomous detection), Appsmith operator UI
-- Auth:  service_role nebo admin/staff
-- Audit: insert do audit_journal s decision_provenance chain
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_propose_static_defense_rule(
  p_rule_id              text,
  p_category             text,
  p_severity             text,
  p_owasp_category       text DEFAULT NULL,
  p_semgrep_pattern      jsonb DEFAULT NULL,
  p_semgrep_paths        jsonb DEFAULT NULL,
  p_semgrep_message      text DEFAULT NULL,
  p_languages            text[] DEFAULT NULL,
  p_rationale            text DEFAULT NULL,
  p_proposed_by          text DEFAULT NULL,
  p_decision_provenance  jsonb DEFAULT '[]'::jsonb
)
RETURNS public.aisha_static_defense_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row        public.aisha_static_defense_rules;
  v_existing   public.aisha_static_defense_rules;
  v_is_service boolean;
  v_proposer   text;
BEGIN
  -- 1. Auth check (FIRST, before any data access — defense in depth)
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Input validation
  IF p_rule_id IS NULL OR length(p_rule_id) < 3 THEN
    RAISE EXCEPTION 'rule_id required (min 3 chars)' USING ERRCODE = '22023';
  END IF;
  IF p_rule_id !~ '^[a-z][a-z0-9-]+$' THEN
    RAISE EXCEPTION 'rule_id must be kebab-case (^[a-z][a-z0-9-]+$): %', p_rule_id
      USING ERRCODE = '22023';
  END IF;
  IF p_category NOT IN ('semgrep', 'eslint-no-secrets', 'owasp-exemption') THEN
    RAISE EXCEPTION 'Invalid category: % (must be semgrep, eslint-no-secrets, owasp-exemption)', p_category
      USING ERRCODE = '22023';
  END IF;
  IF p_severity NOT IN ('ERROR', 'WARNING', 'INFO') THEN
    RAISE EXCEPTION 'Invalid severity: %', p_severity USING ERRCODE = '22023';
  END IF;
  IF p_category = 'semgrep' AND p_semgrep_pattern IS NULL THEN
    RAISE EXCEPTION 'semgrep_pattern required for category=semgrep' USING ERRCODE = '22023';
  END IF;
  IF p_category = 'semgrep' AND p_semgrep_message IS NULL THEN
    RAISE EXCEPTION 'semgrep_message required for category=semgrep' USING ERRCODE = '22023';
  END IF;

  -- 3. Proposer identification — fallback chain: explicit p_proposed_by →
  --    auth.uid() string → 'aisha-autonomous' for service_role calls
  v_proposer := COALESCE(
    p_proposed_by,
    (auth.uid())::text,
    CASE WHEN v_is_service THEN 'aisha-autonomous' ELSE 'unknown' END
  );

  -- 4. Idempotency — UPDATE draft, INSERT if missing, REFUSE active/deprecated
  SELECT * INTO v_existing
  FROM public.aisha_static_defense_rules
  WHERE rule_id = p_rule_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'Rule "%" is active — use aisha_deprecate_static_defense_rule before re-proposing, or call propose with a new rule_id', p_rule_id
        USING ERRCODE = '22023';
    END IF;
    IF v_existing.status = 'deprecated' THEN
      RAISE EXCEPTION 'Rule "%" is deprecated — use a new rule_id for replacement', p_rule_id
        USING ERRCODE = '22023';
    END IF;

    -- Status is draft → overwrite the proposal (the previous draft must not
    -- yet have been published). Bump version so consumers can detect change.
    UPDATE public.aisha_static_defense_rules
    SET category         = p_category,
        owasp_category   = p_owasp_category,
        semgrep_pattern  = p_semgrep_pattern,
        semgrep_paths    = p_semgrep_paths,
        semgrep_message  = p_semgrep_message,
        languages        = COALESCE(p_languages, languages),
        severity         = p_severity,
        version          = version + 1,
        proposed_by      = v_proposer,
        rationale        = COALESCE(p_rationale, rationale)
        -- updated_at bumped by trigger
    WHERE rule_id = p_rule_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.aisha_static_defense_rules (
      rule_id, category, owasp_category,
      semgrep_pattern, semgrep_paths, semgrep_message, languages,
      severity, status, version,
      proposed_by, rationale
    )
    VALUES (
      p_rule_id, p_category, p_owasp_category,
      p_semgrep_pattern, p_semgrep_paths, p_semgrep_message, COALESCE(p_languages, ARRAY['typescript']::text[]),
      p_severity, 'draft', 1,
      v_proposer, p_rationale
    )
    RETURNING * INTO v_row;
  END IF;

  -- 5. Audit trail with decision_provenance chain
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'static_defense_rule_proposed',
    jsonb_build_object(
      'rule_id', p_rule_id,
      'category', p_category,
      'severity', p_severity,
      'owasp_category', p_owasp_category,
      'proposer', v_proposer,
      'version', v_row.version,
      'is_update', v_existing IS NOT NULL,
      'decision_provenance', p_decision_provenance
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.aisha_propose_static_defense_rule(
  text, text, text, text, jsonb, jsonb, text, text[], text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_propose_static_defense_rule(
  text, text, text, text, jsonb, jsonb, text, text[], text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_propose_static_defense_rule(
  text, text, text, text, jsonb, jsonb, text, text[], text, text, jsonb
) TO service_role;
