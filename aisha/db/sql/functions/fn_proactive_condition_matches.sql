-- Function: fn_proactive_condition_matches
-- Pure evaluator for an ai_proactive_trigger_definitions.condition against a row.
--
-- The condition JSONB is a small, injection-free DSL (no dynamic SQL):
--   {}                              → always matches
--   {"status": "queued"}            → NEW row's fields contain these (jsonb @>)
--   {"kind": "agent", "tier": 2}    → all key/values must match (containment)
--   {"__changed": ["status"]}       → on UPDATE, listed fields must DIFFER (OLD≠NEW);
--                                      vacuously true on INSERT
-- Equality + __changed can be combined. This covers the common reactive cases
-- (field-equals, field-changed) safely; richer operators can be layered later
-- without touching the dispatcher.

CREATE OR REPLACE FUNCTION public.fn_proactive_condition_matches(
  p_condition jsonb,
  p_new jsonb,
  p_old jsonb,
  p_event text
) RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'public'
AS $function$
DECLARE
  v_changed jsonb;
  v_field text;
  v_equality jsonb;
BEGIN
  IF p_condition IS NULL OR p_condition = '{}'::jsonb THEN
    RETURN true;
  END IF;

  -- __changed: fields that must differ between OLD and NEW (UPDATE only).
  v_changed := p_condition -> '__changed';
  IF v_changed IS NOT NULL AND jsonb_typeof(v_changed) = 'array' THEN
    IF p_event = 'UPDATE' AND p_old IS NOT NULL THEN
      FOR v_field IN SELECT jsonb_array_elements_text(v_changed) LOOP
        IF (p_old -> v_field) IS NOT DISTINCT FROM (p_new -> v_field) THEN
          RETURN false;  -- a required-changed field did not change
        END IF;
      END LOOP;
    END IF;
    -- INSERT: __changed is vacuously satisfied (the row is new).
  END IF;

  -- Remaining keys: exact key/value match against NEW via jsonb containment.
  v_equality := p_condition - '__changed';
  IF v_equality <> '{}'::jsonb THEN
    IF p_new IS NULL OR NOT (p_new @> v_equality) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION fn_proactive_condition_matches(jsonb, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_proactive_condition_matches(jsonb, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_proactive_condition_matches(jsonb, jsonb, jsonb, text) TO authenticated;
