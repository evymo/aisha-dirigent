CREATE OR REPLACE FUNCTION public.fn_maybe_evolve_personality(
  p_user_id uuid,
  p_signal_type text,
  -- Tunable thresholds (sensible defaults)
  p_min_signals integer DEFAULT 8,
  p_min_span_days integer DEFAULT 3,
  p_max_traits_per_user integer DEFAULT 20,
  p_cooldown_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_signal_count integer;
  v_avg_weight numeric;
  v_max_weight numeric;
  v_first_seen timestamptz;
  v_last_seen timestamptz;
  v_span_days numeric;
  v_trend text;
  v_existing_trait_count integer;
  v_existing_trait_for_type uuid;
  v_last_evolution timestamptz;
  v_trait_content text;
  v_trait_importance integer;
  v_new_trait_id uuid;
BEGIN
  -- Auth: ensure caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Default to the calling user when target is unspecified
  IF p_user_id IS NULL THEN
    p_user_id := auth.uid();
  END IF;

  -- Self/authority gate: only act on your own data unless service or admin/staff
  IF p_user_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_service_role()
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- -----------------------------------------------------------------------
  -- 1. Aggregate signals for this user + type (last 60 days)
  -- -----------------------------------------------------------------------
  SELECT
    count(*),
    round(avg(ps.weight)::numeric, 3),
    round(max(ps.weight)::numeric, 3),
    min(ps.created_at),
    max(ps.created_at)
  INTO v_signal_count, v_avg_weight, v_max_weight, v_first_seen, v_last_seen
  FROM personality_signals ps
  WHERE ps.user_id = p_user_id
    AND ps.signal_type = p_signal_type
    AND ps.created_at > now() - interval '60 days';

  -- Not enough signals → skip
  IF v_signal_count < p_min_signals THEN
    RETURN jsonb_build_object(
      'evolved', false,
      'reason', 'insufficient_signals',
      'signal_count', v_signal_count,
      'threshold', p_min_signals
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- 2. Check time span — signals must not be a single-session burst
  -- -----------------------------------------------------------------------
  v_span_days := EXTRACT(EPOCH FROM (v_last_seen - v_first_seen)) / 86400.0;

  IF v_span_days < p_min_span_days THEN
    RETURN jsonb_build_object(
      'evolved', false,
      'reason', 'insufficient_span',
      'span_days', round(v_span_days::numeric, 1),
      'min_span', p_min_span_days
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- 3. Check evolution cooldown — don't re-evolve same type too soon
  -- -----------------------------------------------------------------------
  SELECT max(am.updated_at)
  INTO v_last_evolution
  FROM agent_memories am
  WHERE am.user_id = p_user_id
    AND am.memory_type = 'personality'
    AND am.agent_slug = 'hippocampus:' || p_signal_type;

  IF v_last_evolution IS NOT NULL
     AND v_last_evolution > now() - (p_cooldown_days || ' days')::interval THEN
    RETURN jsonb_build_object(
      'evolved', false,
      'reason', 'cooldown',
      'last_evolution', v_last_evolution,
      'cooldown_days', p_cooldown_days
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- 4. Check max traits per user — prevent trait explosion
  -- -----------------------------------------------------------------------
  SELECT count(*)
  INTO v_existing_trait_count
  FROM agent_memories am
  WHERE am.user_id = p_user_id
    AND am.memory_type = 'personality';

  -- Check if trait for this signal_type already exists (update vs insert)
  SELECT am.id
  INTO v_existing_trait_for_type
  FROM agent_memories am
  WHERE am.user_id = p_user_id
    AND am.memory_type = 'personality'
    AND am.agent_slug = 'hippocampus:' || p_signal_type
  LIMIT 1;

  IF v_existing_trait_for_type IS NULL AND v_existing_trait_count >= p_max_traits_per_user THEN
    RETURN jsonb_build_object(
      'evolved', false,
      'reason', 'max_traits_reached',
      'current_count', v_existing_trait_count,
      'max', p_max_traits_per_user
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- 5. Calculate trend (same logic as fn_aggregate)
  -- -----------------------------------------------------------------------
  SELECT CASE
    WHEN avg(CASE WHEN ps.created_at > now() - interval '30 days' THEN ps.weight END)
       > avg(CASE WHEN ps.created_at <= now() - interval '30 days' THEN ps.weight END)
    THEN 'increasing'
    WHEN avg(CASE WHEN ps.created_at > now() - interval '30 days' THEN ps.weight END)
       < avg(CASE WHEN ps.created_at <= now() - interval '30 days' THEN ps.weight END)
    THEN 'decreasing'
    ELSE 'stable'
  END
  INTO v_trend
  FROM personality_signals ps
  WHERE ps.user_id = p_user_id
    AND ps.signal_type = p_signal_type
    AND ps.created_at > now() - interval '60 days';

  -- -----------------------------------------------------------------------
  -- 6. Compose trait content — the crystallized experience
  --    This is a structured description the evolution LLM can understand.
  --    The actual human-readable trait will be enriched by Hippocampus
  --    on retrieval (buildPersonalityPrompt formats it).
  -- -----------------------------------------------------------------------
  v_trait_content := format(
    'User behavioral pattern: %s (observed %s times over %s days, '
    'avg intensity %s, trend: %s). Adapt AISHA''s expression accordingly — '
    'this reflects who this person is in interaction.',
    p_signal_type,
    v_signal_count,
    round(v_span_days::numeric, 0),
    v_avg_weight,
    v_trend
  );

  -- Importance: scale from signal density + weight (min 4, max 8)
  -- Base traits (DNA) always dominate via retrieval bonus
  v_trait_importance := LEAST(8, GREATEST(4,
    round((v_avg_weight * 5 + LEAST(v_signal_count, 30)::numeric / 30 * 3)::numeric)::integer
  ));

  -- -----------------------------------------------------------------------
  -- 7. Upsert: create new or update existing experiential trait
  -- -----------------------------------------------------------------------
  IF v_existing_trait_for_type IS NOT NULL THEN
    -- UPDATE existing trait — refine based on new signal data
    UPDATE agent_memories
    SET content = v_trait_content,
        importance = v_trait_importance,
        updated_at = now(),
        -- Clear embedding so it gets re-embedded with new content
        embedding = NULL
    WHERE id = v_existing_trait_for_type;

    v_new_trait_id := v_existing_trait_for_type;
  ELSE
    -- INSERT new experiential trait
    INSERT INTO agent_memories (
      agent_slug, user_id, memory_type, content, importance, source_run_id
    ) VALUES (
      'hippocampus:' || p_signal_type,
      p_user_id,
      'personality',
      v_trait_content,
      v_trait_importance,
      NULL
    )
    RETURNING id INTO v_new_trait_id;
  END IF;

  -- -----------------------------------------------------------------------
  -- 8. Prune old signals — keep last 30, discard older ones
  --    The experience has been consolidated; raw signals can decay.
  -- -----------------------------------------------------------------------
  DELETE FROM personality_signals
  WHERE user_id = p_user_id
    AND signal_type = p_signal_type
    AND id NOT IN (
      SELECT id FROM personality_signals
      WHERE user_id = p_user_id
        AND signal_type = p_signal_type
      ORDER BY created_at DESC
      LIMIT 30
    );

  RETURN jsonb_build_object(
    'evolved', true,
    'reason', CASE WHEN v_existing_trait_for_type IS NOT NULL
      THEN 'updated' ELSE 'created' END,
    'trait_id', v_new_trait_id,
    'signal_count', v_signal_count,
    'span_days', round(v_span_days::numeric, 1),
    'importance', v_trait_importance,
    'trend', v_trend
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_maybe_evolve_personality(uuid, text, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_maybe_evolve_personality(uuid, text, integer, integer, integer, integer) TO authenticated;
