-- Function: public.get_user_sections
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:47+01:00

CREATE OR REPLACE FUNCTION public.get_user_sections(p_user_id uuid DEFAULT auth.uid())
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Sekce jsou
  -- odvozené z rolí, takže seznam sekcí cizího uuid prozradí jeho role (admin,
  -- staff, partner …) — tatáž třída jako has_role, jen s víc bity najednou.
  --
  -- Odpovídá se jen o VOLAJÍCÍM (výchozí `p_user_id` je sám volající); služba
  -- a správa na kohokoli. Cizí dotaz dostane prázdné pole — totéž, co účet bez
  -- rolí, takže zamítnutí nic neprozradí. Změřeno, že to nic nerozbije: v repu
  -- ji nevolá žádná politika, funkce ani klient.
  SELECT CASE
    WHEN p_user_id = auth.uid()
      OR public.is_service_role()
      OR public.is_admin_or_staff()
    THEN (
      SELECT COALESCE(
        ARRAY_AGG(DISTINCT rp.section::text),
        ARRAY[]::TEXT[]
      )
      FROM public.role_permissions rp
      JOIN public.user_roles ur ON ur.role = rp.role
      WHERE ur.user_id = p_user_id
    )
    ELSE ARRAY[]::TEXT[]
  END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_sections(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sections(p_user_id uuid) TO authenticated;
