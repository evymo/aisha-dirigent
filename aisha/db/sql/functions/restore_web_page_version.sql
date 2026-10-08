-- Function: public.restore_web_page_version
-- Description: Vrátí stránku k vybrané verzi — kam, rozhoduje stav stránky:
--                • zveřejněná → verze se nahraje do KONCEPTU (web se nezmění,
--                  dokud autor nezveřejní; obnova je tedy vratná);
--                • nezveřejněná → do živého stavu, ale nejdřív se uloží snímek
--                  'auto: before restore', aby šlo i obnovu vrátit.
--              Obě cesty jdou přes save_web_page_draft_admin (jediný zápis obsahu).
--
-- ⛔ Do 2026-10-02 SECURITY INVOKER s INSERTem do audit_journal → správci/staffovi
--    padala na RLS. A u zveřejněné stránky přepsala web okamžitě.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-04-14 · přepsáno 2026-10-02 (koncept, DEFINER)

CREATE OR REPLACE FUNCTION public.restore_web_page_version(
  p_page_id uuid,
  p_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_version record;
  v_status text;
  v_snimek uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_version
  FROM public.web_page_versions
  WHERE id = p_version_id AND page_id = p_page_id AND kind <> 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  SELECT status INTO v_status FROM public.web_pages WHERE id = p_page_id;
  IF v_status IS DISTINCT FROM 'published' THEN
    v_snimek := public.create_web_page_version(p_page_id, 'auto: before restore');
    -- NULL = stránka bez plátna, není co zálohovat (create_web_page_version).
    IF v_snimek IS NOT NULL THEN
      UPDATE public.web_page_versions SET kind = 'auto' WHERE id = v_snimek;
    END IF;
  END IF;

  PERFORM public.save_web_page_draft_admin(
    p_page_id, v_version.canvas_css, v_version.canvas_data, v_version.canvas_html, NULL, v_version.page_settings
  );

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_version_id::text,
    p_entity_type := 'web_page_version',
    p_new_values := jsonb_build_object('page_id', p_page_id, 'to_draft', v_status = 'published'),
    p_old_values := NULL,
    p_severity := 'warning'::public.journal_severity,
    p_summary := 'Restored web page version',
    p_tags := ARRAY['admin', 'content', 'web_page', 'restore'],
    p_user_id := auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_web_page_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_web_page_version(uuid, uuid) TO authenticated;
