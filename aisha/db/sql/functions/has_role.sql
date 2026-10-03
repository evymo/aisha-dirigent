-- Function: public.has_role
-- Arguments: p_user_id uuid, p_role text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:51+01:00

CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-12).
  -- Funkci směl volat i ANONYM, takže stačil řetěz o dvou krocích: veřejný
  -- adresář partnerů (`get_guild_members`) vydá `user_id` účtů, a tahle funkce
  -- na každý z nich pravdivě odpoví, jestli je admin. Z obecného seznamu cílů
  -- se tím stane seznam ADRESNÝ.
  --
  -- Odpovídá se proto jen o VOLAJÍCÍM; služba a správa se smí ptát na kohokoli.
  -- Změřeno, že to nic nerozbije: všech 91 politik, které funkci volají, jí
  -- předává `auth.uid()`, a ani jedna sloupec řádku. `false` místo výjimky je
  -- záměr — predikát má vracet deny, ne shodit dotaz.
  --
  -- REVOKE tady NENÍ řešením: RLS predikát se vyhodnocuje právy volajícího,
  -- takže odebrání EXECUTE shodí běžné čtení (`permission denied for function
  -- has_role` při obyčejném SELECTu — změřeno).
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_user_id = auth.uid()
      OR public.is_service_role()
      OR public.is_admin_or_staff()
    THEN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = p_user_id
      AND role::text = p_role
    )
    ELSE false
  END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.has_role(p_user_id uuid, p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(p_user_id uuid, p_role text) TO anon, authenticated;
