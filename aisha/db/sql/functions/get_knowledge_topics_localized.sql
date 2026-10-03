-- Function: public.get_knowledge_topics_localized
-- Description: Returns knowledge topics with localized title and summary.
-- Security: SECURITY DEFINER - public knowledge access.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_knowledge_topics_localized(
  p_locale text DEFAULT 'en',
  p_visibility text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  slug text,
  title text,
  summary text,
  visibility text,
  verification_status text,
  source_locale text,
  is_locked boolean,
  post_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    kt.id,
    kt.slug,
    public.get_translation_value_with_fallback(
      kt.title_key, 'knowledge', p_locale, 'en', kt.title_key
    ) AS title,
    public.get_translation_value_with_fallback(
      kt.summary_key, 'knowledge', p_locale, 'en', NULL
    ) AS summary,
    kt.visibility,
    kt.verification_status,
    kt.source_locale,
    COALESCE(kt.is_locked, false) AS is_locked,
    (
      SELECT COUNT(*)
      FROM knowledge_posts kp
      WHERE kp.topic_id = kt.id AND kp.status = 'visible'
    ) AS post_count,
    kt.created_at,
    kt.updated_at
  FROM knowledge_topics kt
  WHERE
    -- Visibility filter: public topics visible to all, member topics to authenticated
    (
      kt.visibility = 'public'
      OR (auth.role() = 'authenticated' AND kt.visibility IN ('public', 'members'))
      OR has_role(auth.uid(), 'admin')
    )
    AND (p_visibility IS NULL OR kt.visibility = p_visibility)
    AND (p_search IS NULL OR
      public.get_translation_value_with_fallback(
        kt.title_key, 'knowledge', p_locale, 'en', kt.title_key
      ) ILIKE '%' || p_search || '%'
    )
  ORDER BY kt.updated_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_knowledge_topics_localized(text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_knowledge_topics_localized(text, text, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_knowledge_topics_localized(text, text, text, integer, integer) TO authenticated;
