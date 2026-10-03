-- set_active_ai_model_admin — Admin/staff override pro aktivní AI model.
--
-- Permission gated (is_admin_or_staff), audit-traced (audit_journal entry s
-- metadata = ID + state, žádná PII). Při aktivaci jiných modelů pro stejný
-- provider deaktivuje předchozí override.
--
-- Tier-based auto selection (get_adaptive_model_tiers) zůstává primární mechanismus
-- pro automatický runtime výběr — admin override je výjimka, ne pravidlo.
--
-- EVAL-BEFORE-MIGRATION GATE (G4, odysseus impl/14 + impl/13 §5.2):
-- aktivace modelu = změna operativního defaultu pro daný provider. Bez zeleného
-- evalu se default NEMĚNÍ: model musí mít eval_status IN ('tested','approved')
-- (self-test/benchmark lifecycle) A aktuální benchmark v ai_model_benchmarks
-- s overall_score >= system_config['ai_runtime'].eval_min_overall_score
-- (fallback 0.6). CHYBĚJÍCÍ eval výsledek = gate FAIL (fail-closed, žádné
-- tiché povolení). Deaktivace gate nepodléhá. Harness: benchmarkRunner
-- .benchmarkModels → record_model_benchmark (REPLACE semantics per task_type).
--
-- Migration: 20260428112918_insight_maestro_provider.sql
-- Hooks/MCP: src/hooks/useAiModels.ts (useSetActiveAiModel)
-- VS Code extension: extensions/aisha-dirigent/src/admin-model-switch.ts

CREATE OR REPLACE FUNCTION public.set_active_ai_model_admin(
  p_provider text,
  p_model_id text,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_model_record_id uuid;
  v_previous_state boolean;
  v_eval_status text;
  v_best_score numeric;
  v_min_score numeric;
BEGIN
  -- Permission check: admin or staff only
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied: admin or staff role required to override AI model selection'
      USING ERRCODE = '42501';
  END IF;

  v_user_id := auth.uid();

  -- Validate model exists in registry
  SELECT id, is_admin_active, eval_status
    INTO v_model_record_id, v_previous_state, v_eval_status
    FROM public.ai_model_registry
    WHERE provider = p_provider AND model_id = p_model_id;

  IF v_model_record_id IS NULL THEN
    RAISE EXCEPTION 'Model not found in registry: provider=%, model_id=%', p_provider, p_model_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Eval-before-migration gate (G4) — BEFORE any mutation ────────────────
  -- Fail-closed: no benchmark result → FAIL (never a silent pass).
  IF p_is_active THEN
    v_min_score := COALESCE(
      (SELECT (value->>'eval_min_overall_score')::numeric
         FROM public.system_config WHERE key = 'ai_runtime'),
      0.6);

    SELECT max(overall_score)
      INTO v_best_score
      FROM public.ai_model_benchmarks
      WHERE model_registry_id = v_model_record_id
        AND overall_score IS NOT NULL;

    IF v_eval_status NOT IN ('tested', 'approved')
       OR v_best_score IS NULL
       OR v_best_score < v_min_score THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Eval-before-migration gate: cannot activate %s/%s — eval_status=%s, best overall_score=%s, required >= %s. '
          'Run the benchmark harness first (benchmarkModels → record_model_benchmark), then approve.',
          p_provider, p_model_id, COALESCE(v_eval_status, 'NULL'),
          COALESCE(v_best_score::text, 'NONE'), v_min_score::text);
    END IF;
  END IF;

  -- When activating: deactivate other admin overrides for the SAME provider
  -- (prevents conflicting overrides; auto tier selection still uses non-admin defaults).
  IF p_is_active THEN
    UPDATE public.ai_model_registry
      SET is_admin_active = false,
          updated_at = now()
      WHERE provider = p_provider
        AND id <> v_model_record_id
        AND is_admin_active = true;
  END IF;

  -- Apply the override
  UPDATE public.ai_model_registry
    SET is_admin_active = p_is_active,
        updated_at = now()
    WHERE id = v_model_record_id;

  -- Audit (no PII — only IDs and metadata)
  INSERT INTO public.audit_journal (
    user_id,
    action,
    metadata
  )
  VALUES (
    v_user_id,
    'ai_model_admin_override',
    jsonb_build_object(
      'model_record_id', v_model_record_id,
      'provider', p_provider,
      'model_id', p_model_id,
      'previous_state', v_previous_state,
      'new_state', p_is_active,
      'eval_status', v_eval_status,
      'eval_best_overall_score', v_best_score,
      'eval_min_required', v_min_score
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'provider', p_provider,
    'model_id', p_model_id,
    'is_admin_active', p_is_active,
    'previous_state', v_previous_state
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_active_ai_model_admin(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_ai_model_admin(text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_active_ai_model_admin(text, text, boolean) IS
  'Admin/staff override pro aktivní AI model. Permission gated (is_admin_or_staff), audit-traced. '
  'Při aktivaci jiných modelů pro stejný provider deaktivuje předchozí override. '
  'Tier-based auto selection (get_adaptive_model_tiers) zůstává primární mechanismus '
  'pro automatický runtime výběr — admin override je výjimka, ne pravidlo. '
  'EVAL-BEFORE-MIGRATION GATE (G4): aktivace vyžaduje eval_status tested/approved '
  'a benchmark overall_score >= ai_runtime.eval_min_overall_score (fail-closed, bez evalu nelze aktivovat).';
