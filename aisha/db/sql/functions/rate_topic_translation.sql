CREATE OR REPLACE FUNCTION public.rate_topic_translation(
  p_topic_version_id uuid,
  p_locale text,
  p_quality_score numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_quality_score < 0 OR p_quality_score > 1 THEN
    RAISE EXCEPTION 'quality_score must be between 0 and 1' USING ERRCODE = 'P0002';
  END IF;

  UPDATE knowledge_topic_translations
  SET quality_score = p_quality_score,
      is_human_reviewed = true
  WHERE topic_version_id = p_topic_version_id
    AND locale = p_locale;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Translation not found' USING ERRCODE = 'P0003';
  END IF;

  -- Log to audit journal
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'TRANSLATION_RATED',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'topic_version_id', p_topic_version_id,
      'locale', p_locale,
      'quality_score', p_quality_score
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rate_topic_translation(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_topic_translation(uuid, text, numeric) TO authenticated;
