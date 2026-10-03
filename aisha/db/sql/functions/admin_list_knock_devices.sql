-- Function: public.admin_list_knock_devices
-- Arguments: p_user_id uuid, p_druh text ('osobni' | 'tablet' | NULL = oba)
-- Security: SECURITY DEFINER, jen admin/staff nebo service_role.
--
-- Co správce v administraci u uživatele vidí.
--
-- ⭐ „KDO POUŽÍVÁ KTERÁ ZAŘÍZENÍ" se NEČTE z průkazu, ale z `mobile_sessions`
-- přes most `push_device_id` — tam ta vazba bydlí (řádek na dvojici
-- uživatel×zařízení). Průkaz nese jen toho, kdo zařízení ZAVEDL.
--
-- ⛔ VEŘEJNÝ KLÍČ SE VRACÍ CELÝ a je to v pořádku: je veřejný z definice a
-- správce podle něj zařízení pozná. Soukromá půlka v téhle tabulce NENÍ a být
-- nesmí — kdyby tu jednou byla, vracela by ji i tahle funkce.

-- 2026-09-28: výstup nese i druh průkazu, adresu ohlášení a verze (tablet v kiosku se
-- ohlašuje sám — správce vidí, co schvaluje). Změna návratového typu = DROP předem.
-- ⛔ Jednoparametrová verze vracela užší tvar (bez druhu, adresy a verzí). Tvar
-- výsledku CREATE OR REPLACE změnit neumí, proto nová signatura se dvěma
-- parametry a starší přetížení JINÉ arity se zahodí (2026-09-28, tablety).
DROP FUNCTION IF EXISTS public.admin_list_knock_devices(uuid);
CREATE OR REPLACE FUNCTION public.admin_list_knock_devices(
  p_user_id uuid DEFAULT NULL::uuid,
  p_druh text DEFAULT NULL::text
)
 RETURNS TABLE (
   kid text,
   public_key_hex text,
   scope text,
   owner_user_id uuid,
   push_device_id text,
   first_seen_at timestamptz,
   last_seen_at timestamptz,
   approved_at timestamptz,
   revoked_at timestamptz,
   uzivatele jsonb,
   druh text,
   ohlaseno_z_ip text,
   verze jsonb
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT ((SELECT public.is_service_role()) OR (SELECT public.is_admin_or_staff())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    d.kid, d.public_key_hex, d.scope, d.owner_user_id, d.push_device_id,
    d.first_seen_at, d.last_seen_at, d.approved_at, d.revoked_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'last_active_at', s.last_active_at)
                        ORDER BY s.last_active_at DESC)
         FROM public.mobile_sessions s
        WHERE s.device_id = d.push_device_id),
      '[]'::jsonb
    ) AS uzivatele,
    d.druh,
    host(d.ohlaseno_z_ip) AS ohlaseno_z_ip,
    d.verze
  FROM public.knock_device_credentials d
  WHERE (p_druh IS NULL OR d.druh = p_druh)
    AND (p_user_id IS NULL
     OR d.owner_user_id = p_user_id
     -- Zařízení patří do výpisu u uživatele i tehdy, když ho jen POUŽÍVÁ:
     -- zavedl ho někdo jiný, ale odvolání se týká i jeho.
     OR EXISTS (SELECT 1 FROM public.mobile_sessions s
                 WHERE s.device_id = d.push_device_id AND s.user_id = p_user_id))
  ORDER BY d.last_seen_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.admin_list_knock_devices(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_knock_devices(uuid, text) TO authenticated, service_role;
