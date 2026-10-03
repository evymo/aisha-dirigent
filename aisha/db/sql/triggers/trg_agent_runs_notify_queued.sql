-- Trigger: trg_agent_runs_notify_queued
-- Wakes svc-agent-runner the moment a claude_cli_task run becomes claimable
-- (NOTIFY 'agent_run_queued'), replacing its 500ms poll with an event.

CREATE TRIGGER trg_agent_runs_notify_queued
  AFTER INSERT OR UPDATE ON public.agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_queued_agent_run();
