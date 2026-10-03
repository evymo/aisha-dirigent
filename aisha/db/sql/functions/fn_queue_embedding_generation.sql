-- Function: fn_queue_embedding_generation
-- Trigger function for knowledge_items INSERT/UPDATE → auto-generate embeddings
-- Fires pg_notify on 'kb_embedding_sync' channel and optionally calls
-- the generate-knowledge-embeddings edge function via pg_net.
--
-- Requires app settings (optional, graceful degradation):
--   app.settings.supabase_functions_internal_url  (e.g. http://gateway:8000)
--   app.settings.supabase_service_role_key        (service role JWT)
--
-- When settings are not configured, only pg_notify fires (picked up by n8n or
-- external listeners).

CREATE OR REPLACE FUNCTION public.fn_queue_embedding_generation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_item_id uuid;
  v_action text;
  v_payload jsonb;
  v_functions_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  -- Only process meaningful content changes
  IF TG_OP = 'UPDATE' THEN
    -- Skip if content fields didn't change
    IF OLD.body_markdown IS NOT DISTINCT FROM NEW.body_markdown
       AND OLD.ai_instructions IS NOT DISTINCT FROM NEW.ai_instructions
       AND OLD.title IS NOT DISTINCT FROM NEW.title
       AND OLD.summary IS NOT DISTINCT FROM NEW.summary
    THEN
      RETURN NEW;
    END IF;
  END IF;

  v_item_id := NEW.id;

  -- Skip non-active items (no point embedding drafts/archived)
  IF NEW.status != 'active' THEN
    RETURN NEW;
  END IF;

  v_action := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;

  -- Build notification payload
  v_payload := jsonb_build_object(
    'item_id', v_item_id,
    'action', v_action,
    'title', NEW.title,
    'source_slug', NEW.source_slug,
    'item_type', NEW.item_type::text,
    'triggered_at', now()
  );

  -- 1. pg_notify for external listeners (n8n, custom workers)
  PERFORM pg_notify('kb_embedding_sync', v_payload::text);

  -- 2. Audit trail
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'KB_EMBEDDING_QUEUED',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'entity_type', 'knowledge_item',
      'entity_id', v_item_id,
      'change_action', v_action,
      'source_slug', NEW.source_slug
    )
  );

  -- 3. Direct edge function call via pg_net (if configured)
  BEGIN
    v_functions_url := current_setting('app.settings.supabase_functions_internal_url', true);
    v_service_key := current_setting('app.settings.supabase_service_role_key', true);

    IF v_functions_url IS NOT NULL AND v_functions_url != ''
       AND v_service_key IS NOT NULL AND v_service_key != ''
    THEN
      SELECT net.http_post(
        url     := v_functions_url || '/functions/v1/generate-knowledge-embeddings',
        body    := jsonb_build_object(
          'item_id', v_item_id::text,
          'force', (TG_OP = 'UPDATE')  -- force re-embed on update
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        )
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net not available or HTTP call failed — pg_notify still works
    -- Log the failure for debugging but don't block the transaction
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'KB_EMBEDDING_QUEUE_FAILED',
      jsonb_build_object(
        'area', 'knowledge',
        'severity', 'warning',
        'entity_type', 'knowledge_item',
        'entity_id', v_item_id,
        'error', SQLERRM
      )
    );
    NULL;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION fn_queue_embedding_generation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_queue_embedding_generation() TO service_role;
