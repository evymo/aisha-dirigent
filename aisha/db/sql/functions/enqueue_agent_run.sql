-- Function: public.enqueue_agent_run
-- Description: Create a new agent execution record and return its ID.
--   Called by svc-agent-runner / plugin-host / n8n to queue isolated workloads.
--   Writes an audit entry for every enqueue operation.
-- Security: SECURITY DEFINER, JEN service_role (volající jsou služby výš).
--
-- ⛔ NAMĚŘENO 2026-09-27 (fork <fork>): funkce byla udělená `authenticated`, ne
-- `service_role` — naopak, než jak se volá:
--   · svc-agent-runner ji volá SLUŽEBNÍM tokenem (rpcService) → PostgREST 403
--     „permission denied for function enqueue_agent_run" → každý běh pluginu
--     (plugin-exec) končil „Agent runner error 500";
--   · přihlášený uživatel ji mohl volat přímo a sám si zvolit `p_image` i druh.
--     Zařazený `claude_cli_task` bez politik útraty projde (výchozí pásmo katalogu
--     → allow, approval_required=false) a poller runneru spouští OBRAZ Z ŘÁDKU
--     (`run.image || config.agentClaudeImage`) — tedy obraz zvolený uživatelem.
--     Web ani appky ji nevolají; běhy uživatelů jdou přes POST /runs runneru.

CREATE OR REPLACE FUNCTION public.enqueue_agent_run(
  p_kind        text,
  p_profile     text,
  p_image       text,
  p_source      text,
  p_source_ref  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
  v_authz  jsonb;
BEGIN
  -- Spend admission (pre-flight): execution-plane workloads have no story
  -- scope, so global policies + catalog bands decide. ask/deny refuse loudly.
  v_authz := public.fn_authorize_task_spend(p_kind, NULL);
  IF v_authz->>'decision' IN ('ask', 'deny') THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'spend_%s: kind %s estimate $%s (%s) — adjust ai_spend_policies',
        v_authz->>'decision', p_kind,
        COALESCE(v_authz->>'estimate_used', '?'),
        v_authz->>'reason'),
      ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.agent_runs (kind, profile, image, requested_by, source, source_ref)
  VALUES (p_kind, p_profile, p_image, auth.uid(), p_source, p_source_ref)
  RETURNING id INTO v_run_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'agent_run.enqueued',
          jsonb_build_object('run_id', v_run_id, 'kind', p_kind, 'source', p_source));

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_run(text, text, text, text, text) FROM PUBLIC;
-- Výslovně: CREATE OR REPLACE dřívější grant NEODEBERE, existující DB by ho držely dál.
REVOKE ALL ON FUNCTION public.enqueue_agent_run(text, text, text, text, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_run(text, text, text, text, text) TO service_role;
