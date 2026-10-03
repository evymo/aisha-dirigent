-- ============================================================================
-- Source of Truth: aisha_get_active_static_defense_rules
-- Popis: Read-only RPC consumed by `scripts/gen-static-defense.mjs` to
--        generate .semgrep/aisha-rules.yml + other policy files.
-- Bezpečnost: SECURITY DEFINER, anon may read (rules are public policy).
-- Audit: žádný (read-only, idempotent).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_get_active_static_defense_rules(
  p_category text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  -- No auth check: this is policy metadata, intentionally readable so
  -- generators run in CI environments without DB credentials too.

  IF p_category IS NOT NULL AND p_category NOT IN ('semgrep', 'eslint-no-secrets', 'owasp-exemption') THEN
    RAISE EXCEPTION 'Unknown category: %', p_category;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rule_id', rule_id,
      'category', category,
      'owasp_category', owasp_category,
      'semgrep_pattern', semgrep_pattern,
      'semgrep_paths', semgrep_paths,
      'semgrep_message', semgrep_message,
      'languages', languages,
      'severity', severity,
      'version', version,
      'rationale', rationale
    )
    ORDER BY category, rule_id
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.aisha_static_defense_rules
  WHERE status = 'active'
    AND (p_category IS NULL OR category = p_category);

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.aisha_get_active_static_defense_rules(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_get_active_static_defense_rules(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_get_active_static_defense_rules(text) TO anon;
GRANT EXECUTE ON FUNCTION public.aisha_get_active_static_defense_rules(text) TO service_role;
