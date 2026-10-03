-- Function: public.update_story_status_audited
-- Arguments: p_story_id uuid, p_status text
-- Description: Audited mutation for partner_stories.status (kanban lifecycle).
--   Validates the target status AND the (from, to) transition against
--   workflow_status_transitions. Enforces role gating (requires_role='admin')
--   for terminal-state un-archive / un-trash transitions.
-- Security: SECURITY DEFINER; row-level FOR UPDATE lock prevents TOCTOU;
--   ownership check ensures partners and members can only mutate their own
--   stories (admin/staff path bypasses ownership via is_admin_or_staff).
-- See also: workflow_statuses (lookup), workflow_status_transitions (graph),
--   get_allowed_kanban_transitions (read-only counterpart),
--   transition_story_delivery_status (parallel function for delivery_status).

CREATE OR REPLACE FUNCTION public.update_story_status_audited(
  p_story_id uuid,
  p_status   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_partner_id   uuid;
  v_owner_mode   text;
  v_audit_area   public.journal_area;
  v_old_status   text;
  v_rule         RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_partner_id := public.get_current_partner_id();
  v_owner_mode := CASE WHEN v_partner_id IS NOT NULL THEN 'partner' ELSE 'member' END;
  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  -- ATOMIC: lock the story row with ownership check (FOR UPDATE) to prevent
  -- TOCTOU. No other transaction can change ownership between our SELECT
  -- and UPDATE.
  IF v_owner_mode = 'partner' THEN
    SELECT ps.status
      INTO v_old_status
    FROM public.partner_stories ps
    WHERE ps.id = p_story_id
      AND ps.partner_id = v_partner_id
    FOR UPDATE;
  ELSE
    SELECT ps.status
      INTO v_old_status
    FROM public.partner_stories ps
    WHERE ps.id = p_story_id
      AND ps.user_id = v_user_id
    FOR UPDATE;
  END IF;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Story not found or unauthorized' USING ERRCODE = 'P0002';
  END IF;

  -- Validate that the (from_status, to_status) transition is legal.
  SELECT t.id, t.requires_role
    INTO v_rule
  FROM public.workflow_status_transitions t
  WHERE t.is_active = true
    AND t.from_status = v_old_status
    AND t.to_status   = p_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Transition from %s to %s is not allowed',
        v_old_status, p_status
      ),
      ERRCODE = '22023';  -- invalid_parameter_value (kept for backward compat)
  END IF;

  -- Enforce role gating for transitions that require admin/staff
  -- (e.g. de-archive, un-trash).
  IF v_rule.requires_role IS NOT NULL THEN
    IF NOT public.is_admin_or_staff(v_user_id) THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Transition to %s requires role: %s',
          p_status, v_rule.requires_role
        ),
        ERRCODE = '42501';  -- insufficient_privilege
    END IF;
  END IF;

  -- Row is locked — safe to update without repeating ownership check.
  UPDATE public.partner_stories
     SET status     = p_status,
         updated_at = now()
   WHERE id = p_story_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area        := v_audit_area,
    p_details     := jsonb_build_object('transition_rule_id', v_rule.id),
    p_entity_id   := p_story_id::text,
    p_entity_type := 'partner_stories',
    p_new_values  := jsonb_build_object('status', p_status),
    p_old_values  := jsonb_build_object('status', v_old_status),
    p_severity    := 'info'::public.journal_severity,
    p_summary     := CASE
      WHEN v_owner_mode = 'partner' THEN 'Partner updated story status'
      ELSE 'Member updated story status'
    END,
    p_user_id     := v_user_id
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_story_status_audited(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_story_status_audited(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_story_status_audited(uuid, text) TO authenticated;
