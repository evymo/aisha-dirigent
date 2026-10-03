-- ============================================================================
-- Source of Truth: fn_admit_clow  (E0 Admission Layer composer)
-- Purpose: THE pre-resolver admission gate. Runs BEFORE aisha_resolve_clow_backend
--          and composes ONE verdict over FOUR DERIVED axes — capability-availability,
--          NOT membership allow-lists (owner Q4: "AISHA = systémová/infrastrukturní
--          vrstva, která podle dostupných možností ví, zda a jak umí naložit s úkolem").
--
--            spend       — fn_authorize_task_spend (REUSE; policy thresholds, not a list)
--            runtime     — fn_runtime_available (REUSE; availability DERIVED from the
--                          ai_runtime_registry row: registered + enabled + live adapter)
--            capability  — the chosen runtime's OWN declared capabilities are matched
--                          against the clow's needs (needs_write→can_write,
--                          needs_internet→needs_network, needs_tools→supports_tools,
--                          + provider supports_tool_use for tools under direct_llm).
--                          DERIVED from each entity's self-declared flags, not a list.
--            risk        — fn_compute_clow_risk(clow, runtime_row) COMPUTED severity vs
--                          a resolved ai_risk_policies threshold row (policy, not a list).
--
--          Combine: deny dominates, then ask, else allow.
--            deny → caller blocks the run (status='blocked', awaiting='admission_denied');
--            ask  → caller blocks with awaiting=<axis>_approval (Mission Control).
--          `awaiting` is taken from the FIRST axis that asks (spend → runtime n/a →
--          capability → risk), preserving a stable, explainable reason.
--
-- DESIGN — NO MAINTAINED ALLOW-LISTS. There is no governance_flags lookup, no
-- @> array-membership test, and no _admit_capability_axis flag helper. Adding a
-- new runtime (hermes, a CLI) or provider makes it admissible purely by its own
-- registry row (is_enabled + adapter/health) and its own capability columns — the
-- entity governs itself; nothing here is edited when capabilities are added. This
-- mirrors the provider resolver, which filters by is_enabled AND healthy.
--
-- Security: SECURITY DEFINER, read-only (STABLE). authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_admit_clow(
  p_clow    jsonb,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- ── clow / context inputs ──────────────────────────────────────────────────
  v_story_id     uuid    := NULLIF(p_context->>'story_id', '')::uuid;
  v_runtime      text    := COALESCE(p_clow->>'runtime', 'direct_llm');
  v_cli_slug     text    := NULLIF(p_clow->>'cli_slug', '');
  v_task_kind    text    := COALESCE(p_clow->>'task_kind', 'chat');
  v_estimate     numeric := NULLIF(p_context->>'estimate', '')::numeric;
  v_needs_net    boolean := COALESCE((p_clow->>'needs_internet')::boolean, false);
  v_needs_write  boolean := COALESCE((p_clow->>'needs_write')::boolean, false);
  v_needs_tools  boolean := COALESCE((p_clow->>'needs_tools')::boolean, false);

  -- ── verdict accumulation ───────────────────────────────────────────────────
  v_axis         jsonb   := '{}'::jsonb;
  v_decisions    text[]  := ARRAY[]::text[];
  v_final        text;
  v_awaiting     text    := NULL;

  -- ── spend axis ─────────────────────────────────────────────────────────────
  v_spend        jsonb;
  v_spend_dec    text;

  -- ── runtime-availability axis ──────────────────────────────────────────────
  v_runtime_av   jsonb;
  v_runtime_row  jsonb;
  v_runtime_dec  text;

  -- ── capability-match axis (DERIVED from the chosen runtime/provider) ────────
  v_can_write    boolean;
  v_can_net      boolean;
  v_can_tools    boolean;
  v_provider_tools boolean;
  v_cap_dec      text    := 'allow';
  v_cap          jsonb   := '{}'::jsonb;

  -- ── risk axis (COMPUTED severity vs resolved policy thresholds) ─────────────
  v_risk_level   text;
  v_risk_ord     int;
  v_ask_at       text;
  v_deny_at      text;
  v_ask_ord      int;
  v_deny_ord     int;
  v_risk_src     text;
  v_risk_dec     text;

  -- ── autonomy axis (the runtime's DECLARED autonomy_class) ───────────────────
  v_autonomy     text;
  v_autonomy_dec text;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_clow IS NULL OR (p_clow->>'purpose') IS NULL THEN
    RAISE EXCEPTION 'fn_admit_clow: p_clow.purpose required' USING ERRCODE = '22023';
  END IF;

  -- ══ axis 1: spend (REUSE — policy thresholds, NOT a list) ══════════════════
  v_spend := public.fn_authorize_task_spend(v_task_kind, v_story_id, v_estimate);
  v_spend_dec := v_spend->>'decision';
  v_axis := v_axis || jsonb_build_object('spend',
    jsonb_build_object(
      'decision', v_spend_dec,
      'reason',   v_spend->>'reason',
      'detail',   v_spend
    ));
  v_decisions := array_append(v_decisions, v_spend_dec);
  IF v_spend_dec = 'ask' THEN
    v_awaiting := COALESCE(v_awaiting, 'spend_approval');
  END IF;

  -- ══ axis 2: runtime-availability (REUSE — DERIVED from the registry row) ════
  -- Available IFF the runtime's OWN ai_runtime_registry row is registered +
  -- enabled + has a live adapter. Not available → deny (runtime_unavailable).
  v_runtime_av  := public.fn_runtime_available(v_runtime, v_cli_slug);
  v_runtime_row := v_runtime_av->'row';
  v_runtime_dec := CASE WHEN (v_runtime_av->>'available')::boolean THEN 'allow' ELSE 'deny' END;
  v_axis := v_axis || jsonb_build_object('runtime',
    jsonb_build_object(
      'decision',    v_runtime_dec,
      'reason_code', CASE WHEN v_runtime_dec = 'deny' THEN 'runtime_unavailable' ELSE 'runtime_available' END,
      'requested',   v_runtime,
      'cli_slug',    v_cli_slug,
      'reason',      v_runtime_av->>'reason'
    ));
  v_decisions := array_append(v_decisions, v_runtime_dec);

  -- ══ axis 3: capability-match (DERIVED — runtime/provider self-declared) ════
  -- Each need is matched against the chosen runtime's OWN capability columns
  -- (loaded above). A need the runtime cannot satisfy → ask (a human can grant /
  -- redirect), never a silent allow. No flag-set, no list — the entity declares
  -- what it can do.
  -- Defaults are fail-closed: an absent capability column reads as false, so a
  -- need without an explicit capability asks rather than silently allowing.
  v_can_write := COALESCE((v_runtime_row->>'can_write')::boolean, false);
  v_can_net   := COALESCE((v_runtime_row->>'needs_network')::boolean, false);
  v_can_tools := COALESCE((v_runtime_row->>'supports_tools')::boolean, false);

  -- For direct_llm tool use, the resolved provider must itself support tool use
  -- (supports_tool_use already exists per ai_provider_registry). DERIVED chaining,
  -- mirroring fn_runtime_available's provider check — not a provider allow-list.
  IF v_runtime = 'direct_llm' AND v_needs_tools THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ai_provider_registry p
      WHERE p.is_enabled
        AND p.last_health_status IN ('healthy', 'unknown')
        AND p.supports_tool_use
    ) INTO v_provider_tools;
    v_can_tools := v_can_tools AND COALESCE(v_provider_tools, false);
  END IF;

  -- write
  v_cap := v_cap || jsonb_build_object('write',
    jsonb_build_object(
      'needed',    v_needs_write,
      'satisfied', (NOT v_needs_write) OR v_can_write,
      'decision',  CASE WHEN NOT v_needs_write OR v_can_write THEN 'allow' ELSE 'ask' END));
  IF v_needs_write AND NOT v_can_write THEN
    v_cap_dec  := 'ask';
    v_awaiting := COALESCE(v_awaiting, 'capability_write_requires_approval');
  END IF;

  -- internet
  v_cap := v_cap || jsonb_build_object('internet',
    jsonb_build_object(
      'needed',    v_needs_net,
      'satisfied', (NOT v_needs_net) OR v_can_net,
      'decision',  CASE WHEN NOT v_needs_net OR v_can_net THEN 'allow' ELSE 'ask' END));
  IF v_needs_net AND NOT v_can_net THEN
    v_cap_dec  := 'ask';
    v_awaiting := COALESCE(v_awaiting, 'capability_internet_requires_approval');
  END IF;

  -- tools
  v_cap := v_cap || jsonb_build_object('tools',
    jsonb_build_object(
      'needed',    v_needs_tools,
      'satisfied', (NOT v_needs_tools) OR v_can_tools,
      'decision',  CASE WHEN NOT v_needs_tools OR v_can_tools THEN 'allow' ELSE 'ask' END));
  IF v_needs_tools AND NOT v_can_tools THEN
    v_cap_dec  := 'ask';
    v_awaiting := COALESCE(v_awaiting, 'capability_tools_requires_approval');
  END IF;

  v_axis := v_axis || jsonb_build_object('capability',
    (v_cap || jsonb_build_object('decision', v_cap_dec)));
  v_decisions := array_append(v_decisions, v_cap_dec);

  -- ══ axis 4: risk (COMPUTED severity vs resolved policy thresholds) ═════════
  -- Risk is computed from the clow itself (criticality, side-effect class) against
  -- the chosen runtime; the verdict is a policy comparison, not list membership.
  v_risk_level := (public.fn_compute_clow_risk(p_clow, v_runtime_row))->>'risk_level';
  v_risk_ord   := public.fn_risk_level_ordinal(v_risk_level);

  -- Resolve the governing ai_risk_policies row — most specific active row wins
  -- (story over global), exactly like ai_spend_policies. No row → conservative
  -- built-in band: ask at 'high', deny at 'critical'. A single threshold value
  -- per dimension is a variable, NOT a maintained list of permitted names.
  SELECT rp.ask_above, rp.deny_above,
         rp.scope_type || COALESCE(':' || NULLIF(rp.scope_id::text, ''), ':global')
    INTO v_ask_at, v_deny_at, v_risk_src
  FROM public.ai_risk_policies rp
  WHERE rp.is_active
    AND (
      (rp.scope_type = 'story'  AND rp.scope_id = v_story_id)
      OR rp.scope_type = 'global'
    )
  ORDER BY
    CASE WHEN rp.scope_type = 'story' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_ask_at IS NULL THEN
    v_ask_at   := 'medium';
    v_deny_at  := 'critical';
    v_risk_src := COALESCE(v_risk_src, 'builtin_default');
  END IF;

  v_ask_ord  := public.fn_risk_level_ordinal(v_ask_at);
  v_deny_ord := public.fn_risk_level_ordinal(v_deny_at);

  v_risk_dec := CASE
    WHEN v_deny_ord IS NOT NULL AND v_risk_ord > v_deny_ord THEN 'deny'
    WHEN v_ask_ord  IS NOT NULL AND v_risk_ord > v_ask_ord  THEN 'ask'
    ELSE 'allow'
  END;

  v_axis := v_axis || jsonb_build_object('risk',
    jsonb_build_object(
      'decision',     v_risk_dec,
      'level',        v_risk_level,
      'ask_at',       v_ask_at,
      'deny_at',      v_deny_at,
      'policy_source', v_risk_src
    ));
  v_decisions := array_append(v_decisions, v_risk_dec);
  IF v_risk_dec = 'ask' THEN
    v_awaiting := COALESCE(v_awaiting, 'risk_approval');
  END IF;

  -- ══ axis 5: autonomy (the runtime's DECLARED autonomy_class) ═══════════════
  -- ai_runtime_registry.autonomy_class carries ENFORCEMENT semantics that no
  -- decision function previously read: 'supervised' = "every action gated by human
  -- review". Honour that contract as its own axis — a supervised runtime must never
  -- be admitted straight to 'allow'; it asks (human review) regardless of the
  -- computed risk band. 'semi'/'autonomous' add nothing here (their gating IS the
  -- risk band). deny from another axis still dominates via the combine below.
  -- Fail-closed: a missing autonomy_class (never expected — NOT NULL DEFAULT
  -- 'supervised' in the registry) is treated as the most-gated value.
  v_autonomy     := COALESCE(v_runtime_row->>'autonomy_class', 'supervised');
  v_autonomy_dec := CASE WHEN v_autonomy = 'supervised' THEN 'ask' ELSE 'allow' END;
  v_axis := v_axis || jsonb_build_object('autonomy',
    jsonb_build_object('decision', v_autonomy_dec, 'autonomy_class', v_autonomy));
  v_decisions := array_append(v_decisions, v_autonomy_dec);
  IF v_autonomy_dec = 'ask' THEN
    v_awaiting := COALESCE(v_awaiting, 'supervision_approval');
  END IF;

  -- ══ combine: deny dominates, then ask, else allow ═════════════════════════
  IF 'deny' = ANY(v_decisions) THEN
    v_final    := 'deny';
    v_awaiting := 'admission_denied';
  ELSIF 'ask' = ANY(v_decisions) THEN
    v_final    := 'ask';
  ELSE
    v_final    := 'allow';
  END IF;

  RETURN jsonb_build_object(
    'decision', v_final,
    'axis_results', v_axis,
    'reason_code', CASE
      WHEN v_final = 'deny' THEN 'admission_denied'
      WHEN v_final = 'ask'  THEN COALESCE(v_awaiting, 'approval_required')
      ELSE 'admitted' END,
    'awaiting', v_awaiting
  );
END;
$$;

-- fn_risk_level_ordinal (the low<medium<high<critical → 0..3 rank transform used
-- by the risk axis above) lives in its own SoT file: functions/fn_risk_level_ordinal.sql
-- (one DB object per file). fn_admit_clow calls it as public.fn_risk_level_ordinal(...).

COMMENT ON FUNCTION public.fn_admit_clow(jsonb, jsonb) IS
  'E0 Admission Layer composer (pre-resolver). Composes FOUR DERIVED axes — '
  'spend (fn_authorize_task_spend) + runtime-availability (fn_runtime_available) + '
  'capability-match (runtime/provider self-declared can_write/needs_network/'
  'supports_tools, + provider supports_tool_use for direct_llm tools) + risk '
  '(fn_compute_clow_risk vs resolved ai_risk_policies threshold) — into one verdict '
  '{decision: allow|ask|deny, axis_results, reason_code, awaiting}. Capability-'
  'availability, NOT allow-lists: every entity governs itself via its own registry '
  'row + capability columns. deny>ask>allow; awaiting from first asking axis; '
  'deny→admission_denied. STABLE; SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.fn_admit_clow(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admit_clow(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admit_clow(jsonb, jsonb) TO service_role;
