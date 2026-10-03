-- ============================================================================
-- Source of Truth: surface_udeleni_admin
-- Popis: Pro správu v administraci u uživatele: udělitelné sekce extranetu
--        (aktivní umístění nebo šablona s osou publika "udeleni") a zda je
--        uživatel má udělené. Pořadí jako v navigaci.
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.surface_udeleni_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH udelitelne AS (
      SELECT DISTINCT l.audience->>'udeleni' AS surface
        FROM public.surface_layouts l
       WHERE l.is_active AND l.audience ? 'udeleni'
      UNION
      SELECT s.audience->>'udeleni'
        FROM public.surface_sections s
       WHERE s.is_active AND s.audience ? 'udeleni'
    )
    SELECT jsonb_agg(jsonb_build_object(
             'surface',    u.surface,
             'title_key',  s.title_key,
             'udeleno',    g.user_id IS NOT NULL,
             'granted_at', g.granted_at)
           ORDER BY coalesce(s.group_order, 0), coalesce(s.position, 0), u.surface)
      FROM udelitelne u
      LEFT JOIN public.surface_sections s ON s.surface = u.surface
      LEFT JOIN public.surface_section_grants g ON g.surface = u.surface AND g.user_id = p_user_id
     WHERE u.surface ~ '^[a-z][a-z0-9_]*$'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.surface_udeleni_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surface_udeleni_admin(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.surface_udeleni_admin(uuid) IS
  'Správa: udělitelné sekce extranetu a stav udělení pro uživatele (administrace u uživatele).';
