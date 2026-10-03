-- Function: fn_anchor_decision
-- Cosmos cognition anchor: compose a canonical decision payload from a
-- reflection run, hash it (SHA-256), and queue it into the existing
-- blockchain_audit_records outbox. Cross-chain sync is handled downstream by
-- svc-blockchain (Cosmos ledger dispatcher) per its existing pipeline.
--
-- The anchor binds: run metadata + workflow definition + ruleset fingerprint
-- (from compose_context) + hippocampus memory IDs used. Immutable, replayable.

CREATE OR REPLACE FUNCTION public.fn_anchor_decision(
  p_run_id uuid,
  p_decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_run                RECORD;
  v_workflow_name      text;
  v_workflow_version   int;
  v_canonical_payload  jsonb;
  v_canonical_json     text;
  v_payload_hash       text;
  v_memory_ids         uuid[];
  v_node_count         int;
  v_ruleset_fingerprint text;
  v_audit_id           uuid;
  v_user_id            uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required';
  END IF;

  -- Load the run + workflow metadata
  SELECT r.*, d.name AS wf_name, d.version AS wf_version
  INTO v_run
  FROM ai_runs r
  LEFT JOIN ai_workflow_definitions d ON d.id = r.workflow_definition_id
  WHERE r.id = p_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'ai_run % not found', p_run_id;
  END IF;

  v_workflow_name := COALESCE(v_run.wf_name, 'inline');
  v_workflow_version := COALESCE(v_run.wf_version, 1);

  -- Hippocampus memories that contributed to / were produced by this run.
  -- A run uses a learning when fn_search_learnings retrieved it (tracked via
  -- audit_journal action='hippocampus.learnings_retrieved'); a run produces
  -- one when source_run_id matches.
  SELECT COALESCE(array_agg(DISTINCT am.id), ARRAY[]::uuid[])
  INTO v_memory_ids
  FROM agent_memories am
  WHERE am.source_run_id = p_run_id
     OR am.id::text IN (
       SELECT jsonb_array_elements_text(metadata -> 'memory_ids')
       FROM audit_journal
       WHERE action = 'hippocampus.learnings_retrieved'
         AND metadata ->> 'run_id' = p_run_id::text
     );

  -- Node count + ruleset fingerprint from run checkpoint
  SELECT COUNT(*) INTO v_node_count
  FROM ai_workflow_node_runs
  WHERE run_id = p_run_id;

  v_ruleset_fingerprint := v_run.metadata
    #> '{checkpoint,state,composed_context,layers,ruleset,fingerprint}' #>> '{}';

  -- Canonical payload — deterministic, sorted, hashable. Excludes timestamps
  -- where they would cause replay-incompatibility (we keep run started_at as
  -- a witnessed moment, but no `now()`).
  v_canonical_payload := jsonb_build_object(
    'schema', 'aisha.cosmos.anchor.v1',
    'run_id', p_run_id,
    'run_kind', v_run.kind,
    'workflow_name', v_workflow_name,
    'workflow_version', v_workflow_version,
    'workflow_definition_id', v_run.workflow_definition_id,
    'story_id', v_run.story_id,
    'actor_user_id', v_run.actor_user_id,
    'ruleset_fingerprint', v_ruleset_fingerprint,
    'hippocampus_memory_ids', to_jsonb(v_memory_ids),
    'node_count', v_node_count,
    'status', v_run.status,
    'started_at', v_run.started_at,
    'finished_at', v_run.finished_at,
    'cost_total', v_run.cost_total_json,
    'decision_context', COALESCE(p_decision_context, '{}'::jsonb)
  );

  -- Hash the canonical JSON form. We sort keys deterministically by relying on
  -- jsonb_build_object key ordering (insertion order) which is preserved.
  v_canonical_json := v_canonical_payload::text;
  v_payload_hash := encode(digest(v_canonical_json, 'sha256'), 'hex');

  -- Queue the audit record via existing outbox helper
  v_user_id := COALESCE(auth.uid(), v_run.actor_user_id);

  INSERT INTO blockchain_audit_records (
    record_type,
    record_hash,
    data,
    status
  )
  VALUES (
    'aisha_cognition_anchor',
    v_payload_hash,
    v_canonical_payload || jsonb_build_object('created_by', v_user_id),
    'queued'
  )
  RETURNING id INTO v_audit_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'cosmos.decision_anchored',
    jsonb_build_object(
      'run_id', p_run_id,
      'audit_record_id', v_audit_id,
      'payload_hash', v_payload_hash,
      'workflow_name', v_workflow_name,
      'memory_ids_count', COALESCE(array_length(v_memory_ids, 1), 0)
    )
  );

  RETURN jsonb_build_object(
    'audit_record_id', v_audit_id,
    'payload_hash', v_payload_hash,
    'status', 'queued',
    'workflow_name', v_workflow_name,
    'workflow_version', v_workflow_version,
    'memory_ids_count', COALESCE(array_length(v_memory_ids, 1), 0)
  );
END;
$$;

COMMENT ON FUNCTION public.fn_anchor_decision(uuid, jsonb) IS
  'Cosmos cognition anchor: composes canonical reflection payload (run + workflow + '
  'ruleset fingerprint + hippocampus memory IDs), SHA-256 hashes it, queues into '
  'blockchain_audit_records outbox for svc-blockchain to dispatch to Cosmos ledger.';

REVOKE ALL ON FUNCTION public.fn_anchor_decision(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_anchor_decision(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_anchor_decision(uuid, jsonb) TO service_role;
