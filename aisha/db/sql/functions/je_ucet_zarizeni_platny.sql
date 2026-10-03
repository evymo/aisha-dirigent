-- Function: je_ucet_zarizeni_platny
-- Je účet účtem tabletu s PLATNÝM průkazem — schválený, neodvolaný, nevypršelý?
-- Pátá cesta workflow_step_visible_to se ptá TADY při každém volání, takže odvolání
-- průkazu platí hned (nejpozději do vypršení krátkého tokenu, i kdyby ho někdo držel).
-- Oracle guard: přihlášený se smí ptát jen na sebe; service/admin na kohokoli.
CREATE OR REPLACE FUNCTION public.je_ucet_zarizeni_platny(p_uid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) IS NOT TRUE THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.knock_device_credentials d
     WHERE d.ucet_id = p_uid
       AND d.druh = 'tablet'
       AND d.approved_at IS NOT NULL
       AND d.revoked_at IS NULL
       AND (d.plati_do IS NULL OR d.plati_do > now()));
END;
$function$;

REVOKE ALL ON FUNCTION public.je_ucet_zarizeni_platny(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.je_ucet_zarizeni_platny(uuid) TO authenticated, service_role;
