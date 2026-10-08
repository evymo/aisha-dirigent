-- Function: public.discard_web_page_draft_admin
-- Description: Zahodí koncept stránky — editor se vrátí ke zveřejněnému stavu.
--              Bez konceptu nic nedělá. Vrací razítko živé stránky.
-- Security: SECURITY DEFINER; admin/staff.
-- Created: 2026-10-02 (zrcadlí discard_news_article_draft_admin)

CREATE OR REPLACE FUNCTION public.discard_web_page_draft_admin(p_page_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated timestamptz;
  v_smazano integer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT p.updated_at INTO v_updated FROM public.web_pages p WHERE p.id = p_page_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  DELETE FROM public.web_page_versions d
  WHERE d.page_id = p_page_id AND d.kind = 'draft';
  GET DIAGNOSTICS v_smazano = ROW_COUNT;

  IF v_smazano > 0 THEN
    PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_page_id::text,
      p_entity_type := 'web_page',
      p_new_values := jsonb_build_object('draft', 'discarded'),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Discarded web page draft',
      p_tags := ARRAY['admin', 'content', 'web_page', 'draft'],
      p_user_id := auth.uid()
    );
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_web_page_draft_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_web_page_draft_admin(uuid) TO authenticated;
