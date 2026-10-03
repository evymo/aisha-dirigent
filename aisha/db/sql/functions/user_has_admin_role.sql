-- Function: public.user_has_admin_role
-- Arguments: p_user_id uuid, _user_id uuid (alias)
-- Description: Checks if user has admin role.
-- Security: SECURITY DEFINER with search_path set.
-- Updated: 2026-01-11 - Added _user_id alias for TypeScript compatibility

CREATE OR REPLACE FUNCTION public.user_has_admin_role(
  p_user_id uuid DEFAULT NULL,
  -- TypeScript compatibility alias
  _user_id uuid DEFAULT NULL
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19) — tatáž třída
  -- jako has_role: kterýkoli přihlášený se pro libovolné uuid dozvěděl, zda je
  -- to administrátor. Veřejný adresář partnerů vydá `user_id` účtů, takže
  -- z obecného seznamu cílů je seznam ADRESNÝ.
  --
  -- Odpovídá se jen o VOLAJÍCÍM; služba a správa na kohokoli. Změřeno, že to nic
  -- nerozbije: v repu ji nevolá žádná politika, funkce ani klient (grep přes
  -- sql/ts/tsx/json). CASE drží NULL (anonym, prázdný argument) v ELSE = false.
  SELECT CASE
    WHEN COALESCE(p_user_id, _user_id) IS NULL THEN false
    WHEN COALESCE(p_user_id, _user_id) = auth.uid()
      OR public.is_service_role()
      OR public.is_admin_or_staff()
    THEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.name = ur.role
      WHERE ur.user_id = COALESCE(p_user_id, _user_id) AND r.is_admin = true
    )
    ELSE false
  END
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.user_has_admin_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_admin_role(uuid, uuid) TO authenticated;
