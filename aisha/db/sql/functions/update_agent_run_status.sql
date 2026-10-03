-- Function: public.update_agent_run_status
-- Description: Update status + metadata for an existing agent run.
--   Called exclusively by svc-agent-runner (service_role JWT) to report progress.
--   Sets started_at / finished_at automatically based on status transition.
-- Security: SECURITY DEFINER, grants to service_role only

-- p_outputs (jsonb) was appended after the original 7-arg form shipped, changing
-- the signature — DROP the old one first (CREATE OR REPLACE only replaces an
-- identical arg list; without this the 7-arg overload lingers and a 7-arg call
-- becomes ambiguous against the new default-8th form). Appended LAST so existing
-- positional 7-arg callers stay valid (the 8th defaults).
DROP FUNCTION IF EXISTS public.update_agent_run_status(uuid, text, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_agent_run_status(
  p_run_id              uuid,
  p_status              text,
  p_exit_code           integer DEFAULT NULL,
  p_error_summary       text    DEFAULT NULL,
  p_outputs_s3_uri      text    DEFAULT NULL,
  p_host                text    DEFAULT NULL,
  p_langfuse_trace_id   text    DEFAULT NULL,
  p_outputs             jsonb   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.agent_runs SET
    status              = p_status,
    exit_code           = COALESCE(p_exit_code, exit_code),
    error_summary       = COALESCE(p_error_summary, error_summary),
    outputs_s3_uri      = COALESCE(p_outputs_s3_uri, outputs_s3_uri),
    outputs             = COALESCE(p_outputs, outputs),
    host                = COALESCE(p_host, host),
    langfuse_trace_id   = COALESCE(p_langfuse_trace_id, langfuse_trace_id),
    started_at          = CASE WHEN p_status = 'running'  THEN now() ELSE started_at  END,
    finished_at         = CASE WHEN p_status IN ('succeeded', 'failed', 'timeout', 'cancelled')
                               THEN now() ELSE finished_at END
  WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_agent_run_status(uuid, text, integer, text, text, text, text, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_agent_run_status(uuid, text, integer, text, text, text, text, jsonb)
  TO service_role;
