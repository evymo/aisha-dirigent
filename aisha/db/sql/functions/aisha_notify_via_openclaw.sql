-- Function: aisha_notify_via_openclaw
-- AISHA → OpenClaw multi-channel notification enqueue.
-- INSERT into openclaw_notifications outbox; WF_OPENCLAW_NOTIFY n8n workflow
-- scans every 30s and dispatches to the configured channel.

CREATE OR REPLACE FUNCTION public.aisha_notify_via_openclaw(
  p_channel text,
  p_recipient text,
  p_payload jsonb,
  p_template text DEFAULT 'plain',
  p_agent_slug text DEFAULT 'aisha',
  p_related_run_id uuid DEFAULT NULL,
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_channel NOT IN ('telegram','slack','matrix','discord','email','in_app') THEN
    RAISE EXCEPTION 'Invalid channel: %', p_channel USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR p_payload = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_payload is required' USING ERRCODE = '22023';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO openclaw_notifications (
    channel, recipient, template, payload,
    status, agent_slug, related_run_id, story_id,
    created_by
  )
  VALUES (
    p_channel, p_recipient, COALESCE(p_template, 'plain'), p_payload,
    'queued', p_agent_slug, p_related_run_id, p_story_id,
    v_user_id
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id, 'openclaw.notification_queued',
    jsonb_build_object(
      'notification_id', v_id,
      'channel', p_channel,
      'recipient', p_recipient,
      'template', p_template,
      'agent_slug', p_agent_slug,
      'related_run_id', p_related_run_id
    )
  );

  RETURN jsonb_build_object('notification_id', v_id, 'status', 'queued');
END;
$$;

COMMENT ON FUNCTION public.aisha_notify_via_openclaw(text, text, jsonb, text, text, uuid, uuid) IS
  'Enqueue a notification into the openclaw_notifications outbox. n8n '
  'WF_OPENCLAW_NOTIFY dispatches every 30s.';

REVOKE ALL ON FUNCTION public.aisha_notify_via_openclaw(text, text, jsonb, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_notify_via_openclaw(text, text, jsonb, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_notify_via_openclaw(text, text, jsonb, text, text, uuid, uuid) TO service_role;
