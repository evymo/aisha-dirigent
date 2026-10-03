-- Function: public.save_operational_assessment_dimension
-- Arguments: p_assessment_id uuid, p_dimension text, p_raw_score numeric, p_normalized_score numeric, p_tag_count integer, p_has_negative_indicators boolean, p_operational_flags text[], p_tag_ids text[] DEFAULT NULL::text[], p_follow_up_answers jsonb DEFAULT NULL::jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.save_operational_assessment_dimension(p_assessment_id uuid, p_dimension text, p_raw_score numeric, p_normalized_score numeric, p_tag_count integer, p_has_negative_indicators boolean, p_operational_flags text[], p_tag_ids text[] DEFAULT NULL::text[], p_follow_up_answers jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dimensions JSONB;
  v_new_dim JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operational_assessments
    WHERE id = p_assessment_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_new_dim := jsonb_build_object(
    'dimension', p_dimension,
    'rawScore', p_raw_score,
    'normalizedScore', p_normalized_score,
    'tagCount', p_tag_count,
    'hasNegativeIndicators', p_has_negative_indicators,
    'operationalFlags', p_operational_flags,
    'tagIds', COALESCE(p_tag_ids, ARRAY[]::TEXT[]),
    'followUps', COALESCE(p_follow_up_answers, '[]'::JSONB)
  );

  SELECT COALESCE(dimensions, '[]'::JSONB)
  INTO v_dimensions
  FROM public.operational_assessments
  WHERE id = p_assessment_id;

  v_dimensions := (
    SELECT jsonb_agg(d)
    FROM jsonb_array_elements(v_dimensions) d
    WHERE d->>'dimension' != p_dimension
  );

  v_dimensions := COALESCE(v_dimensions, '[]'::JSONB) || jsonb_build_array(v_new_dim);

  UPDATE public.operational_assessments
  SET dimensions = v_dimensions, updated_at = now()
  WHERE id = p_assessment_id;

  -- Persist the dimension as a normalized row as well. This is the queryable
  -- source of truth (one row per assessment+dimension, cross-assessment/user
  -- analytics); the JSONB above is a per-row denormalized cache. The score
  -- stored here is the OUTPUT of the client scoring logic, not a free blob.
  -- get_my_latest_operational_assessment_audited reads this table first.
  INSERT INTO public.operational_assessment_dimensions (
    assessment_id, dimension, raw_score, normalized_score,
    tag_count, has_negative_indicators, operational_flags
  )
  VALUES (
    p_assessment_id, p_dimension::operational_dimension, p_raw_score, p_normalized_score,
    p_tag_count, p_has_negative_indicators, COALESCE(p_operational_flags, '{}'::text[])
  )
  ON CONFLICT (assessment_id, dimension) DO UPDATE SET
    raw_score = EXCLUDED.raw_score,
    normalized_score = EXCLUDED.normalized_score,
    tag_count = EXCLUDED.tag_count,
    has_negative_indicators = EXCLUDED.has_negative_indicators,
    operational_flags = EXCLUDED.operational_flags;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_operational_assessment_dimension(uuid, text, numeric, numeric, integer, boolean, text[][], text[][], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_operational_assessment_dimension(uuid, text, numeric, numeric, integer, boolean, text[][], text[][], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_operational_assessment_dimension(uuid, text, numeric, numeric, integer, boolean, text[][], text[][], jsonb) TO service_role;
