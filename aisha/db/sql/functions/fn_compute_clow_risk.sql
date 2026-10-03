-- ============================================================================
-- Source of Truth: fn_compute_clow_risk  (E0 capability-availability — risk axis)
-- Purpose: COMPUTE a clow's risk band from FIRST PRINCIPLES — never a lookup
--          list of "high-risk runtimes/tools". Risk is DERIVED:
--            base band  = the chosen runtime's DECLARED side_effect_class
--                         (read_only → low, reversible → medium, irreversible → high)
--            +1 band    if the clow's own criticality is high|critical
--            +1 band    if the clow both reaches the internet AND writes
--                         (egress + side-effect = exfiltration / blast-radius class)
--            clamp      at 'critical' (the top band)
--          The resulting risk_level feeds governance-as-POLICY: a threshold
--          decides allow/ask/deny + whether human approval is forced. There is
--          NO maintained allow-list anywhere — the runtime row governs itself via
--          its own side_effect_class, exactly like ai_provider_registry governs
--          availability via is_enabled. Adding a runtime/tool changes nothing here.
-- Security: SECURITY DEFINER, read-only (pure). authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_compute_clow_risk(
  p_clow        jsonb,
  p_runtime_row jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Risk bands, lowest → highest. This is an ORDINAL SCALE, not an allow-list:
  -- it never enumerates which entities are permitted, only how to escalate a band.
  v_bands           text[]  := ARRAY['low', 'medium', 'high', 'critical'];
  v_max_idx         int     := array_length(v_bands, 1);  -- 4 (clamp ceiling)

  v_side_effect     text    := COALESCE(NULLIF(p_runtime_row->>'side_effect_class', ''), 'reversible');
  v_criticality     text    := COALESCE(NULLIF(p_clow->>'criticality', ''), 'normal');
  v_needs_internet  boolean := COALESCE((p_clow->>'needs_internet')::boolean, false);
  v_needs_write     boolean := COALESCE((p_clow->>'needs_write')::boolean, false);

  v_base_idx        int;
  v_idx             int;
  v_bump_crit       boolean := (v_criticality IN ('high', 'critical'));
  v_bump_egress     boolean := (v_needs_internet AND v_needs_write);
  v_factors         jsonb   := jsonb_build_array();
BEGIN
  -- Auth: any authenticated caller or service_role. Pure read-only function.
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- ── base band — DERIVED from the runtime's own declared side-effect class ──
  -- Unknown/unset side_effect_class → treat as 'reversible' (medium): a runtime
  -- that has not declared itself read-only is not assumed harmless.
  v_base_idx := CASE v_side_effect
    WHEN 'read_only'    THEN 1   -- low
    WHEN 'reversible'   THEN 2   -- medium
    WHEN 'irreversible' THEN 3   -- high
    ELSE 2                       -- conservative default = medium
  END;
  v_idx := v_base_idx;
  v_factors := v_factors || jsonb_build_object(
    'factor', 'side_effect_class',
    'value',  v_side_effect,
    'band',   v_bands[v_base_idx]
  );

  -- ── +1 band — the clow's OWN criticality (high|critical) ───────────────────
  IF v_bump_crit THEN
    v_idx := v_idx + 1;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'criticality',
      'value',  v_criticality,
      'delta',  1
    );
  END IF;

  -- ── +1 band — egress + side-effect (exfiltration / blast-radius) ───────────
  IF v_bump_egress THEN
    v_idx := v_idx + 1;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'internet_and_write',
      'value',  true,
      'delta',  1
    );
  END IF;

  -- ── clamp at the top band ('critical') ─────────────────────────────────────
  IF v_idx > v_max_idx THEN
    v_factors := v_factors || jsonb_build_object(
      'factor', 'clamp',
      'value',  'critical',
      'raw_idx', v_idx
    );
    v_idx := v_max_idx;
  END IF;
  IF v_idx < 1 THEN
    v_idx := 1;  -- defensive floor (bands are 1-indexed)
  END IF;

  RETURN jsonb_build_object(
    'risk_level', v_bands[v_idx],
    'factors',    v_factors
  );
END;
$$;

COMMENT ON FUNCTION public.fn_compute_clow_risk(jsonb, jsonb) IS
  'E0 capability-availability risk axis. COMPUTES risk_level (low|medium|high|critical) from '
  'the runtime row''s declared side_effect_class (read_only→low, reversible→medium, '
  'irreversible→high), +1 band on clow criticality high|critical, +1 band on needs_internet AND '
  'needs_write, clamped at critical. Pure/STABLE; no allow-list — risk drives governance-as-POLICY '
  '(threshold → allow/ask/deny + human approval), not membership in any permitted-names list.';

REVOKE ALL ON FUNCTION public.fn_compute_clow_risk(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compute_clow_risk(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_clow_risk(jsonb, jsonb) TO service_role;
