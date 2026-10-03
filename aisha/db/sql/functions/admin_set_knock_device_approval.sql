-- Function: public.admin_set_knock_device_approval
-- Arguments: p_kid text, p_approved boolean
-- Security: SECURITY DEFINER, jen admin/staff nebo service_role.
--
-- Schválení a odvolání zařízení. Tohle je JEDINÉ místo, kde se o vstupu
-- rozhoduje — `register_knock_device` schválit nesmí (viz jeho hlavička).
--
-- ⛔ ODVOLÁNÍ ZÁZNAM NEMAŽE. Smazaný řádek vypadá jako „nikdy nebyl", takže by
-- z ničeho nešlo poznat, že zařízení kdysi schválené bylo — a to je přesně
-- údaj, který při vyšetřování potřebuješ. Odvolané zařízení musí zaťukat
-- ručně; žádná zvláštní větev pro to není potřeba, `unknown-kid` a odvolaný
-- průkaz se z pohledu telefonu chovají stejně (dveře mlčí).

CREATE OR REPLACE FUNCTION public.admin_set_knock_device_approval(p_kid text, p_approved boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dotceno int;
BEGIN
  IF NOT ((SELECT public.is_service_role()) OR (SELECT public.is_admin_or_staff())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_approved THEN
    UPDATE public.knock_device_credentials
       SET approved_at = now(), approved_by = v_uid,
           revoked_at = NULL, revoked_by = NULL, updated_at = now()
     WHERE kid = p_kid;
  ELSE
    UPDATE public.knock_device_credentials
       SET revoked_at = now(), revoked_by = v_uid,
           approved_at = NULL, approved_by = NULL, updated_at = now()
     WHERE kid = p_kid;
  END IF;

  GET DIAGNOSTICS v_dotceno = ROW_COUNT;
  IF v_dotceno = 0 THEN
    RAISE EXCEPTION 'zařízení % neexistuje', p_kid;
  END IF;

  -- F2: schválený TABLET dostane vlastní účet (jediné místo, kde účet zařízení vzniká;
  -- idempotentní). Odvolání účet NEmaže — zůstane kvůli auditu a jen ztratí platnost
  -- (pátá cesta viditelnosti se ptá na platný průkaz při každém volání).
  IF p_approved THEN
    PERFORM public.zaloz_ucet_zarizeni_interni(p_kid);
  END IF;

  -- Audit nese JEN identifikátory, nikdy klíč ani PII.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_uid,
          CASE WHEN p_approved THEN 'knock_device_approved' ELSE 'knock_device_revoked' END,
          jsonb_build_object('kid', p_kid));

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.admin_set_knock_device_approval(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_knock_device_approval(text, boolean) TO authenticated, service_role;
