-- Function: recalculate_all_ruleset_fingerprints

CREATE OR REPLACE FUNCTION public.recalculate_all_ruleset_fingerprints()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_affected integer := 0;
  v_ruleset RECORD;
  v_new_fingerprint text;
  v_run_id uuid;
BEGIN
  FOR v_ruleset IN
    SELECT id, rule_ids FROM story_rulesets
  LOOP
    SELECT md5(string_agg(
      er.slug || ':' || er.version::text || ':' || COALESCE(er.ai_instructions, ''),
      '|' ORDER BY er.slug
    ))
    INTO v_new_fingerprint
    FROM expert_rules er
    WHERE er.id = ANY(v_ruleset.rule_ids)
      AND er.status = 'published';

    UPDATE story_rulesets
    SET ruleset_fingerprint = COALESCE(v_new_fingerprint, 'empty')
    WHERE id = v_ruleset.id
      AND ruleset_fingerprint IS DISTINCT FROM COALESCE(v_new_fingerprint, 'empty');

    IF FOUND THEN
      v_total_affected := v_total_affected + 1;
    END IF;
  END LOOP;

  -- Log the batch operation
  v_run_id := gen_random_uuid();
  -- §16: platform/system run → platform sentinel story (ai_runs.story_id NOT NULL).
  INSERT INTO ai_runs (id, story_id, kind, status, started_at, finished_at, cost_total_json, metadata)
  VALUES (
    v_run_id,
    public.ensure_stack_default_story(),
    'proactive',
    'succeeded',
    now(),
    now(),
    '{"usd": 0}'::jsonb,
    jsonb_build_object('rulesets_affected', v_total_affected)
  );

  INSERT INTO ai_trace_events (
    run_id, event_type, agent_slug, operation, status,
    request_summary, created_at
  ) VALUES (
    v_run_id, 'proactive_trigger', 'dirigent',
    'batch_fingerprint_recalculation', 'ok',
    jsonb_build_object('rulesets_affected', v_total_affected), now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'rulesets_recalculated', v_total_affected
  );
END;
$function$;

REVOKE ALL ON FUNCTION recalculate_all_ruleset_fingerprints() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_all_ruleset_fingerprints() TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_all_ruleset_fingerprints() TO service_role;
