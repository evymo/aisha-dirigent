CREATE OR REPLACE FUNCTION public.get_topic_translation(
  p_topic_slug text,
  p_locale text DEFAULT 'en'
)
RETURNS TABLE (
  topic_id uuid,
  topic_slug text,
  version_no integer,
  source_locale text,
  body_markdown text,
  body_translated text,
  translation_provider text,
  translation_model text,
  is_human_reviewed boolean,
  quality_score numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_topic_id uuid;
  v_source_locale text;
  v_version_id uuid;
  v_version_no integer;
  v_body text;
BEGIN
  -- Get topic
  SELECT kt.id, kt.source_locale
  INTO v_topic_id, v_source_locale
  FROM knowledge_topics kt
  WHERE kt.slug = p_topic_slug;

  IF v_topic_id IS NULL THEN
    RETURN;
  END IF;

  -- Get latest version
  SELECT ktv.id, ktv.version_no, ktv.body_markdown
  INTO v_version_id, v_version_no, v_body
  FROM knowledge_topic_versions ktv
  WHERE ktv.topic_id = v_topic_id
  ORDER BY ktv.version_no DESC
  LIMIT 1;

  IF v_version_id IS NULL THEN
    RETURN;
  END IF;

  -- If requested locale = source locale, return original
  IF p_locale = v_source_locale THEN
    RETURN QUERY SELECT
      v_topic_id,
      p_topic_slug,
      v_version_no,
      v_source_locale,
      v_body,
      v_body,         -- body_translated = original
      'source'::text, -- provider
      'none'::text,   -- model
      true,           -- is_human_reviewed (it IS the original)
      1.0::numeric;   -- quality_score
    RETURN;
  END IF;

  -- Check translation cache
  RETURN QUERY
  SELECT
    v_topic_id,
    p_topic_slug,
    v_version_no,
    v_source_locale,
    v_body,
    ktt.body_translated,
    ktt.provider,
    ktt.model,
    ktt.is_human_reviewed,
    ktt.quality_score
  FROM knowledge_topic_translations ktt
  WHERE ktt.topic_version_id = v_version_id
    AND ktt.locale = p_locale;

  -- If no rows returned, caller should invoke translate-content edge function
END;
$$;

REVOKE ALL ON FUNCTION public.get_topic_translation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_topic_translation(text, text) TO authenticated;
