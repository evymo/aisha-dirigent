-- Function: get_models_due_self_test
-- Returns models the self-test runner should probe next. Default (p_mode='pending')
-- = discovered-but-untested available models (the boot path). Re-test modes let an
-- admin re-probe ALREADY-settled models: 'rejected-only' (re-prove a model that failed,
-- e.g. after a transient provider outage) or 'all-settled' (pending+tested+rejected).
-- 'approved' is NEVER returned — an admin verdict is not auto-re-tested.
-- service_role only. Pairs with record_model_self_test (the verdict).

-- p_mode added → drop the old single-arg signature so the overload does not linger.
DROP FUNCTION IF EXISTS public.get_models_due_self_test(int);

CREATE OR REPLACE FUNCTION public.get_models_due_self_test(
  p_limit int  DEFAULT 25,
  p_mode  text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  provider text,
  model_id text,
  eval_status text,
  first_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('pending', 'rejected-only', 'all-settled') THEN
    RAISE EXCEPTION 'invalid p_mode: %', p_mode USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT r.id, r.provider, r.model_id, r.eval_status, r.first_seen_at
  FROM   ai_model_registry r
  WHERE  r.is_available
    AND  NOT r.is_deprecated
    AND  CASE p_mode
           WHEN 'pending'       THEN r.eval_status = 'pending'
           WHEN 'rejected-only' THEN r.eval_status = 'rejected'
           WHEN 'all-settled'   THEN r.eval_status IN ('pending', 'tested', 'rejected')
           ELSE false
         END
  ORDER  BY r.first_seen_at ASC NULLS FIRST  -- oldest first
  LIMIT  p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_models_due_self_test(int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_models_due_self_test(int, text) TO service_role;

COMMENT ON FUNCTION public.get_models_due_self_test(int, text) IS
  'Self-test runner discovery RPC. p_mode: pending (boot default) | rejected-only | all-settled (admin re-test). Never returns approved. service_role only.';
