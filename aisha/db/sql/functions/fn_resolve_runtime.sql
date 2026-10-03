-- Function: fn_resolve_runtime
-- Derives the EXECUTOR runtime (direct_llm / openclaw / hermes / cli / workflow)
-- for a clow from ai_runtime_registry — capability-availability, NOT a hardcoded
-- 'direct_llm' default (fn_admit_clow:48 used COALESCE(clow->>'runtime','direct_llm'),
-- which both blind-defaulted AND skipped any availability check).
--
-- Symmetric to aisha_resolve_clow_backend (the MODEL axis): the clow's needs
-- (needs_write / needs_internet / needs_tools) are matched against each runtime's
-- OWN declared capabilities (can_write / needs_network / supports_tools); only
-- enabled + healthy runtimes are candidates. An explicitly-stated clow.runtime is
-- honored ONLY if it is itself available+capable. If NO capable+available runtime
-- exists, returns {resolved:false} so the caller FAILS LOUD — never a blind default
-- (a runtime hardcoded/defaulted while its adapter is down masks non-functionality).
--
-- Ranking is derived, not a roster: prefer direct_llm (the universal LLM executor)
-- when it satisfies, then the least side-effecting + healthiest. Adding a runtime
-- (hermes, a cli) makes it derivable purely by its own registry row.

CREATE OR REPLACE FUNCTION public.fn_resolve_runtime(p_clow jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_needs_net   boolean := COALESCE((p_clow->>'needs_internet')::boolean, false);
  v_needs_write boolean := COALESCE((p_clow->>'needs_write')::boolean, false);
  v_needs_tools boolean := COALESCE((p_clow->>'needs_tools')::boolean, false);
  v_stated      text    := NULLIF(p_clow->>'runtime', '');
  v_cli_slug    text    := NULLIF(p_clow->>'cli_slug', '');
  v_kind        text;
  v_slug        text;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.runtime_kind, r.slug
  INTO v_kind, v_slug
  FROM public.ai_runtime_registry r
  WHERE r.is_enabled
    -- Exclude only a runtime the health probe (WF_RUNTIME_HEALTH_PROBE →
    -- record_runtime_health_result) has CONFIRMED 'down'. 'unknown' (never probed)
    -- and 'degraded' (reachable but slow/erroring) stay usable — degraded is
    -- deprioritized below healthy by the ORDER BY, not excluded.
    AND r.adapter_health <> 'down'
    AND (NOT v_needs_write OR r.can_write)
    AND (NOT v_needs_net   OR r.needs_network)
    AND (NOT v_needs_tools OR r.supports_tools)
    -- Only IN-PROCESS executors are auto-derivable: filter on the runtime's OWN
    -- self-declared is_in_process_executor flag — NOT a hardcoded NOT IN list of kinds.
    -- direct_llm/openclaw/hermes/workbench/cli declare true; out-of-band surfaces
    -- (human = manual inbox, workflow = n8n hand-off) declare false → never derived as an
    -- executeViaRuntime target (which would THROW "No RuntimeAdapter"). Adding/retiring a
    -- derivable runtime is now a per-row data change, not an edit here — the same
    -- capability-availability derivation as is_enabled/can_write/etc.
    -- cli is additionally derivable only with an explicit slug.
    AND r.is_in_process_executor
    AND (r.runtime_kind <> 'cli' OR (v_cli_slug IS NOT NULL AND r.slug = 'cli:' || v_cli_slug))
    -- An explicitly-stated runtime narrows the candidate set (honored iff capable+available).
    AND (v_stated IS NULL OR r.runtime_kind = v_stated)
  ORDER BY
    (r.adapter_health = 'healthy') DESC,         -- prefer a probe-confirmed-healthy runtime
    (r.runtime_kind = 'direct_llm') DESC,        -- then the universal LLM executor
    (r.side_effect_class = 'read_only') DESC,    -- then the least side-effecting
    r.consecutive_failure_count ASC,             -- then the healthiest
    r.runtime_kind ASC
  LIMIT 1;

  IF v_kind IS NULL THEN
    RETURN jsonb_build_object(
      'resolved', false,
      'reason', format(
        'no enabled+healthy runtime satisfies the clow (needs_write=%s, needs_internet=%s, needs_tools=%s, stated=%s)',
        v_needs_write, v_needs_net, v_needs_tools, COALESCE(v_stated, '(derive)')
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'resolved', true,
    'runtime',  v_kind,
    'slug',     v_slug,
    'reason',   format('runtime=%s derived (capability+availability match)', v_kind)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_runtime(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resolve_runtime(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_runtime(jsonb) TO service_role;
