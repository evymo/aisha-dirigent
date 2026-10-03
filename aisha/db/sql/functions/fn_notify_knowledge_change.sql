-- Function: fn_notify_knowledge_change
-- Trigger function for knowledge_items and expert_rules changes → Ragnarok KB sync
-- Fires webhook to n8n WF_KB_RAGNAROK_SYNC workflow
--
-- Unlike fn_notify_rule_change (which handles copilot-instructions propagation),
-- this function handles the Ragnarok search index synchronization.

CREATE OR REPLACE FUNCTION public.fn_notify_knowledge_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_source_id uuid;
  v_source_slug text;
  v_action text;
  v_title text;
  v_category text;
  v_tags text[];
  v_story_id uuid;
  v_payload jsonb;
  v_webhook_url text;
BEGIN
  -- Determine action
  IF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSE
    v_action := 'updated';
  END IF;

  -- Extract fields based on source table
  IF TG_TABLE_NAME = 'expert_rules' THEN
    IF TG_OP = 'DELETE' THEN
      v_source_id := OLD.id;
      v_source_slug := OLD.slug;
      v_title := OLD.title;
      v_category := OLD.category::text;
      v_tags := OLD.ai_context_tags;
    ELSE
      v_source_id := NEW.id;
      v_source_slug := NEW.slug;
      v_title := NEW.title;
      v_category := NEW.category::text;
      v_tags := NEW.ai_context_tags;

      -- Skip if only timestamp changed (not meaningful for Ragnarok)
      IF TG_OP = 'UPDATE'
         AND OLD.body_markdown IS NOT DISTINCT FROM NEW.body_markdown
         AND OLD.ai_instructions IS NOT DISTINCT FROM NEW.ai_instructions
         AND OLD.title IS NOT DISTINCT FROM NEW.title
         AND OLD.summary IS NOT DISTINCT FROM NEW.summary
         AND OLD.status IS NOT DISTINCT FROM NEW.status
      THEN
        RETURN NEW;
      END IF;

      -- Skip draft and review rules (only sync published/archived)
      -- review = pending AISHA compliance gate, not yet approved
      IF NEW.status IN ('draft', 'review') THEN
        RETURN NEW;
      END IF;

      -- If archived, treat as delete from Ragnarok
      IF NEW.status = 'archived' THEN
        v_action := 'archived';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'knowledge_items' THEN
    IF TG_OP = 'DELETE' THEN
      v_source_id := OLD.id;
      v_source_slug := OLD.source_slug;
      v_title := OLD.title;
      v_category := OLD.category;
      v_tags := OLD.ai_context_tags;
      v_story_id := OLD.story_id;
    ELSE
      v_source_id := NEW.id;
      v_source_slug := NEW.source_slug;
      v_title := NEW.title;
      v_category := NEW.category;
      v_tags := NEW.ai_context_tags;
      v_story_id := NEW.story_id;

      -- Skip non-meaningful changes
      IF TG_OP = 'UPDATE'
         AND OLD.body_markdown IS NOT DISTINCT FROM NEW.body_markdown
         AND OLD.ai_instructions IS NOT DISTINCT FROM NEW.ai_instructions
         AND OLD.title IS NOT DISTINCT FROM NEW.title
         AND OLD.summary IS NOT DISTINCT FROM NEW.summary
         AND OLD.status IS NOT DISTINCT FROM NEW.status
      THEN
        RETURN NEW;
      END IF;

      -- Skip inactive items
      IF NEW.status != 'active' AND v_action = 'created' THEN
        RETURN NEW;
      END IF;

      -- If archived, treat as delete from Ragnarok
      IF NEW.status = 'archived' THEN
        v_action := 'archived';
      END IF;
    END IF;
  END IF;

  -- Build payload (story_id surfaces per-story scope to n8n; routes upload to
  -- Ragnarok project_id='story-{uuid}' so Maestro per-story queries find it)
  v_payload := jsonb_build_object(
    'source_table', TG_TABLE_NAME,
    'source_id', v_source_id,
    'source_slug', v_source_slug,
    'story_id', v_story_id,
    'action', v_action,
    'title', v_title,
    'category', v_category,
    'tags', to_jsonb(COALESCE(v_tags, ARRAY[]::text[])),
    'triggered_at', now()
  );

  -- 1. pg_notify for local listeners
  PERFORM pg_notify('kb_ragnarok_sync', v_payload::text);

  -- 2. Log to audit_journal (user_id is NULL during seed/system triggers)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'KB_RAGNAROK_SYNC_TRIGGER',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'entity_type', TG_TABLE_NAME,
      'entity_id', v_source_id,
      'change_action', v_action,
      'source_slug', v_source_slug
    )
  );

  -- 3. Bridge to n8n webhook via pg_net (if configured)
  DECLARE
    v_request_id bigint;
  BEGIN
    v_webhook_url := current_setting('app.settings.n8n_webhook_base_url', true);
    IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
      SELECT net.http_post(
        url     := v_webhook_url || '/webhook/kb-ragnarok-sync',
        body    := v_payload,
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net not available — pg_notify still works, but log the failure.
    -- user_id = auth.uid() (nullable, same as the success-path audit above): the
    -- previous '00000000-…0000' sentinel is NOT a real aisha_auth.users row, so
    -- this INSERT violated audit_journal_user_id_fkey and RAISEd — turning any
    -- webhook hiccup on an expert_rule/knowledge_item DELETE/publish/archive into
    -- a hard failure of the triggering statement. FK allows NULL, so auth.uid()
    -- (NULL for system/seed triggers) is safe.
    INSERT INTO audit_journal(user_id, action, metadata)
    VALUES (
      auth.uid(),
      'KB_WEBHOOK_DELIVERY_FAILED',
      jsonb_build_object(
        'severity', 'warning',
        'channel', 'kb_ragnarok_sync',
        'entity_type', TG_TABLE_NAME,
        'entity_id', v_source_id,
        'error', SQLERRM
      )
    );
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION fn_notify_knowledge_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_notify_knowledge_change() TO service_role;
