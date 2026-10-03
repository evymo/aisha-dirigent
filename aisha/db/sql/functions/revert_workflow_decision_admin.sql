-- ============================================================================
-- Source of Truth: revert_workflow_decision_admin
-- Popis: VRÁTÍ jedno rozhodnutí nad procesem (podle decision_id z audit_journal):
--        uzly obnoví do stavu PŘED rozhodnutím, s důvodem a stopou, kdo vracel.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⭐ ZADÁNÍ MAJITELE 2026-09-15: „všechny tyto autonomní kroky potřebujeme umět
--    dohledat, dohledovat a případně zrušit a opravit uživatelem z UI". Hromadný
--    zásah bez cesty zpět je jednosměrný — a chyba v kritériu by se opravovala
--    dalším ručním zásahem, tentokrát bez stopy.
--
-- ⭐ VRACÍ PŘESNĚ, NE ODHADEM. Rozhodnutí si u každého uzlu uložilo jeho stav
--    PŘED sebou (`pred_uzavrenim`) a v audit_journal seznam uzlů. Vrací se jen
--    uzly, které pořád nesou TOTO decision_id a jsou pořád v tom stavu, do kterého
--    je rozhodnutí dalo. Uzel, se kterým od té doby někdo pracoval, se nepřepíše —
--    počítá se jako `preskoceno_zmenene` a vrácení to řekne.
--
-- ⛔ audit_journal je neměnný (fn_audit_journal_guard): vrácení se ZAPISUJE jako
--    nový řádek `workflow.decision_reverted` s entity_id = decision_id. Dvojí
--    vrácení se odmítne.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true).
--
-- Typy rozhodnutí: workflow.runs_closed_by_decision (close_stale_workflow_runs_admin).
-- Jiný typ se odmítne pojmenovaně — vrácení, které neví, co vrací, je horší než žádné.
--
-- Kontrakt: (uuid, text, boolean) ->
--   jsonb {ok, dry_run, decision_id, akce, obnoveno, preskoceno_zmenene, taktu_otevreno}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revert_workflow_decision_admin(
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
  v_obnoveno   integer := 0;
  v_zmenene    integer := 0;
  v_taktu      integer := 0;
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
   WHERE id = p_decision_id AND entity_type = 'workflow_decision';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí nenalezeno');
  END IF;
  IF v_rozhodnuti.action <> 'workflow.runs_closed_by_decision' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('typ rozhodnutí %s zatím vrátit neumím', v_rozhodnuti.action));
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_journal
              WHERE action = 'workflow.decision_reverted' AND entity_id = p_decision_id::text) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rozhodnutí už bylo vráceno');
  END IF;

  SELECT count(*) FILTER (WHERE s.status = 'completed'
                            AND s.output_data->>'decision_id' = p_decision_id::text
                            AND s.output_data->>'uzavreno_rozhodnutim' = 'true'),
         count(*) FILTER (WHERE NOT (s.status = 'completed'
                            AND coalesce(s.output_data->>'decision_id', '') = p_decision_id::text
                            AND coalesce(s.output_data->>'uzavreno_rozhodnutim', '') = 'true'))
    INTO v_obnoveno, v_zmenene
    FROM public.production_workflow_steps s
   WHERE s.id IN (SELECT (jsonb_array_elements_text(v_rozhodnuti.details->'uzly'))::uuid);

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'decision_id', p_decision_id,
                              'akce', v_rozhodnuti.action, 'obnoveno', v_obnoveno,
                              'preskoceno_zmenene', v_zmenene, 'taktu_otevreno', jsonb_array_length(coalesce(v_rozhodnuti.details->'takty', '[]'::jsonb)));
  END IF;

  UPDATE public.production_workflow_steps s
     SET status = 'pending',
         completed_at = NULL,
         output_data = nullif(s.output_data->'pred_uzavrenim', '{}'::jsonb),
         updated_at = now()
   WHERE s.id IN (SELECT (jsonb_array_elements_text(v_rozhodnuti.details->'uzly'))::uuid)
     AND s.status = 'completed'
     AND s.output_data->>'decision_id' = p_decision_id::text
     AND s.output_data->>'uzavreno_rozhodnutim' = 'true';
  GET DIAGNOSTICS v_obnoveno = ROW_COUNT;

  -- Takty: znovu se otevřou PRÁVĚ ty, které rozhodnutí zrušilo (id v rozhodnutí),
  -- a jen pokud jsou pořád v jeho stavu. Nové takty se nezakládají — vrácení má
  -- obnovit stav před rozhodnutím, ne vyrobit dluh, který tu předtím nebyl
  -- (naměřeno: staré běhy takty neměly a otevření nových by je vytáhlo do front).
  UPDATE public.story_pulse_beats pb
     SET status = 'open', closed_at = NULL, closed_by = NULL, updated_at = now()
   WHERE pb.id IN (SELECT (jsonb_array_elements_text(coalesce(v_rozhodnuti.details->'takty', '[]'::jsonb)))::uuid)
     AND pb.status = 'cancelled';
  GET DIAGNOSTICS v_taktu = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details)
  VALUES (auth.uid(), 'workflow.decision_reverted', 'update', 'workflow',
          'workflow_decision_revert', p_decision_id::text,
          format('Vráceno rozhodnutí %s: obnoveno %s uzlů — %s', p_decision_id, v_obnoveno, p_reason),
          jsonb_build_object('decision_id', p_decision_id, 'akce', v_rozhodnuti.action,
                             'obnoveno', v_obnoveno, 'preskoceno_zmenene', v_zmenene,
                             'taktu_otevreno', v_taktu, 'duvod', p_reason));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', p_decision_id,
                            'akce', v_rozhodnuti.action, 'obnoveno', v_obnoveno,
                            'preskoceno_zmenene', v_zmenene, 'taktu_otevreno', v_taktu);
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_workflow_decision_admin(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_workflow_decision_admin(uuid, text, boolean) TO authenticated, service_role;
