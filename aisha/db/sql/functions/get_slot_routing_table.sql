-- Function: get_slot_routing_table
-- Soulforge: read-only view of the active slot×model routing matrix.
-- Joins ai_model_registry.slot_affinity jsonb with model availability flags.
-- Used by admin dashboards + reflection nodes that need to debug slot choices.

CREATE OR REPLACE FUNCTION public.get_slot_routing_table()
RETURNS TABLE (
  slot           text,
  tier           text,
  model_id       text,
  provider       text,
  affinity_score numeric,
  is_available   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  -- The jsonb shape is { "slot:tier": "model_id" } per ai_model_registry row.
  -- Example: { "spark:moderate": "gemini-2.5-flash", "ember:complex": "claude-sonnet-4-20250514" }
  SELECT
    split_part(kv.key, ':', 1) AS slot,
    split_part(kv.key, ':', 2) AS tier,
    kv.value::text             AS model_id,
    r.provider                 AS provider,
    1.0::numeric               AS affinity_score,
    r.is_available             AS is_available
  FROM public.ai_model_registry r,
       jsonb_each_text(COALESCE(r.slot_affinity, '{}'::jsonb)) AS kv(key, value)
  WHERE r.is_available
    AND NOT r.is_deprecated
    AND r.is_chat_capable
  ORDER BY slot, tier;
END;
$$;

COMMENT ON FUNCTION public.get_slot_routing_table() IS
  'Soulforge: returns the live slot×tier→model routing matrix '
  'sourced from ai_model_registry.slot_affinity. Used by admin UI + reflection.';

REVOKE ALL ON FUNCTION public.get_slot_routing_table() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_slot_routing_table() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_slot_routing_table() TO service_role;
