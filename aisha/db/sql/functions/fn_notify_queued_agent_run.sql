-- Function: fn_notify_queued_agent_run
-- Event source for the agent-runner: replaces svc-agent-runner's 500ms poll of
-- claim_queued_claude_run with a wake-on-event. Fires pg_notify('agent_run_queued')
-- the moment a claude_cli_task run BECOMES claimable — i.e. inserted already-queued,
-- or an approval-held run just got approved. event-worker (the cluster's LISTEN hub)
-- forwards the payload to svc-agent-runner's /wake endpoint, which claims immediately
-- (FOR UPDATE SKIP LOCKED, unchanged). A missed NOTIFY is harmless: the runner keeps a
-- slow safety-net poll. Claimable mirrors claim_queued_claude_run's guard exactly.
--
-- Includes table/schema in the payload so event-worker's existing table-keyed
-- webhookRoutes map routes it with config only (no event-worker code change).

CREATE OR REPLACE FUNCTION public.fn_notify_queued_agent_run()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_new_claimable boolean;
  v_old_claimable boolean;
BEGIN
  -- Claimable = a queued claude_cli_task not held for approval (mirror of the claim RPC).
  v_new_claimable := (NEW.kind = 'claude_cli_task'
                      AND NEW.status = 'queued'
                      AND NOT (NEW.approval_required AND NEW.approved_at IS NULL));

  IF TG_OP = 'UPDATE' THEN
    v_old_claimable := (OLD.kind = 'claude_cli_task'
                        AND OLD.status = 'queued'
                        AND NOT (OLD.approval_required AND OLD.approved_at IS NULL));
  ELSE
    v_old_claimable := false;  -- INSERT: nothing before
  END IF;

  -- Only wake on the transition INTO claimable (avoids spurious notifies on unrelated updates).
  IF v_new_claimable AND NOT v_old_claimable THEN
    PERFORM pg_notify('agent_run_queued', jsonb_build_object(
      'schema',     'public',
      'table',      'agent_runs',
      'event',      'agent_run_queued',
      'run_id',     NEW.id,
      'kind',       NEW.kind,
      'profile',    NEW.profile,
      'source',     NEW.source,
      'created_at', NEW.created_at
    )::text);
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger function: fires via trg_agent_runs_notify_queued as the definer; never
-- called directly, so service_role only (no client grant).
REVOKE ALL ON FUNCTION fn_notify_queued_agent_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_notify_queued_agent_run() TO service_role;
