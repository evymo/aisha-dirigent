-- Source of truth for delete_news_article_admin
-- Admin deletes a news article with audit logging

CREATE OR REPLACE FUNCTION delete_news_article_admin(
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.news_articles WHERE id = p_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'NEWS_DELETE',
    jsonb_build_object(
      'area', 'content',
      'severity', 'warning',
      'entity_type', 'news_article',
      'entity_id', p_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_news_article_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_news_article_admin(uuid) TO authenticated;
