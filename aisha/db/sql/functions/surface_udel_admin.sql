-- ============================================================================
-- Source of Truth: surface_udel_admin
-- Popis: Udělí / odebere uživateli přístup do sekce extranetu (osa publika
--        „udeleni"). Správa v administraci u uživatele — rozhodnutí majitele
--        2026-09-28: přístup do sekce je u uživatele, ne role; data v sekci dál
--        řídí nárok z vazeb.
--
-- Udělit jde jen sekci, kterou některé aktivní umístění nebo šablona sekce
-- deklaruje jako udělitelnou (audience obsahuje "udeleni": "<sekce>") — jinak by
-- udělení nic neotevřelo a v administraci by vypadalo jako funkční.
-- Každá změna jde do audit_journal (kdo, komu, jakou sekci, udělil/odebral).
--
-- Bezpečnost: SECURITY DEFINER; jen správa (is_admin_or_staff).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.surface_udel_admin(
  p_user_id uuid,
  p_surface text,
  p_udelit  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pocet integer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa uděluje sekce' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_surface IS NULL OR p_surface !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid_surface' USING ERRCODE = '22023';
  END IF;
  IF p_udelit AND NOT (
       EXISTS (SELECT 1 FROM public.surface_layouts l
                WHERE l.is_active AND l.audience->>'udeleni' = p_surface)
       OR EXISTS (SELECT 1 FROM public.surface_sections s
                   WHERE s.is_active AND s.audience->>'udeleni' = p_surface)) THEN
    RAISE EXCEPTION 'surface_not_grantable: sekce % nemá umístění s osou udeleni', p_surface
      USING ERRCODE = '22023';
  END IF;

  IF p_udelit THEN
    INSERT INTO public.surface_section_grants (user_id, surface, granted_by)
    VALUES (p_user_id, p_surface, auth.uid())
    ON CONFLICT (user_id, surface) DO NOTHING;
  ELSE
    DELETE FROM public.surface_section_grants
     WHERE user_id = p_user_id AND surface = p_surface;
  END IF;
  GET DIAGNOSTICS v_pocet = ROW_COUNT;

  IF v_pocet > 0 THEN
    PERFORM public.write_audit_journal(
      p_action_type := (CASE WHEN p_udelit THEN 'create' ELSE 'delete' END)::public.journal_action_type,
      p_area        := 'admin'::public.journal_area,
      p_details     := jsonb_build_object('surface', p_surface, 'target_user_id', p_user_id, 'udelit', p_udelit),
      p_entity_id   := p_user_id::text,
      p_entity_type := 'surface_section_grants',
      p_new_values  := NULL,
      p_old_values  := NULL,
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('%s sekce %s', CASE WHEN p_udelit THEN 'Udělena' ELSE 'Odebrána' END, p_surface),
      p_tags        := ARRAY['admin', 'surface', 'udeleni'],
      p_user_id     := auth.uid()
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'surface', p_surface, 'udeleno', p_udelit, 'zmena', v_pocet > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.surface_udel_admin(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surface_udel_admin(uuid, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.surface_udel_admin(uuid, text, boolean) IS
  'Správa: udělí/odebere uživateli sekci extranetu (osa publika udeleni). Jen udělitelné sekce, audit.';
