-- Function: public.mark_symptom_ended
-- Arguments: p_log_id uuid, p_ended_at timestamptz
-- Description: Mark an ongoing symptom as resolved
-- Security: SECURITY DEFINER - users can only update their own logs

CREATE OR REPLACE FUNCTION public.mark_symptom_ended(
  p_log_id uuid,
  p_ended_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Update only own records
  UPDATE member_health_logs
  SET 
    ended_at = p_ended_at
  WHERE id = p_log_id
    AND user_id = v_user_id
    AND ended_at IS NULL;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Log not found or already ended');
  END IF;
  
  RETURN jsonb_build_object('success', true, 'ended_at', p_ended_at);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_symptom_ended(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_symptom_ended(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.mark_symptom_ended(uuid, timestamptz) IS 'Mark an ongoing symptom as resolved (trvá -> skončilo)';
