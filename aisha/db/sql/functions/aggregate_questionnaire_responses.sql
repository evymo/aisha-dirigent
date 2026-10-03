-- Function: public.aggregate_questionnaire_responses
-- Arguments: p_questionnaire_code text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_study_registration_id uuid, p_group_by text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:51+01:00

CREATE OR REPLACE FUNCTION public.aggregate_questionnaire_responses(p_questionnaire_code text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_study_registration_id uuid DEFAULT NULL::uuid, p_group_by text DEFAULT 'week'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_questionnaire_id uuid;
  v_result jsonb;
  v_blocks jsonb;
  v_time_series jsonb;
BEGIN
  -- Audit log for sensitive data aggregation
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'aggregate_questionnaire_responses',
    jsonb_build_object(
      'area', 'phi',
      'severity', 'info',
      'entity_type', 'questionnaire_responses',
      'questionnaire_code', p_questionnaire_code,
      'study_registration_id', p_study_registration_id,
      'group_by', p_group_by
    )
  );

  -- Get questionnaire ID
  SELECT id INTO v_questionnaire_id
  FROM questionnaires
  WHERE code = p_questionnaire_code AND is_active = true;
  
  IF v_questionnaire_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Questionnaire not found', 'code', p_questionnaire_code);
  END IF;

  -- Aggregate per-block statistics
  WITH response_data AS (
    SELECT 
      qr.id,
      qr.user_id,
      qr.responses,
      qr.completed_at,
      qr.study_registration_id
    FROM questionnaire_responses qr
    WHERE qr.questionnaire_id = v_questionnaire_id
      AND (p_start_date IS NULL OR qr.completed_at >= p_start_date)
      AND (p_end_date IS NULL OR qr.completed_at <= p_end_date)
      AND (p_study_registration_id IS NULL OR qr.study_registration_id = p_study_registration_id)
  ),
  block_stats AS (
    SELECT 
      qb.block_id,
      qblk.code AS block_code,
      qblk.question_type,
      qblk.config,
      COUNT(DISTINCT rd.id) AS response_count,
      -- Scale/number aggregations
      CASE WHEN qblk.question_type IN ('scale', 'number') THEN
        AVG((rd.responses->qblk.code->>'value')::numeric)
      END AS avg_value,
      CASE WHEN qblk.question_type IN ('scale', 'number') THEN
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (rd.responses->qblk.code->>'value')::numeric)
      END AS median_value,
      CASE WHEN qblk.question_type IN ('scale', 'number') THEN
        STDDEV((rd.responses->qblk.code->>'value')::numeric)
      END AS std_dev,
      CASE WHEN qblk.question_type IN ('scale', 'number') THEN
        MIN((rd.responses->qblk.code->>'value')::numeric)
      END AS min_value,
      CASE WHEN qblk.question_type IN ('scale', 'number') THEN
        MAX((rd.responses->qblk.code->>'value')::numeric)
      END AS max_value,
      -- Boolean aggregation
      CASE WHEN qblk.question_type = 'boolean' THEN
        COUNT(*) FILTER (WHERE (rd.responses->qblk.code->>'value')::boolean = true)
      END AS true_count,
      CASE WHEN qblk.question_type = 'boolean' THEN
        COUNT(*) FILTER (WHERE (rd.responses->qblk.code->>'value')::boolean = false)
      END AS false_count,
      -- Tags aggregation (collect all tags)
      CASE WHEN qblk.question_type = 'tags' THEN
        jsonb_agg(rd.responses->qblk.code->'selectedTags')
      END AS all_tags
    FROM questionnaire_blocks qb
    JOIN question_blocks qblk ON qblk.id = qb.block_id
    LEFT JOIN response_data rd ON rd.responses ? qblk.code
    WHERE qb.questionnaire_id = v_questionnaire_id
    GROUP BY qb.block_id, qblk.code, qblk.question_type, qblk.config
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'block_code', block_code,
      'question_type', question_type,
      'response_count', response_count,
      'aggregation', CASE 
        WHEN question_type IN ('scale', 'number') THEN
          jsonb_build_object(
            'type', question_type,
            'avg', COALESCE(avg_value, 0),
            'median', COALESCE(median_value, 0),
            'std_dev', COALESCE(std_dev, 0),
            'min', COALESCE(min_value, 0),
            'max', COALESCE(max_value, 0)
          )
        WHEN question_type = 'boolean' THEN
          jsonb_build_object(
            'type', 'boolean',
            'true_count', COALESCE(true_count, 0),
            'false_count', COALESCE(false_count, 0),
            'true_percentage', CASE WHEN response_count > 0 
              THEN ROUND((COALESCE(true_count, 0)::numeric / response_count) * 100, 2)
              ELSE 0 
            END
          )
        WHEN question_type = 'tags' THEN
          jsonb_build_object(
            'type', 'tags',
            'all_tags', COALESCE(all_tags, '[]'::jsonb)
          )
        ELSE
          jsonb_build_object('type', question_type, 'raw', 'text-based')
      END
    )
  ) INTO v_blocks
  FROM block_stats;

  -- Time series aggregation
  WITH time_buckets AS (
    SELECT 
      CASE p_group_by
        WHEN 'day' THEN date_trunc('day', qr.completed_at)
        WHEN 'week' THEN date_trunc('week', qr.completed_at)
        WHEN 'month' THEN date_trunc('month', qr.completed_at)
        ELSE date_trunc('week', qr.completed_at)
      END AS bucket,
      COUNT(*) AS response_count,
      AVG(jsonb_array_length(
        (SELECT jsonb_agg(k) FROM jsonb_object_keys(qr.responses) AS k)
      )) AS avg_blocks_answered
    FROM questionnaire_responses qr
    WHERE qr.questionnaire_id = v_questionnaire_id
      AND (p_start_date IS NULL OR qr.completed_at >= p_start_date)
      AND (p_end_date IS NULL OR qr.completed_at <= p_end_date)
      AND (p_study_registration_id IS NULL OR qr.study_registration_id = p_study_registration_id)
    GROUP BY bucket
    ORDER BY bucket
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'period', bucket,
      'response_count', response_count,
      'avg_blocks_answered', COALESCE(avg_blocks_answered, 0)
    )
  ) INTO v_time_series
  FROM time_buckets;

  -- Build final result
  v_result := jsonb_build_object(
    'questionnaire_code', p_questionnaire_code,
    'questionnaire_id', v_questionnaire_id,
    'filters', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'study_registration_id', p_study_registration_id,
      'group_by', p_group_by
    ),
    'blocks', COALESCE(v_blocks, '[]'::jsonb),
    'time_series', COALESCE(v_time_series, '[]'::jsonb),
    'generated_at', now()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.aggregate_questionnaire_responses(p_questionnaire_code text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_study_registration_id uuid, p_group_by text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aggregate_questionnaire_responses(p_questionnaire_code text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_study_registration_id uuid, p_group_by text) TO authenticated;
