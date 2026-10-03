-- Function: public.respond_to_story_block_audited
-- Arguments: p_action text, p_action_data jsonb, p_entry_id uuid, p_story_id uuid
-- Description: Update metadata on a story entry for block actions (accept/decline meeting, send reminder, etc.)
-- Security: SECURITY DEFINER with search_path

CREATE OR REPLACE FUNCTION public.respond_to_story_block_audited(
  p_action text,
  p_action_data jsonb DEFAULT '{}'::jsonb,
  p_entry_id uuid DEFAULT NULL,
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_story_partner_id UUID;
  v_story_user_id UUID;
  v_owner_mode TEXT;
  v_entry_type TEXT;
  v_current_metadata JSONB;
  v_new_metadata JSONB;
  v_result JSONB;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Validate required params
  IF p_entry_id IS NULL OR p_story_id IS NULL THEN
    RAISE EXCEPTION 'entry_id and story_id are required';
  END IF;

  IF p_action IS NULL OR p_action = '' THEN
    RAISE EXCEPTION 'action is required';
  END IF;

  -- 3. Authorization — verify story ownership
  v_partner_id := public.get_current_partner_id();

  SELECT ps.partner_id, ps.user_id
  INTO v_story_partner_id, v_story_user_id
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  IF v_story_partner_id IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_story_user_id = v_user_id THEN
    v_owner_mode := 'member';
  ELSE
    RAISE EXCEPTION 'Unauthorized: Story access denied';
  END IF;

  -- 4. Fetch the entry and verify it belongs to the story
  SELECT se.entry_type, se.metadata
  INTO v_entry_type, v_current_metadata
  FROM public.story_entries se
  WHERE se.id = p_entry_id
    AND se.story_id = p_story_id;

  IF v_entry_type IS NULL THEN
    RAISE EXCEPTION 'Entry not found in this story';
  END IF;

  -- 5. Process action based on entry type and action
  v_new_metadata := v_current_metadata;

  CASE p_action
    -- Meeting actions (partner only)
    WHEN 'accept_meeting' THEN
      IF v_entry_type <> 'meeting_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      v_new_metadata := v_new_metadata || jsonb_build_object(
        'status', 'accepted',
        'accepted_time', COALESCE(p_action_data->>'accepted_time', now()::text),
        'responded_by', v_user_id,
        'responded_at', now()
      );

    WHEN 'decline_meeting' THEN
      IF v_entry_type <> 'meeting_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      v_new_metadata := v_new_metadata || jsonb_build_object(
        'status', 'declined',
        'declined_reason', COALESCE(p_action_data->>'reason', ''),
        'responded_by', v_user_id,
        'responded_at', now()
      );

    WHEN 'reschedule_meeting' THEN
      IF v_entry_type <> 'meeting_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      v_new_metadata := v_new_metadata || jsonb_build_object(
        'status', 'rescheduled',
        'responded_by', v_user_id,
        'responded_at', now()
      );

    -- Questionnaire reminder (partner only)
    WHEN 'send_questionnaire_reminder' THEN
      IF v_entry_type <> 'questionnaire_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      IF v_owner_mode <> 'partner' THEN
        RAISE EXCEPTION 'Unauthorized: Only partner can send reminders';
      END IF;
      v_new_metadata := v_new_metadata || jsonb_build_object(
        'reminder_sent', true,
        'reminder_sent_at', now(),
        'reminder_sent_by', v_user_id
      );

    -- Consent resend (partner only)
    WHEN 'resend_consent_request' THEN
      IF v_entry_type <> 'consent_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      IF v_owner_mode <> 'partner' THEN
        RAISE EXCEPTION 'Unauthorized: Only partner can resend consent';
      END IF;
      v_new_metadata := v_new_metadata || jsonb_build_object(
        'last_resent_at', now(),
        'resent_by', v_user_id,
        'resent_count', COALESCE((v_current_metadata->>'resent_count')::int, 0) + 1
      );

    -- Flowboard consent-gate approval: the run owner approves a halted gate so the (stateless)
    -- executor reads metadata.flowboard.status='approved' on a resume re-invoke and continues past
    -- the gate. Story-access (member/partner) is already verified above; no extra owner restriction
    -- (the run owner reviews their own automation before a sensitive step). Distinct from the
    -- clinical consent_request block (metadata.type), which has no metadata.flowboard.kind.
    WHEN 'approve_flow_gate' THEN
      IF v_entry_type <> 'consent_request' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      IF v_current_metadata->'flowboard'->>'kind' IS DISTINCT FROM 'consent_request' THEN
        RAISE EXCEPTION USING MESSAGE = 'approve_flow_gate applies only to a Flowboard consent gate', ERRCODE = '22023';
      END IF;
      v_new_metadata := jsonb_set(
        v_new_metadata,
        '{flowboard}',
        COALESCE(v_new_metadata->'flowboard', '{}'::jsonb) || jsonb_build_object(
          'status', 'approved',
          'approved_by', v_user_id,
          'approved_at', now()
        )
      );

    -- Repricing decision: the responsible person confirms/rejects a reprice IN the story
    -- (the human gate the user described). Like the Flowboard gate, this only STAMPS the
    -- entry; a fork-additive trigger reflects metadata.reprice.status into the
    -- hub_reprice_proposal projection (executor-reads-stamp). Story access already verified
    -- above, so authorization is story ownership/participation — not a global role.
    WHEN 'confirm_reprice' THEN
      IF v_entry_type <> 'reprice_proposal' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      v_new_metadata := jsonb_set(
        v_new_metadata, '{reprice}',
        COALESCE(v_new_metadata->'reprice', '{}'::jsonb) || jsonb_build_object(
          'status', 'confirmed', 'responded_by', v_user_id, 'responded_at', now()));

    WHEN 'reject_reprice' THEN
      IF v_entry_type <> 'reprice_proposal' THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid action for entry type %s', v_entry_type), ERRCODE = '22023';
      END IF;
      v_new_metadata := jsonb_set(
        v_new_metadata, '{reprice}',
        COALESCE(v_new_metadata->'reprice', '{}'::jsonb) || jsonb_build_object(
          'status', 'rejected', 'responded_by', v_user_id, 'responded_at', now(),
          'reject_reason', COALESCE(p_action_data->>'reason', '')));

    ELSE
      RAISE EXCEPTION 'Unknown action: %', p_action;
  END CASE;

  -- 6. Update entry metadata
  UPDATE public.story_entries
  SET metadata = v_new_metadata
  WHERE id = p_entry_id
    AND story_id = p_story_id;

  -- 7. Update story last_activity
  UPDATE public.partner_stories
  SET last_activity_at = now()
  WHERE id = p_story_id;

  -- 8. Build result
  v_result := jsonb_build_object(
    'success', true,
    'action', p_action,
    'entry_id', p_entry_id,
    'updated_metadata', v_new_metadata
  );

  -- 9. Audit log (no sensitive data)
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := CASE
      WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
      ELSE 'member'::public.journal_area
    END,
    p_details := jsonb_build_object(
      'owner_mode', v_owner_mode,
      'story_id', p_story_id,
      'entry_id', p_entry_id,
      'entry_type', v_entry_type,
      'action', p_action
    ),
    p_entity_id := p_entry_id::text,
    p_entity_type := 'story_entries',
    p_severity := 'info'::public.journal_severity,
    p_summary := format('Block action: %s on %s', p_action, v_entry_type),
    p_user_id := v_user_id
  );

  RETURN v_result;
END;
$function$
;

COMMENT ON FUNCTION public.respond_to_story_block_audited(text, jsonb, uuid, uuid) IS
'Processes block actions (accept/decline meeting, send reminder, resend consent, approve flowboard gate, confirm/reject reprice) on story entries. Audited.';

-- Permissions
REVOKE ALL ON FUNCTION public.respond_to_story_block_audited(text, jsonb, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_to_story_block_audited(text, jsonb, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.respond_to_story_block_audited(text, jsonb, uuid, uuid) TO authenticated;
