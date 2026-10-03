-- Function: audience_route_campaign_to_openclaw

CREATE OR REPLACE FUNCTION public.audience_route_campaign_to_openclaw(p_campaign_run_id uuid, p_recipient_user_id uuid, p_channel text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.notification_campaigns%ROWTYPE;
  v_run public.notification_campaign_runs%ROWTYPE;
  v_outbox_id UUID;
  v_user_email TEXT;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: service_role or admin/staff required to route campaign to outbox'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Load run + campaign
  SELECT * INTO v_run FROM public.notification_campaign_runs WHERE id = p_campaign_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign run % not found', p_campaign_run_id;
  END IF;

  SELECT * INTO v_campaign FROM public.notification_campaigns WHERE id = v_run.campaign_id;

  -- Validate channel is in campaign.channels
  IF NOT (p_channel = ANY(v_campaign.channels)) THEN
    RAISE EXCEPTION 'Channel % not enabled for campaign %', p_channel, v_campaign.id;
  END IF;

  -- Lookup recipient email/handle (for text recipient field)
  SELECT email INTO v_user_email FROM public.profiles WHERE user_id = p_recipient_user_id;

  -- Insert into openclaw outbox
  -- openclaw_notifications schema: channel + recipient (text) + template +
  -- payload (jsonb) + lifecycle. We additionally set user_id + campaign_id
  -- (new columns) for per-actor tracking.
  INSERT INTO public.openclaw_notifications (
    channel, recipient, template, payload, status,
    user_id, campaign_id, campaign_run_id,
    created_at
  ) VALUES (
    p_channel,
    COALESCE(v_user_email, p_recipient_user_id::text),
    'campaign',
    jsonb_build_object(
      'campaign_id', v_campaign.id,
      'campaign_name', v_campaign.name,
      'title_key', v_campaign.title_key,
      'body_key', v_campaign.body_key,
      'description', v_campaign.description,
      'user_id', p_recipient_user_id,
      'link', v_campaign.link
    ),
    'queued',
    p_recipient_user_id, v_campaign.id, p_campaign_run_id,
    now()
  )
  RETURNING id INTO v_outbox_id;

  RETURN v_outbox_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_route_campaign_to_openclaw(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_route_campaign_to_openclaw(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_route_campaign_to_openclaw(uuid,uuid,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_route_campaign_to_openclaw(uuid,uuid,text) TO service_role;
