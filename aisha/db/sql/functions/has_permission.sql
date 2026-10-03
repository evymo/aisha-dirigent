-- Function: public.has_permission
-- Arguments: p_user_id uuid, p_permission_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:51+01:00

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_permission_code IS NULL OR btrim(p_permission_code) = '' THEN
    RETURN false;
  END IF;

  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-12). Funkce vrací
  -- `true` pro KAŽDÉHO admina bez ohledu na kód oprávnění, takže kterýkoli
  -- přihlášený člen jí uměl zjistit, kdo je administrátor — stačilo znát uuid.
  -- Odpovídá se proto jen o VOLAJÍCÍM; služba a správa se smí ptát na kohokoli.
  -- Appka tím nepřijde o nic: `usePermissions.ts` posílá `p_user_id: user.id`,
  -- tedy sebe. Sourozenec has_role má tutéž stráž.
  -- ⛔ STRÁŽ MUSÍ BÝT ODOLNÁ VŮČI NULL (naměřeno 2026-09-19, tip kolegy z upstreamu).
  -- Tvar `IF NOT (p_x = auth.uid() OR …)` se při NEPŘIHLÁŠENÉM volajícím
  -- NEPROVEDE: `auth.uid()` je NULL, porovnání dá NULL, `NULL OR false OR false`
  -- je NULL, `NOT NULL` je NULL — a `IF NULL THEN` je stejné jako `IF false`.
  -- Stráž se tedy přeskočila a funkce odpověděla o TŘETÍ OSOBĚ přesně tomu,
  -- komu odpovídat neměla. `… IS NOT TRUE` zavírá: NULL i false vedou k zamítnutí.
  IF (p_user_id = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Admin always has full access.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) THEN
    RETURN true;
  END IF;

  -- Unified permission catalog.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'permissions'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'app_role_permissions'
  ) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.app_role_permissions arp ON arp.role = ur.role
      JOIN public.permissions p ON p.id = arp.permission_id
      WHERE ur.user_id = p_user_id
        AND p.code = p_permission_code
    );
  END IF;

  -- Legacy fallback.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'role_permissions'
      AND column_name = 'permission_id'
  ) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = p_user_id
        AND p.code = p_permission_code
    );
  END IF;

  RETURN false;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.has_permission(p_user_id uuid, p_permission_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(p_user_id uuid, p_permission_code text) TO authenticated;
