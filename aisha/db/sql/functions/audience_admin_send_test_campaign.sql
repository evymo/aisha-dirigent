-- Function: audience_admin_send_test_campaign

CREATE OR REPLACE FUNCTION public.audience_admin_send_test_campaign(p_campaign_id uuid, p_recipient_user_id uuid, p_channel text DEFAULT 'email'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id UUID;
  v_outbox_id UUID;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Create one-off test run
  INSERT INTO public.notification_campaign_runs (
    campaign_id, run_at, status, recipients_count, push_sent, inapp_sent
  ) VALUES (
    p_campaign_id, now(), 'running', 1, 0, 0
  )
  RETURNING id INTO v_run_id;

  -- Route to openclaw
  v_outbox_id := public.audience_route_campaign_to_openclaw(v_run_id, p_recipient_user_id, p_channel);

  PERFORM public.audience_log_event(
    'send_test_campaign',
    'audience_admin_send_test_campaign',
    'notification_campaign',
    p_campaign_id,
    format('Sent test of campaign %s to %s via %s', p_campaign_id, p_recipient_user_id, p_channel),
    jsonb_build_object('recipient', p_recipient_user_id, 'channel', p_channel, 'outbox_id', v_outbox_id)
  );

  RETURN v_outbox_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_send_test_campaign(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_send_test_campaign(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_send_test_campaign(uuid,uuid,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_send_test_campaign(uuid,uuid,text) TO service_role;
