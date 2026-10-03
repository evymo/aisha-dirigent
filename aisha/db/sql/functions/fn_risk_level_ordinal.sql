-- ============================================================================
-- Source of Truth: fn_risk_level_ordinal  (E0 risk-severity rank transform)
-- Purpose: Ordinal map for risk severity (low < medium < high < critical → 0..3).
--          A pure value transform — one rank per level, NOT a list of permitted
--          names. Lets fn_admit_clow compare a COMPUTED clow risk level against a
--          resolved ai_risk_policies threshold using a plain numeric >=.
--          Unknown severity → 1 (medium), the conservative default.
-- Security: IMMUTABLE pure function. authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_risk_level_ordinal(p_level text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_level, ''))
    WHEN 'low'      THEN 0
    WHEN 'medium'   THEN 1
    WHEN 'high'     THEN 2
    WHEN 'critical' THEN 3
    ELSE 1  -- unknown severity → treat as medium (conservative)
  END;
$$;

COMMENT ON FUNCTION public.fn_risk_level_ordinal(text) IS
  'Pure rank transform for risk severity (low<medium<high<critical → 0..3; unknown→1). '
  'Lets fn_admit_clow compare a computed clow risk level against a policy threshold. '
  'IMMUTABLE; a value map, not an allow-list.';

REVOKE ALL ON FUNCTION public.fn_risk_level_ordinal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_risk_level_ordinal(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_risk_level_ordinal(text) TO service_role;
