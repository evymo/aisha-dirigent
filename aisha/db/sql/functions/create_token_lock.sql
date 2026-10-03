-- Function: public.create_token_lock
-- Arguments: p_token_type text, p_amount integer, p_lock_condition text, p_unlock_at timestamp with time zone, p_reference_id uuid, p_reference_type text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:19+01:00

CREATE OR REPLACE FUNCTION public.create_token_lock(p_token_type text, p_amount integer, p_lock_condition text, p_unlock_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reference_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  INSERT INTO token_locks (
    user_id, token_type, locked_amount, lock_condition,
    unlock_at, reference_id, reference_type
  ) VALUES (
    auth.uid(), p_token_type::token_type, p_amount, p_lock_condition,
    p_unlock_at, p_reference_id, p_reference_type
  )
  RETURNING id INTO v_lock_id;

  RETURN jsonb_build_object('success', true, 'id', v_lock_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_lock(p_token_type text, p_amount integer, p_lock_condition text, p_unlock_at timestamp with time zone, p_reference_id uuid, p_reference_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_token_lock(p_token_type text, p_amount integer, p_lock_condition text, p_unlock_at timestamp with time zone, p_reference_id uuid, p_reference_type text) TO authenticated;
