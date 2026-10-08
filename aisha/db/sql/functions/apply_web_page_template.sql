-- Function: public.apply_web_page_template
-- Description: Použije šablonu na stránku — kam, rozhoduje stav stránky:
--                • zveřejněná → šablona jde do KONCEPTU (web se nezmění, dokud
--                  autor nezveřejní);
--                • nezveřejněná → do živého stavu, předtím snímek
--                  'auto: before template apply'.
--              Šablona nese i page_settings (např. `chrome: "none"` webu), takže
--              nová stránka z šablony vypadá jako web, ne jako Studio.
--
-- ⛔ VLASTNÍ KLÍČE STRÁNKY ZŮSTÁVAJÍ: `seed_fingerprint` a `role`. Šablona nese
--    otisk JINÉ stránky (nebo žádný) — a seed instance bere chybějící otisk jako
--    „řádek z doby před otisky" a stránku při příštím nasazení PŘEPÍŠE. Ztráta
--    `role: "partial"` by z hlavičky udělala samostatnou stránku.
--
-- ⛔ Do 2026-10-02 SECURITY INVOKER s INSERTem do audit_journal → správci/staffovi
--    padala na RLS; nová stránka funkce se tak nedala založit ze šablony.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-04-14 · přepsáno 2026-10-02 (koncept, DEFINER)

CREATE OR REPLACE FUNCTION public.apply_web_page_template(
  p_page_id uuid,
  p_template_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tpl record;
  v_status text;
  v_nastaveni jsonb;
  v_snimek uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_tpl
  FROM public.web_page_templates
  WHERE id = p_template_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  SELECT status, page_settings INTO v_status, v_nastaveni FROM public.web_pages WHERE id = p_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  IF v_status IS DISTINCT FROM 'published' THEN
    v_snimek := public.create_web_page_version(p_page_id, 'auto: before template apply');
    IF v_snimek IS NOT NULL THEN
      UPDATE public.web_page_versions SET kind = 'auto' WHERE id = v_snimek;
    END IF;
  END IF;

  PERFORM public.save_web_page_draft_admin(
    p_page_id, v_tpl.canvas_css, v_tpl.canvas_data, v_tpl.canvas_html, NULL,
    (COALESCE(v_tpl.page_settings, '{}'::jsonb) - 'seed_fingerprint' - 'role')
      || jsonb_strip_nulls(jsonb_build_object(
           'seed_fingerprint', v_nastaveni -> 'seed_fingerprint',
           'role', v_nastaveni -> 'role'))
  );

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_template_id::text,
    p_entity_type := 'web_page_template',
    p_new_values := jsonb_build_object('page_id', p_page_id, 'to_draft', v_status = 'published'),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Applied web page template',
    p_tags := ARRAY['admin', 'content', 'web_page', 'template'],
    p_user_id := auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_web_page_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_web_page_template(uuid, uuid) TO authenticated;
