-- Function: public.get_knowledge_topic_detail_localized
-- Description: Returns a single knowledge topic with localized fields, latest body, and linked documents.
-- Security: SECURITY DEFINER - public knowledge access.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_knowledge_topic_detail_localized(
  p_slug text,
  p_locale text DEFAULT 'en'
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
  body_markdown text,
  links jsonb,
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
    -- Latest version body
    (
      SELECT ktv.body_markdown
      FROM knowledge_topic_versions ktv
      WHERE ktv.topic_id = kt.id
      ORDER BY ktv.version_no DESC
      LIMIT 1
    ) AS body_markdown,
    -- Linked documents as JSONB array
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ktl.id,
          'link_type', ktl.link_type,
          'is_verified', ktl.is_verified,
          'sort_order', ktl.sort_order,
          'archive_document_id', ktl.archive_document_id,
          'external_url', ktl.external_url,
          'product_id', ktl.product_id,
          'production_batch_id', ktl.production_batch_id
        ) ORDER BY ktl.sort_order
      ), '[]'::jsonb)
      FROM knowledge_topic_links ktl
      WHERE ktl.topic_id = kt.id
    ) AS links,
    -- Post count
    (
      SELECT COUNT(*)
      FROM knowledge_posts kp
      WHERE kp.topic_id = kt.id AND kp.status = 'visible'
    ) AS post_count,
    kt.created_at,
    kt.updated_at
  FROM knowledge_topics kt
  WHERE
    kt.slug = p_slug
    AND (
      kt.visibility = 'public'
      OR (auth.role() = 'authenticated' AND kt.visibility IN ('public', 'members'))
      OR has_role(auth.uid(), 'admin')
    )
  LIMIT 1;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_knowledge_topic_detail_localized(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_knowledge_topic_detail_localized(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_knowledge_topic_detail_localized(text, text) TO authenticated;
