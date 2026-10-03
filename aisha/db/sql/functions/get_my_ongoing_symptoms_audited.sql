-- Function: public.get_my_ongoing_symptoms_audited
-- Description: Returns ongoing member symptoms for current user with audit trail.
-- Security: SECURITY DEFINER with explicit search_path and authenticated-only execute grants.

CREATE OR REPLACE FUNCTION public.get_my_ongoing_symptoms_audited(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  state_id uuid,
  state_name text,
  state_name_key text,
  severity integer,
  started_at timestamptz,
  notes text,
  duration_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log intentionally excludes symptom text/content values.
  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'health'::public.journal_area,
    p_details := jsonb_build_object(
      'limit', v_limit,
      'scope', 'self',
      'resource', 'ongoing_symptoms'
    ),
    p_entity_id := v_user_id::text,
    p_entity_type := 'member_health_logs',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'User viewed ongoing symptoms',
    p_tags := ARRAY['phi', 'member', 'symptoms', 'ongoing'],
    p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    mhl.id,
    mhl.state_id,
    COALESCE(NULLIF(trim(mhs.custom_name), ''), mhs.name_key) AS state_name,
    mhs.name_key AS state_name_key,
    mhl.severity,
    mhl.started_at,
    mhl.notes,
    EXTRACT(EPOCH FROM (
      now() - COALESCE(mhl.started_at, mhl.logged_at, mhl.created_at)
    )) / 3600 AS duration_hours
  FROM public.member_health_logs AS mhl
  JOIN public.member_health_states AS mhs
    ON mhs.id = mhl.state_id
  WHERE mhl.user_id = v_user_id
    AND mhl.ended_at IS NULL
  ORDER BY COALESCE(mhl.started_at, mhl.logged_at, mhl.created_at) DESC
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_ongoing_symptoms_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_ongoing_symptoms_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_ongoing_symptoms_audited(p_limit integer) TO authenticated;

COMMENT ON FUNCTION public.get_my_ongoing_symptoms_audited(p_limit integer)
IS 'Returns ongoing symptoms for current user with sensitive data audit logging.';
