-- Function: public.get_knowledge_topic_posts_localized
-- Description: Returns discussion posts for a knowledge topic with translation support.
-- Uses cursor-based pagination.
-- Security: SECURITY DEFINER - authenticated access.
-- @security: authenticated
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_knowledge_topic_posts_localized(
  p_topic_id uuid,
  p_locale text DEFAULT 'en',
  p_limit integer DEFAULT 20,
  p_cursor timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  topic_id uuid,
  author_display_name text,
  body text,
  original_locale text,
  is_translated boolean,
  translation_provider text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    kp.id,
    kp.topic_id,
    public.format_display_name_for_public(p.display_name, p.nickname, p.is_public_profile) AS author_display_name,
    -- Return translated body if available, otherwise original
    COALESCE(
      kpt.body_translated,
      kp.body_original
    ) AS body,
    kp.original_locale,
    (kpt.body_translated IS NOT NULL AND kp.original_locale != p_locale) AS is_translated,
    kpt.provider AS translation_provider,
    kp.status,
    kp.created_at
  FROM knowledge_posts kp
  -- Re-check the PARENT topic's visibility: a per-post status='visible' does not
  -- imply the topic is readable. Without this join an authenticated user who knows
  -- an 'internal' topic id could read its posts. 'internal' topics are staff-only;
  -- 'public'/'members' topics are fine for any authenticated caller (anon is already
  -- rejected above). knowledge_topics gates on the visibility enum, not minimum_tier.
  JOIN knowledge_topics kt ON kt.id = kp.topic_id
  LEFT JOIN profiles p ON p.id = kp.author_user_id
  LEFT JOIN knowledge_post_translations kpt
    ON kpt.post_id = kp.id AND kpt.locale = p_locale
  WHERE
    kp.topic_id = p_topic_id
    AND kp.status = 'visible'
    AND (kt.visibility <> 'internal' OR public.is_admin_or_staff(auth.uid()))
    AND (p_cursor IS NULL OR kp.created_at < p_cursor)
  ORDER BY kp.created_at DESC
  LIMIT p_limit;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_knowledge_topic_posts_localized(uuid, text, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_knowledge_topic_posts_localized(uuid, text, integer, timestamptz) TO authenticated;
