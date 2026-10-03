-- Function: public.get_questionnaires_admin
-- Description: Returns all questionnaires for admin management with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_questionnaires_admin()
 RETURNS TABLE(
   id uuid,
   base_locale text,
   code text,
   created_at timestamptz,
   description_key text,
   is_active boolean,
   name text,
   name_key text,
   points_reward integer,
   questionnaire_type text,
   questions jsonb,
   question_count integer,
   token_reward integer,
   updated_at timestamptz,
   version integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_entity_type := 'questionnaires',
      p_summary := 'Admin viewed questionnaires list',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    q.id,
    COALESCE(q.base_locale, 'en') AS base_locale,
    q.code,
    q.created_at,
    COALESCE(q.description_key, '') AS description_key,
    q.is_active,
    q.name,
    COALESCE(q.name_key, '') AS name_key,
    COALESCE(q.points_reward, 0) AS points_reward,
    COALESCE(q.questionnaire_type, '') AS questionnaire_type,
    CASE
      WHEN COALESCE(qb_agg.question_count, 0) > 0 THEN qb_agg.questions
      WHEN jsonb_typeof(q.questions) = 'array' THEN q.questions
      ELSE '[]'::jsonb
    END AS questions,
    CASE
      WHEN COALESCE(qb_agg.question_count, 0) > 0 THEN qb_agg.question_count
      WHEN jsonb_typeof(q.questions) = 'array' THEN jsonb_array_length(q.questions)
      ELSE 0
    END AS question_count,
    COALESCE(q.token_reward, 0) AS token_reward,
    COALESCE(q.updated_at, q.created_at) AS updated_at,
    COALESCE(q.version, 1) AS version
  FROM public.questionnaires q
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'id', bi.question_id,
              'type', bi.question_type,
              'text', bi.text_key,
              'description', bi.description_key,
              'required', bi.is_required,
              'order', bi.question_order,
              'options', bi.options,
              'scaleLabels', bi.scale_labels,
              'min', bi.scale_min,
              'max', bi.scale_max,
              'blockCode', bi.block_code,
              'blockId', bi.block_id
            )
          )
          ORDER BY bi.sort_step, bi.sort_display_order, bi.sort_created_at, bi.question_id
        ),
        '[]'::jsonb
      ) AS questions,
      COUNT(*)::integer AS question_count
    FROM (
      SELECT
        format('block_%s', qb.id::text) AS question_id,
        b.question_type,
        b.text_key,
        b.description_key,
        qb.is_required,
        (
          ROW_NUMBER() OVER (
            ORDER BY COALESCE(qb.step_number, 1), qb.display_order, qb.created_at, qb.id
          ) - 1
        )::integer AS question_order,
        CASE
          WHEN jsonb_typeof(b.config->'options') = 'array' THEN b.config->'options'
          ELSE NULL
        END AS options,
        CASE
          WHEN jsonb_typeof(b.config->'scale'->'labels') = 'array' THEN b.config->'scale'->'labels'
          ELSE NULL
        END AS scale_labels,
        CASE
          WHEN jsonb_typeof(b.config->'scale'->'min') = 'number' THEN (b.config->'scale'->>'min')::numeric
          ELSE NULL
        END AS scale_min,
        CASE
          WHEN jsonb_typeof(b.config->'scale'->'max') = 'number' THEN (b.config->'scale'->>'max')::numeric
          ELSE NULL
        END AS scale_max,
        b.code AS block_code,
        b.id AS block_id,
        COALESCE(qb.step_number, 1) AS sort_step,
        qb.display_order AS sort_display_order,
        qb.created_at AS sort_created_at
      FROM public.questionnaire_blocks qb
      JOIN public.question_blocks b ON b.id = qb.block_id AND b.is_active = true
      WHERE qb.questionnaire_id = q.id
    ) bi
  ) qb_agg ON true
  ORDER BY q.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_questionnaires_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_questionnaires_admin() TO authenticated;
