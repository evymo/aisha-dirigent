-- ============================================================================
-- Source of Truth: revert_broker_quarantine_discard_admin
-- Popis: Vrátí zahození karantény — odložené balíčky se do seznamu vrátí.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⭐ Sourozenec revert_workflow_decision_admin: rozhodnutí se vrací PODLE ID,
--    ne opakováním kritéria. Kritérium totiž mezitím platí na jiná data.
--
-- ⛔ VRACÍ SE SEZNAM, NE SOUBORY. Karanténa je záznam „tenhle balíček čeká na
--    rozhodnutí". Zahození ho smaže, vrácení ho vrátí — ale jestli balíček někde
--    ještě leží, je otázka retence, ne tohohle rozhodnutí. Proto se vrací jen
--    to, co v seznamu opravdu bylo (`zahozeno`), a co tam mezitím přibylo, zůstává.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true).
--
-- Kontrakt: (uuid, text, boolean) ->
--   jsonb {ok, dry_run, decision_id, obnoveno, karantena} | {ok:false, error}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revert_broker_quarantine_discard_admin(
  p_decision_id uuid,
  p_reason      text,
  p_dry_run     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rozhodnuti public.audit_journal%ROWTYPE;
  v_zdroj      text;
  v_zahozeno   text[];
  v_karantena  text[];
  v_nova       text[];
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  END IF;
  IF p_decision_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_decision_id je povinné');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'důvod (p_reason) je povinný — vrácení bez důvodu nejde doložit');
  END IF;

  SELECT * INTO v_rozhodnuti FROM public.audit_journal
   WHERE id = p_decision_id AND entity_type = 'broker_decision';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí nenalezeno');
  END IF;
  IF v_rozhodnuti.action <> 'broker.quarantine_discarded' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('typ rozhodnutí %s zatím vrátit neumím', v_rozhodnuti.action));
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_journal
              WHERE action = 'broker.quarantine_discard_reverted' AND entity_id = p_decision_id::text) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí už bylo vráceno');
  END IF;

  v_zdroj := v_rozhodnuti.details->'kriterium'->>'source_slug';
  v_zahozeno := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_rozhodnuti.details->'zahozeno', '[]'::jsonb)));

  SELECT array(SELECT jsonb_array_elements_text(coalesce(s.metadata->'karantena', '[]'::jsonb)))
    INTO v_karantena
    FROM public.audience_broker_sync_state s
   WHERE s.source_slug = v_zdroj;
  IF v_karantena IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('zdroj %s už nemá stav synchronizace — není kam vracet', v_zdroj));
  END IF;

  -- Sjednocení, ne přepsání: co do karantény přibylo po zahození, zůstává.
  v_nova := ARRAY(SELECT DISTINCT x FROM unnest(v_karantena || v_zahozeno) x ORDER BY x);

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'decision_id', p_decision_id,
                              'obnoveno', to_jsonb(ARRAY(SELECT x FROM unnest(v_zahozeno) x
                                                          WHERE NOT (x = ANY (v_karantena)))),
                              'karantena', to_jsonb(v_nova));
  END IF;

  UPDATE public.audience_broker_sync_state s
     SET metadata = jsonb_set(coalesce(s.metadata, '{}'::jsonb), '{karantena}', to_jsonb(v_nova)),
         updated_at = now()
   WHERE s.source_slug = v_zdroj;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details, metadata)
  VALUES (auth.uid(), 'broker.quarantine_discard_reverted', 'update', 'integrations',
          'broker_decision', p_decision_id::text,
          format('Vráceno zahození karantény zdroje %s: %s balíčků zpět — %s',
                 v_zdroj, array_length(v_zahozeno, 1), p_reason),
          jsonb_build_object('duvod', p_reason, 'obnoveno', to_jsonb(v_zahozeno),
                             'karantena', to_jsonb(v_nova)),
          jsonb_build_object('source_slug', v_zdroj, 'obnoveno', array_length(v_zahozeno, 1)));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', p_decision_id,
                            'obnoveno', to_jsonb(v_zahozeno), 'karantena', to_jsonb(v_nova));
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_broker_quarantine_discard_admin(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_broker_quarantine_discard_admin(uuid, text, boolean) TO authenticated, service_role;
