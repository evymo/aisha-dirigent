-- ============================================================================
-- Source of Truth: close_stale_workflow_runs_admin
-- Popis: Uzavře ZASTARALÉ běhy procesu ROZHODNUTÍM ČLOVĚKA (správce/majitele):
--        všechny jejich čekající uzly, s důvodem a stopou původu, bez odměn.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⛔ PROČ VZNIKLA. Naměřeno 2026-09-15 v produkci instance: 126 běhů expedice
--    z let 2020–2024 viselo s čekajícím předáním BEZ řidiče (a s čekající
--    nakládkou i přepravou). Účetnictví je neuzavřelo (settled False nebo
--    chybí), takže reconcile_workflow_from_documents je z principu nezavře —
--    a správně: chybějící údaj není „uzavřeno". Uzavřít je může jen ČLOVĚK,
--    a majitel to rozhodl. Ruční UPDATE by nenechal stopu, proč a kdo.
--
-- ⭐ ROZHODNUTÍ ≠ DOKONČENÍ. Uzel dostane status 'completed' (jediné dva stavy,
--    kterým konzumenti rozumějí jako „už se nečeká", jsou completed/failed;
--    failed znamená odchylku při výkonu a spouští nudge), ALE output_data nese
--    `outcome: 'cancelled'` — týž význam, jaký complete_workflow_step dává
--    zrušenému taktu — a `uzavreno_rozhodnutim` s důvodem, kdo a kdy. Otevřené
--    takty uzlů se uzavřou jako 'cancelled'. ODMĚNA SE NEPŘIPISUJE: nikdo
--    práci nevykonal. Sourozenec `uzavreno_srovnanim` (reconcile) tak zůstane
--    odlišitelný.
--
-- ⛔ KRITÉRIUM JE VÝSLOVNÉ, NE „STARÉ VĚCI". Šablona + datum běhu PŘED hranicí
--    + uzel, který je čekající a NIKOMU nepřiřazený (bez authorized_twin_id
--    i assigned_user_id). Běh, jehož práci má konkrétní člověk, se touto cestou
--    nezavře — to by bylo rozhodnutí o jeho práci, ne o zapomenutém záznamu.
--    Uzavírají se VŠECHNY čekající uzly takového běhu: nechat nakládku
--    a přepravu viset v rolových frontách by znamenalo polovinu rozhodnutí.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true): vrátí počty běhů, uzlů a taktů,
--    nic nezapíše.
--
-- ⭐ DOHLEDATELNÉ A VRATNÉ (zadání majitele 2026-09-15: „všechny tyto autonomní
--    kroky potřebujeme umět dohledat, dohledovat a případně zrušit a opravit
--    uživatelem z UI"). Ostrý běh = JEDNO ROZHODNUTÍ: řádek audit_journal
--    (entity_type 'workflow_decision', id = decision_id) s kritériem, důvodem,
--    počty a seznamem uzlů; každý uzel nese decision_id a svůj stav PŘED
--    uzavřením (`pred_uzavrenim`). Vrácení dělá revert_workflow_decision_admin
--    podle decision_id, přehled get_workflow_decisions_admin.
--
-- Kontrakt: (text, date, text, text, boolean) ->
--   jsonb {ok, dry_run, decision_id?, behu, uzlu, taktu, kriterium} | {ok:false, error}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_stale_workflow_runs_admin(
  p_template_name     text,
  p_before            date,
  p_unbound_step_code text,
  p_reason            text,
  p_dry_run           boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_behu      integer;
  v_uzlu      integer := 0;
  v_taktu     integer := 0;
  v_kriterium jsonb;
  v_decision  uuid := gen_random_uuid();
  v_uzly      jsonb;
  v_takty     jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  END IF;
  IF coalesce(btrim(p_template_name), '') = '' OR p_before IS NULL
     OR coalesce(btrim(p_unbound_step_code), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'kritérium je povinné: p_template_name, p_before, p_unbound_step_code');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'důvod (p_reason) je povinný — rozhodnutí bez důvodu nejde doložit');
  END IF;
  IF p_before > current_date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_before nesmí být v budoucnosti');
  END IF;

  v_kriterium := jsonb_build_object('template_name', p_template_name, 'before', p_before,
                                    'unbound_step_code', p_unbound_step_code);

  CREATE TEMPORARY TABLE IF NOT EXISTS _stare_behy (batch_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _stare_behy;
  INSERT INTO _stare_behy (batch_id)
  SELECT DISTINCT b.id
    FROM public.production_batches b
    JOIN public.production_workflow_templates w ON w.id = b.workflow_template_id
    JOIN public.production_workflow_steps s ON s.batch_id = b.id
   WHERE w.name = p_template_name
     AND b.production_date < p_before
     AND s.step_code = p_unbound_step_code
     AND s.status = 'pending'
     AND coalesce(s.input_data->>'authorized_twin_id', '') = ''
     AND s.assigned_user_id IS NULL;
  GET DIAGNOSTICS v_behu = ROW_COUNT;

  IF p_dry_run THEN
    SELECT count(*) INTO v_uzlu
      FROM public.production_workflow_steps s JOIN _stare_behy x ON x.batch_id = s.batch_id
     WHERE s.status = 'pending';
    SELECT count(*) INTO v_taktu
      FROM public.story_pulse_beats pb
      JOIN public.production_workflow_steps s ON pb.source_type = 'workflow_step' AND pb.source_id = s.id
      JOIN _stare_behy x ON x.batch_id = s.batch_id
     WHERE pb.status = 'open';
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'behu', v_behu, 'uzlu', v_uzlu,
                              'taktu', v_taktu, 'kriterium', v_kriterium);
  END IF;

  WITH zrusene AS (
    UPDATE public.story_pulse_beats pb
       SET status = 'cancelled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
      FROM public.production_workflow_steps s
      JOIN _stare_behy x ON x.batch_id = s.batch_id
     WHERE pb.source_type = 'workflow_step' AND pb.source_id = s.id AND pb.status = 'open'
    RETURNING pb.id
  )
  -- id taktů jdou do rozhodnutí: vrácení otevře PRÁVĚ tyhle, ne nové
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) INTO v_taktu, v_takty FROM zrusene;

  WITH zavrene AS (
    UPDATE public.production_workflow_steps s
       SET status = 'completed',
           completed_at = now(),
           -- Stav PŘED uzavřením jde s sebou celý: vrácení ho obnoví přesně,
           -- ne odhadem, které klíče sem kdo přidal.
           output_data = jsonb_build_object('outcome', 'cancelled',
                                            'uzavreno_rozhodnutim', true,
                                            'decision_id', v_decision,
                                            'duvod', p_reason,
                                            'kdo', auth.uid(),
                                            'kdy', now(),
                                            'kriterium', v_kriterium,
                                            'pred_uzavrenim', coalesce(s.output_data, '{}'::jsonb)),
           updated_at = now()
      FROM _stare_behy x
     WHERE x.batch_id = s.batch_id AND s.status = 'pending'
    RETURNING s.id
  )
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) INTO v_uzlu, v_uzly FROM zavrene;

  INSERT INTO public.audit_journal (id, user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details, metadata)
  VALUES (v_decision, auth.uid(), 'workflow.runs_closed_by_decision', 'update', 'workflow',
          'workflow_decision', v_decision::text,
          format('Uzavřeno rozhodnutím: %s běhů, %s uzlů (%s) — %s', v_behu, v_uzlu, p_template_name, p_reason),
          jsonb_build_object('behu', v_behu, 'uzlu', v_uzlu, 'taktu', v_taktu, 'duvod', p_reason,
                             'kriterium', v_kriterium, 'uzly', v_uzly, 'takty', v_takty, 'vratne', true),
          jsonb_build_object('behu', v_behu, 'uzlu', v_uzlu, 'taktu', v_taktu, 'kriterium', v_kriterium));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', v_decision, 'behu', v_behu,
                            'uzlu', v_uzlu, 'taktu', v_taktu, 'kriterium', v_kriterium);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_stale_workflow_runs_admin(text, date, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_workflow_runs_admin(text, date, text, text, boolean) TO authenticated, service_role;
