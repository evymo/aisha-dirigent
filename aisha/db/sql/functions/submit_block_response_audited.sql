-- Function: public.submit_block_response_audited
-- Arguments: p_context_type text, p_block_code text, p_question_type text, p_response jsonb, p_context_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:06+01:00

CREATE OR REPLACE FUNCTION public.submit_block_response_audited(p_context_type text, p_block_code text, p_question_type text, p_response jsonb, p_context_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_block_record record;
  v_response_id uuid;
  v_result jsonb;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Validate block exists and get its config
  SELECT id, question_type, config, is_required
  INTO v_block_record
  FROM question_blocks
  WHERE block_code = p_block_code
    AND is_active = true;

  IF v_block_record IS NULL THEN
    RAISE EXCEPTION 'Question block not found or inactive: %', p_block_code;
  END IF;

  -- Validate question type matches
  IF v_block_record.question_type != p_question_type THEN
    RAISE EXCEPTION 'Question type mismatch: expected %, got %', v_block_record.question_type, p_question_type;
  END IF;

  -- For tags type, validate selected values against allowed options
  IF p_question_type = 'tags' THEN
    DECLARE
      v_allowed_values text[];
      v_selected_values text[];
      v_invalid_values text[];
    BEGIN
      SELECT array_agg(opt->>'value')
      INTO v_allowed_values
      FROM jsonb_array_elements(v_block_record.config->'options') AS opt;

      IF p_response ? 'values' THEN
        SELECT array_agg(val::text)
        INTO v_selected_values
        FROM jsonb_array_elements_text(p_response->'values') AS val;
      ELSIF p_response ? 'value' THEN
        v_selected_values := ARRAY[p_response->>'value'];
      END IF;

      SELECT array_agg(sv)
      INTO v_invalid_values
      FROM unnest(v_selected_values) AS sv
      WHERE sv != ALL(v_allowed_values);

      IF v_invalid_values IS NOT NULL AND array_length(v_invalid_values, 1) > 0 THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid tag values: %s', array_to_string(v_invalid_values, ', ')), ERRCODE = '22023';
      END IF;
    END;
  END IF;

  -- For feeling_preset type, validate preset_id against allowed presets
  IF p_question_type = 'feeling_preset' THEN
    DECLARE
      v_allowed_presets text[];
      v_selected_preset text;
    BEGIN
      SELECT array_agg(preset->>'id')
      INTO v_allowed_presets
      FROM jsonb_array_elements(v_block_record.config->'presets') AS preset;

      v_selected_preset := p_response->>'preset_id';

      IF v_selected_preset != ALL(v_allowed_presets) THEN
        RAISE EXCEPTION USING MESSAGE = format('Invalid feeling preset: %s', v_selected_preset), ERRCODE = '22023';
      END IF;
    END;
  END IF;

  v_response_id := gen_random_uuid();

  v_result := jsonb_build_object(
    'response_id', v_response_id,
    'block_code', p_block_code,
    'question_type', p_question_type,
    'context_type', p_context_type,
    'context_id', p_context_id,
    'response', p_response,
    'validated', true
  );

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'health'::journal_area,
      p_details := 'Block response submitted: ' || p_block_code,
      p_entity_id := NULL,
      p_entity_type := 'block_response',
      p_old_values := 'info'::journal_severity,
      p_severity := v_result,
      p_summary := v_response_id::text,
    p_user_id := v_user_id
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_block_response_audited(p_context_type text, p_block_code text, p_question_type text, p_response jsonb, p_context_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_block_response_audited(p_context_type text, p_block_code text, p_question_type text, p_response jsonb, p_context_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_block_response_audited(p_context_type text, p_block_code text, p_question_type text, p_response jsonb, p_context_id uuid) TO authenticated;
