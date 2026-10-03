-- Function: recommend_slot_for_task
-- Soulforge: classify a task into a slot (spark/ember/verify/...) on the DB side.
-- Mirrors the TypeScript heuristic in services/svc-ai-chat/src/reflection/soulforge.ts.
-- Used by reflection nodes when local classifier confidence < 0.6 (e.g. ambiguous
-- task descriptions) and by n8n workflows that need a slot decision without
-- loading the TS lib.

CREATE OR REPLACE FUNCTION public.recommend_slot_for_task(
  p_message text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_slot       text;
  v_confidence numeric;
  v_reason     text;
  v_len        int := length(COALESCE(p_message, ''));
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_message IS NULL OR p_message = '' THEN
    RETURN jsonb_build_object('slot', 'default', 'confidence', 0.0, 'reason', 'empty_input');
  END IF;

  -- Pattern matching mirrors the TS classifier order (specificity descending).
  -- Highest-confidence patterns win.
  -- Stems (summariz, analyz, evaluat, diagnos, condens, compar) deliberately
  -- lack trailing \y because the next char is usually a word char (e/i/ing).
  -- Whole verbs keep \y on both ends.
  IF p_message ~* '\y(summariz|condens|shorten|tldr)' THEN
    v_slot := 'compact';  v_confidence := 0.80; v_reason := 'pattern_compact';
  ELSIF p_message ~* '\y(read|explore|fetch|open|show|browse|load)\y' AND v_len < 400 THEN
    v_slot := 'spark';    v_confidence := 0.75; v_reason := 'pattern_spark_short';
  ELSIF p_message ~* '\y(write|edit|create|implement|fix|refactor|build|add)\y' THEN
    v_slot := 'ember';    v_confidence := 0.75; v_reason := 'pattern_ember';
  ELSIF p_message ~* '\y(review|test|check|verify|audit|validate)\y' THEN
    v_slot := 'verify';   v_confidence := 0.75; v_reason := 'pattern_verify';
  ELSIF p_message ~* '\y(clean|format|lint|tidy)\y' THEN
    v_slot := 'desloppify'; v_confidence := 0.70; v_reason := 'pattern_desloppify';
  ELSIF p_message ~* '\y(analyz|explain|compar|evaluat|diagnos)' THEN
    v_slot := 'semantic'; v_confidence := 0.65; v_reason := 'pattern_semantic';
  ELSIF p_message ~* '\y(search|google|lookup|web|find)\y' THEN
    v_slot := 'webSearch'; v_confidence := 0.60; v_reason := 'pattern_webSearch';
  ELSE
    v_slot := 'default';  v_confidence := 0.40; v_reason := 'no_pattern_matched';
  END IF;

  RETURN jsonb_build_object(
    'slot', v_slot,
    'confidence', v_confidence,
    'reason', v_reason,
    'message_length', v_len,
    'context_keys', (SELECT COALESCE(array_agg(k), '{}'::text[])
                     FROM jsonb_object_keys(p_context) AS k)
  );
END;
$$;

COMMENT ON FUNCTION public.recommend_slot_for_task(text, jsonb) IS
  'Soulforge: DB-side slot classifier (spark/ember/webSearch/desloppify/verify/'
  'compact/semantic/default). STABLE, regex-based, ~ms. TS classifier in '
  'svc-ai-chat/src/reflection/soulforge.ts is authoritative; this RPC is used '
  'when the TS lib is not in scope (n8n, edge fns, direct DB callers).';

REVOKE ALL ON FUNCTION public.recommend_slot_for_task(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recommend_slot_for_task(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recommend_slot_for_task(text, jsonb) TO service_role;
