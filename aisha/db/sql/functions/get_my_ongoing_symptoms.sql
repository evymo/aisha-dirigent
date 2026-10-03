-- Function: public.get_my_ongoing_symptoms
-- Description: Get list of ongoing symptoms for current user
-- Security: SECURITY DEFINER - user can only see own data

CREATE OR REPLACE FUNCTION public.get_my_ongoing_symptoms()
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
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    mhl.id,
    mhl.state_id,
    COALESCE(mhs.custom_name, mhs.name_key) AS state_name,
    mhs.name_key AS state_name_key,
    mhl.severity,
    mhl.started_at,
    mhl.notes,
    EXTRACT(EPOCH FROM (now() - mhl.started_at)) / 3600 as duration_hours
  FROM member_health_logs mhl
  JOIN member_health_states mhs ON mhs.id = mhl.state_id
  WHERE mhl.user_id = v_user_id
    AND mhl.ended_at IS NULL  -- ended_at IS NULL = still ongoing
  ORDER BY mhl.started_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_ongoing_symptoms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_ongoing_symptoms() TO authenticated;

COMMENT ON FUNCTION public.get_my_ongoing_symptoms() IS 'Get list of ongoing symptoms for current user with duration calculation';
