-- =============================================================================
-- Function: fn_notify_ai_feedback_ready
-- Purpose: Notify local listeners and n8n when new AI feedback arrives
-- Part of: AISHA Learning Engine (ALE) — event-driven feedback pipeline
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_notify_ai_feedback_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_correction boolean := false;
  v_is_service_role boolean := false;
  v_payload jsonb;
  v_pending_count integer := 0;
  v_request_id bigint;
  v_webhook_url text;
BEGIN
  v_is_service_role := COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
    false
  );

  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Unauthorized: authenticated or service_role required';
  END IF;

  IF TG_OP <> 'INSERT' OR NEW.is_processed THEN
    RETURN NEW;
  END IF;

  v_has_correction := NEW.correction_text IS NOT NULL AND length(trim(NEW.correction_text)) > 10;

  SELECT count(*)
  INTO v_pending_count
  FROM public.ai_feedback af
  WHERE af.is_processed = false
    AND (
      (NEW.org_id IS NULL AND af.org_id IS NULL)
      OR af.org_id = NEW.org_id
    );

  v_payload := jsonb_build_object(
    'feedback_id', NEW.id,
    'org_id', NEW.org_id,
    'story_id', NEW.story_id,
    'run_id', NEW.run_id,
    'rating', NEW.rating,
    'feedback_category', NEW.feedback_category,
    'domain_tags', to_jsonb(COALESCE(NEW.domain_tags, '{}'::text[])),
    'has_correction', v_has_correction,
    'pending_count', v_pending_count,
    'triggered_at', now(),
    'source', 'db_trigger'
  );

  PERFORM pg_notify('ale_feedback_ready', v_payload::text);

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    NEW.user_id,
    'ALE_FEEDBACK_READY',
    jsonb_build_object(
      'area', 'ai_feedback',
      'severity', CASE WHEN v_has_correction THEN 'notice' ELSE 'info' END,
      'entity_type', 'ai_feedback',
      'entity_id', NEW.id,
      'pending_count', v_pending_count,
      'story_id', NEW.story_id
    )
  );

  BEGIN
    v_webhook_url := current_setting('app.settings.n8n_webhook_base_url', true);
    IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
      SELECT net.http_post(
        url     := v_webhook_url || '/webhook/ale-feedback-process',
        body    := v_payload,
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- user_id = auth.uid() (nullable): the '00000000-…0000' sentinel is not a real
    -- aisha_auth.users row → it violated audit_journal_user_id_fkey and turned a
    -- webhook hiccup into a hard failure of the triggering statement.
    INSERT INTO audit_journal(user_id, action, metadata)
    VALUES (
      auth.uid(),
      'ALE_WEBHOOK_DELIVERY_FAILED',
      jsonb_build_object(
        'severity', 'warning',
        'channel', 'ale_feedback_process',
        'feedback_id', NEW.id,
        'error', SQLERRM
      )
    );
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_ai_feedback_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_notify_ai_feedback_ready() TO service_role;

COMMENT ON FUNCTION public.fn_notify_ai_feedback_ready() IS
  'Trigger function for ai_feedback inserts. Emits pg_notify ale_feedback_ready and bridges to n8n webhook when configured.';