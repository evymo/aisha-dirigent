-- Function: public.update_token_lock_admin
-- Arguments: p_lock_id uuid, p_amount numeric, p_lock_end timestamptz, p_unlock_schedule jsonb, p_unlocked_amount numeric, p_is_active boolean, p_lock_reason text, p_notes text, p_action text
-- Description: Update a token lock. Admin/staff only.
-- Security: SECURITY DEFINER, admin or staff role required
-- Updated: 2026-01-09 - Added p_action param for special operations

CREATE OR REPLACE FUNCTION public.update_token_lock_admin(
  p_lock_id uuid, 
  p_amount numeric DEFAULT NULL::numeric, 
  p_lock_end timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_unlock_schedule jsonb DEFAULT NULL::jsonb, 
  p_unlocked_amount numeric DEFAULT NULL::numeric, 
  p_is_active boolean DEFAULT NULL::boolean, 
  p_lock_reason text DEFAULT NULL::text, 
  p_notes text DEFAULT NULL::text,
  p_action text DEFAULT NULL::text
)
 RETURNS TABLE(id uuid, user_id uuid, token_type text, amount numeric, lock_reason text, unlock_condition text, locked_at timestamptz, unlocked_at timestamptz, lock_start timestamptz, lock_end timestamptz, unlock_schedule jsonb, unlocked_amount numeric, is_active boolean, notes text, created_at timestamptz, profile_display_name text, profile_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_target_user_id uuid;
  v_audit_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT tl.user_id INTO v_target_user_id
  FROM public.token_locks tl
  WHERE tl.id = p_lock_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Token lock not found';
  END IF;

  -- Handle special actions
  IF p_action = 'unlock' THEN
    UPDATE public.token_locks
    SET
      is_active = false,
      unlocked_at = v_now,
      updated_at = v_now
    WHERE token_locks.id = p_lock_id;
    v_audit_action := 'ADMIN_UNLOCK';
  ELSIF p_action = 'reactivate' THEN
    UPDATE public.token_locks
    SET
      is_active = true,
      unlocked_at = NULL,
      updated_at = v_now
    WHERE token_locks.id = p_lock_id;
    v_audit_action := 'ADMIN_REACTIVATE';
  ELSE
    -- Standard update
    UPDATE public.token_locks
    SET
      amount = COALESCE(p_amount, token_locks.amount),
      lock_end = COALESCE(p_lock_end, token_locks.lock_end),
      unlock_schedule = COALESCE(p_unlock_schedule, token_locks.unlock_schedule),
      unlocked_amount = COALESCE(p_unlocked_amount, token_locks.unlocked_amount),
      is_active = COALESCE(p_is_active, token_locks.is_active),
      lock_reason = COALESCE(p_lock_reason, token_locks.lock_reason),
      notes = COALESCE(p_notes, token_locks.notes),
      updated_at = v_now,
      -- legacy compat
      unlocks_at = COALESCE(p_lock_end, token_locks.unlocks_at)
    WHERE token_locks.id = p_lock_id;
    v_audit_action := 'ADMIN_UPDATE';
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('user_id', v_target_user_id, 'action', p_action),
      p_entity_id := p_lock_id::TEXT,
      p_entity_type := 'token_lock',
      p_severity := 'info'::journal_severity,
      p_summary := 'Admin updated token lock',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT *
  FROM public.get_token_locks_admin()
  WHERE get_token_locks_admin.id = p_lock_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_token_lock_admin(p_lock_id uuid, p_amount numeric, p_lock_end timestamp with time zone, p_unlock_schedule jsonb, p_unlocked_amount numeric, p_is_active boolean, p_lock_reason text, p_notes text, p_action text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_lock_admin(p_lock_id uuid, p_amount numeric, p_lock_end timestamp with time zone, p_unlock_schedule jsonb, p_unlocked_amount numeric, p_is_active boolean, p_lock_reason text, p_notes text, p_action text) TO authenticated;
