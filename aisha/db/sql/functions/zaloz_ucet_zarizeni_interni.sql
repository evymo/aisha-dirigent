-- Function: zaloz_ucet_zarizeni_interni
-- Založí (idempotentně) vlastní účet tabletu. JEDINÁ cesta, kudy účet zařízení vzniká —
-- volá ji definer admin_set_knock_device_approval při schválení tabletu (a heals při
-- jednorázovém dorovnání dříve schválených tabletů). Klient ji volat nesmí (bez grantu).
--
-- ⛔ POŘADÍ JE BEZPEČNOSTNÍ VLASTNOST (revize Aisha Guru 29. 9.): vazba
-- knock_device_credentials.ucet_id se zapíše DŘÍV, než vznikne uživatel. Trigger
-- handle_new_user pak pozná účet zařízení podle téhle vazby (strana serveru) a roli
-- `member` nepřidá. Příznak v raw_user_meta_data by šel nastavit i běžnou registrací.
CREATE OR REPLACE FUNCTION public.zaloz_ucet_zarizeni_interni(p_kid text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_d public.knock_device_credentials%ROWTYPE;
  v_ucet uuid;
BEGIN
  SELECT * INTO v_d FROM public.knock_device_credentials WHERE kid = p_kid FOR UPDATE;
  IF NOT FOUND OR v_d.druh <> 'tablet' THEN
    RETURN NULL;
  END IF;
  IF v_d.ucet_id IS NOT NULL THEN
    RETURN v_d.ucet_id;
  END IF;

  v_ucet := gen_random_uuid();
  UPDATE public.knock_device_credentials SET ucet_id = v_ucet, updated_at = now() WHERE kid = p_kid;
  INSERT INTO aisha_auth.users (id, email, raw_user_meta_data)
  VALUES (v_ucet, NULL, jsonb_build_object('display_name', 'Tablet ' || p_kid));

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'knock_device_account_created', jsonb_build_object('kid', p_kid, 'ucet_id', v_ucet));
  RETURN v_ucet;
END;
$function$;

REVOKE ALL ON FUNCTION public.zaloz_ucet_zarizeni_interni(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zaloz_ucet_zarizeni_interni(text) FROM anon, authenticated;
