-- Function: public.create_token_lock_admin
-- Arguments: p_user_id uuid, p_token_type text, p_amount numeric, p_lock_end timestamptz, p_lock_reason text, p_lock_start timestamptz, p_unlock_schedule jsonb, p_notes text, p_unlock_condition text
-- Description: Create a token lock for a user. Admin/staff only.
-- Security: SECURITY DEFINER, admin or staff role required
-- Updated: 2026-01-09 - Added p_unlock_condition param

CREATE OR REPLACE FUNCTION public.create_token_lock_admin(
  p_user_id uuid, 
  p_token_type text, 
  p_amount numeric, 
  p_lock_end timestamp with time zone, 
  p_lock_reason text DEFAULT NULL::text, 
  p_lock_start timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_unlock_schedule jsonb DEFAULT NULL::jsonb, 
  p_notes text DEFAULT NULL::text,
  p_unlock_condition text DEFAULT NULL::text
)
 RETURNS TABLE(id uuid, user_id uuid, token_type text, amount numeric, lock_reason text, unlock_condition text, locked_at timestamptz, unlocked_at timestamptz, lock_start timestamptz, lock_end timestamptz, unlock_schedule jsonb, unlocked_amount numeric, is_active boolean, notes text, created_at timestamptz, profile_display_name text, profile_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO public.token_locks (
    user_id,
    token_type,
    amount,
    lock_reason,
    unlock_condition,
    lock_start,
    lock_end,
    unlock_schedule,
    unlocked_amount,
    is_active,
    notes,
    created_by,
    created_at,
    updated_at,
    -- legacy compat
    lock_type,
    locked_at,
    unlocks_at
  ) VALUES (
    p_user_id,
    COALESCE(NULLIF(p_token_type, ''), 'aisha'),
    p_amount,
    p_lock_reason,
    p_unlock_condition,
    COALESCE(p_lock_start, v_now),
    p_lock_end,
    COALESCE(p_unlock_schedule, '"end"'::jsonb),
    0,
    true,
    p_notes,
    auth.uid(),
    v_now,
    v_now,
    COALESCE(NULLIF(p_token_type, ''), 'aisha'),
    COALESCE(p_lock_start, v_now),
    p_lock_end
  )
  RETURNING public.token_locks.id INTO v_lock_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('user_id', p_user_id),
      p_entity_id := v_lock_id::TEXT,
      p_entity_type := 'token_lock',
      p_severity := 'info'::journal_severity,
      p_summary := 'Admin created token lock',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT *
  FROM public.get_token_locks_admin()
  WHERE get_token_locks_admin.id = v_lock_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_lock_admin(p_user_id uuid, p_token_type text, p_amount numeric, p_lock_end timestamp with time zone, p_lock_reason text, p_lock_start timestamp with time zone, p_unlock_schedule jsonb, p_notes text, p_unlock_condition text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_token_lock_admin(p_user_id uuid, p_token_type text, p_amount numeric, p_lock_end timestamp with time zone, p_lock_reason text, p_lock_start timestamp with time zone, p_unlock_schedule jsonb, p_notes text, p_unlock_condition text) TO authenticated;
