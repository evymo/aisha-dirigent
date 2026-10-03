-- Function: public.fn_observe_task_kind  (T1 — record an observed task_kind)
-- Normalizes p_task_kind and upserts it into the observed registry (bumps sample_count + last_seen_at).
-- Descriptive only — it records what was seen; it never rejects or gates. Returns the normalized kind.
-- service_role (rollup/cron) or admin/staff only (it writes the registry).

CREATE OR REPLACE FUNCTION public.fn_observe_task_kind(
  p_task_kind text,
  p_n         bigint DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_norm text;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin_or_staff(auth.uid())
  THEN
    RAISE EXCEPTION 'Not authorized: service_role or admin/staff required' USING ERRCODE = '42501';
  END IF;

  v_norm := public.normalize_task_kind(p_task_kind);

  INSERT INTO public.ai_task_kind_registry (task_kind, sample_count, first_seen_at, last_seen_at)
  VALUES (v_norm, GREATEST(p_n, 0), now(), now())
  ON CONFLICT (task_kind) DO UPDATE
    SET sample_count = public.ai_task_kind_registry.sample_count + GREATEST(EXCLUDED.sample_count, 0),
        last_seen_at = now();

  RETURN v_norm;
END $$;

COMMENT ON FUNCTION public.fn_observe_task_kind(text, bigint) IS
  'T1: normalize + upsert an observed task_kind into ai_task_kind_registry (descriptive; never gates). service_role/admin only.';

REVOKE ALL ON FUNCTION public.fn_observe_task_kind(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_observe_task_kind(text, bigint) TO service_role;
