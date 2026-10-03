-- Function: fn_notify_rule_change

CREATE OR REPLACE FUNCTION public.fn_notify_rule_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule_id uuid;
  v_action text;
  v_affected integer;
  v_payload jsonb;
  v_run_id uuid;
  v_webhook_url text;
BEGIN
  -- Determine the rule_id and action
  IF TG_OP = 'DELETE' THEN
    v_rule_id := OLD.id;
    v_action := 'deleted';
  ELSE
    v_rule_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'created';
    ELSE
      -- Only propagate on meaningful changes
      IF OLD.status = NEW.status
         AND OLD.version = NEW.version
         AND OLD.ai_instructions IS NOT DISTINCT FROM NEW.ai_instructions
         AND OLD.body_markdown IS NOT DISTINCT FROM NEW.body_markdown
         AND OLD.slug = NEW.slug
      THEN
        -- No meaningful change, skip propagation
        RETURN NEW;
      END IF;
      v_action := 'updated';
    END IF;
  END IF;

  -- 1. Recalculate affected ruleset fingerprints
  v_affected := fn_recalculate_ruleset_fingerprint(v_rule_id);

  -- 2. Build notification payload
  v_payload := jsonb_build_object(
    'rule_id', v_rule_id,
    'action', v_action,
    'slug', CASE WHEN TG_OP = 'DELETE' THEN OLD.slug ELSE NEW.slug END,
    'status', CASE WHEN TG_OP = 'DELETE' THEN OLD.status::text ELSE NEW.status::text END,
    'rulesets_affected', v_affected,
    'triggered_at', now()
  );

  -- 3. Create ai_run for trace FK
  v_run_id := gen_random_uuid();
  -- §16: a platform/system run has no tenant story, so it is anchored to the
  -- STACK-DEFAULT story — a real row, not a zero-uuid placeholder. The sentinel
  -- satisfied NOT NULL but referenced nothing, which is why story_id could never
  -- carry a foreign key. With a real anchor the constraint becomes enforceable
  -- AND fn_authorize_task_spend stops being handed a story that does not exist.
  --
  -- ⛔ story_id NULL, NE `ensure_stack_default_story()` (naměřeno 2026-09-29): ta je
  -- SECURITY INVOKER s guardem „admin/staff nebo service_role“ nad claims VOLAJÍCÍHO,
  -- takže každá změna pravidla pod běžnou identitou (autor-partner, publish_expert_rule)
  -- padala „Unauthorized“ uvnitř tohoto triggeru. Kotvu doplní BEFORE INSERT trigger
  -- `fn_ai_runs_default_story` vyhledáním (jeden domov invariantu, 2026-09-27); zápis
  -- pravidla autorizuje RLS na expert_rules, trigger je jen jeho vedlejší záznam.
  INSERT INTO ai_runs (id, story_id, kind, status, started_at, finished_at, cost_total_json, metadata)
  VALUES (
    v_run_id,
    NULL,
    'proactive',
    'succeeded',
    now(),
    now(),
    '{"usd": 0}'::jsonb,
    v_payload
  );

  -- 4. Log trace event
  INSERT INTO ai_trace_events (
    run_id,
    event_type,
    agent_slug,
    operation,
    status,
    request_summary,
    created_at
  ) VALUES (
    v_run_id,
    'proactive_trigger',
    'dirigent',
    'rule_propagation',
    'ok',
    v_payload,
    now()
  );

  -- 5. Send pg_notify for local listeners (edge functions, realtime)
  PERFORM pg_notify('expert_rule_changed', v_payload::text);

  -- 6. Bridge to n8n webhook via pg_net (if configured)
  --    Set n8n URL via: ALTER DATABASE postgres SET app.settings.n8n_webhook_base_url = 'https://...';
  DECLARE
    v_request_id bigint;
  BEGIN
    v_webhook_url := current_setting('app.settings.n8n_webhook_base_url', true);
    IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
      SELECT net.http_post(
        url     := v_webhook_url || '/webhook/rule-propagation',
        body    := v_payload,
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net not available or network error — rely on pg_notify only.
    -- NOTE: intentionally NO audit_journal insert here. The fallback user_id
    -- '00000000-...' is not FK-valid in aisha_auth.users and would abort the caller's
    -- transaction (breaks any INSERT into expert_rules from a migration run as
    -- supabase_admin where auth.uid() is NULL).
    NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION fn_notify_rule_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_notify_rule_change() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_notify_rule_change() TO service_role;
