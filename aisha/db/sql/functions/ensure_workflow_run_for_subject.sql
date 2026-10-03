-- ============================================================================
-- Source of Truth: ensure_workflow_run_for_subject
-- Popis: Otevře běh procesu pro JEDEN předmět (doklad, objednávka, zakázka —
--        cokoli, o čem ten běh je) a přiřadí jeho lidské uzly konkrétním lidem.
--        Idempotentní podle p_run_code.
--
-- PROČ VZNIKLA: tři RPC, které běh potřebuje, existovaly, ale NIKDO je nevolal —
-- grep přes celý strom vracel jen definice a generované typy. Batch bez
-- materializace nemá jediný krok, batch bez story spolkne celou naraci mlčky
-- (v complete_workflow_step je narace i goal re-evaluace pod `if story_id is not
-- null`). Chybějící sloveso, ne chybějící mašinerie.
--
-- PROČ NE create_production_batch_admin: guard má `is_admin_or_staff(auth.uid())`
-- a GRANT jen pro authenticated, takže lane běžící jako service_role jím batch
-- nezaloží. Navíc castuje `p_purpose::batch_purpose` bez ošetření NULL a ten
-- enum má jen study/retail/sample/internal_testing — pro dodávku tam není
-- sémanticky správná hodnota. Zakládá se proto přímo, pod vlastní autorizací.
--
-- IDEMPOTENCE JE POVINNÁ, ne pohodlí: `batch_code` nemá unique ani index, takže
-- dvojí spuštění lane pro tentýž doklad by tiše vyrobilo DVA běhy a dvě sady
-- kroků — a řidič by tutéž dodávku potvrzoval dvakrát. Existující běh se proto
-- vrací beze změny.
--
-- PŘIŘAZENÍ UZLŮ (p_node_bindings) je to, kvůli čemu tahle funkce hlavně je.
-- Šablona je sdílená, ale KDO tenhle konkrétní běh veze, je vlastnost běhu.
-- Materializer bere assigned_user_id z uzlu šablony, takže per-běh se to jinak
-- doplnit nedá. Zapisuje se do input_data, odkud to čte sdílený predikát
-- workflow_step_visible_to.
--   ⚠️ Uzel, který má `assigned_role`, uvidí KAŽDÝ držitel té role — predikát
--   vyhodnocuje roli PŘED vazbou a při shodě rovnou vrací true. Kdo chce „jen
--   svoje řádky", musí mít uzel BEZ role a s authorized_twin_id.
--
-- authorized_twin_ref → authorized_twin_id (překlad na vstupu): deklarant běhu
-- (ingest bundle) platformní UUID twinu nezná z podstaty — smí proto poslat
-- REFERENCI {entity_type, source, source_key, label?} a překlad se udělá tady,
-- přes twin_upsert_entity_audited (idempotentní mint-or-match na potvrzené
-- primární identitě zdroje; auditovaný). Táž (source, source_key) identita,
-- jakou navrhuje twin-producer z entity profilů → obě lane konvergují na TÝŽ
-- twin. Viditelnost tím NEvzniká: workflow_step_visible_to pustí jen účet
-- s POTVRZENOU vazbou ref_kind='account' na ten twin — ratifikace zůstává
-- člověku, mint dopředu je bezpečný (do potvrzení uzel nevidí nikdo mimo
-- admin/staff). Metadata twinu se při překladu NEposílají (NULL): UPDATE větev
-- twin_upsertu by jimi PŘEPSALA evidenci, kterou twin nese z profilové lane.
-- Překlad běží PŘED založením batche: vadná reference odmítne CELÝ běh, nikdy
-- nevznikne půlka změny (běh bez vazby, který by idempotence už nikdy nedovázala).
--
-- p_subject se vlévá do input_data VŠECH uzlů: je to popis téhož předmětu a
-- povrch si z něj bere sloupce (`input:<cesta>`), ať už stojí u kteréhokoli
-- milníku. Klíče z p_subject NIKDY nepřepíší klíče uzlu — konfigurace procesu
-- má přednost před daty jedné instance běhu.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_workflow_run_for_subject(
  p_template_name  text,
  p_run_code       text,
  p_subject_label  text    DEFAULT NULL,
  p_due_date       date    DEFAULT NULL,
  p_subject        jsonb   DEFAULT '{}'::jsonb,
  p_node_bindings  jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_template_id uuid;
  v_first_step  uuid;
  v_first_beat  uuid;
  v_batch_id    uuid;
  v_existing    uuid;
  v_steps       jsonb;
  v_story       jsonb;
  v_bound       int := 0;
  v_bindings    jsonb := coalesce(p_node_bindings, '{}'::jsonb);
  v_step_code   text;
  v_binding     jsonb;
  v_ref         jsonb;
  v_ref_bad     text;
  v_twin        jsonb;
  v_resolved    int := 0;
BEGIN
  IF NOT (public.is_admin_or_staff(auth.uid()) OR public.is_service_role()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin, staff or service role required');
  END IF;

  IF coalesce(btrim(p_run_code), '') = '' THEN
    -- Bez kódu není idempotence, a bez idempotence vzniknou duplicitní běhy.
    RETURN jsonb_build_object('ok', false, 'error', 'p_run_code is required (idempotence key)');
  END IF;

  -- Překlad referencí PŘED vším ostatním (viz hlavička: žádná půlka změny).
  FOR v_step_code, v_binding IN SELECT key, value FROM jsonb_each(v_bindings) LOOP
    CONTINUE WHEN NOT (v_binding ? 'authorized_twin_ref');
    v_ref := v_binding->'authorized_twin_ref';

    -- Uzavřená množina klíčů + povinné hodnoty: reference s překlepem se odmítá,
    -- nikdy tiše neignoruje (jinak by běh vypadal otevřený a vazba by chyběla).
    SELECT string_agg(k, ', ') INTO v_ref_bad
    FROM jsonb_object_keys(v_ref) AS k
    WHERE k NOT IN ('entity_type', 'source', 'source_key', 'label');
    IF v_ref_bad IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('node %L: unknown authorized_twin_ref keys: %s', v_step_code, v_ref_bad));
    END IF;
    IF coalesce(btrim(v_ref->>'entity_type'), '') = ''
       OR coalesce(btrim(v_ref->>'source'), '') = ''
       OR coalesce(btrim(v_ref->>'source_key'), '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('node %L: authorized_twin_ref requires entity_type, source, source_key',
               v_step_code));
    END IF;

    -- Twin identity vrstva je VOLITELNÝ subsystém (viz workflow_step_visible_to):
    -- bez ní se reference nedá přeložit a mlčky ji zahodit nesmíme.
    IF to_regprocedure('public.twin_upsert_entity_audited(text,text,text,text,text,jsonb)')
       IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('node %L: authorized_twin_ref given but the twin identity layer '
               || 'is not installed', v_step_code));
    END IF;

    -- Mint-or-match; metadata NULL (nepřepsat evidenci profilové lane), status NULL.
    EXECUTE 'SELECT public.twin_upsert_entity_audited($1, $2, $3, $4, NULL, NULL)'
    INTO v_twin
    USING v_ref->>'entity_type', v_ref->>'source', v_ref->>'source_key',
          nullif(btrim(coalesce(v_ref->>'label', '')), '');

    v_bindings := jsonb_set(
      v_bindings, ARRAY[v_step_code],
      (v_binding - 'authorized_twin_ref')
        || jsonb_build_object('authorized_twin_id', v_twin->>'twin_id'));
    v_resolved := v_resolved + 1;
  END LOOP;

  SELECT id INTO v_template_id
  FROM public.production_workflow_templates
  WHERE name = p_template_name AND coalesce(is_active, true)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', format('no active template named %L', p_template_name));
  END IF;

  -- Už otevřený? Běh se NEOTEVÍRÁ podruhé (idempotence, viz hlavička), ale
  -- POPIS PŘEDMĚTU se obnoví. `subject` je evidence O DOKLADU (číslo, protistrana,
  -- adresa, řidič, vozidlo), ne provozní stav běhu — a doklad se dozvídáme po
  -- částech: 20 213 běhů expedice vzniklo z podmnožiny polí a řidiče se SPZ
  -- (12 212 / 11 319 dokladů v registru) by beze změny nikdy nespatřily, protože
  -- ta větev vracela metadata nedotčená. Čerstvější čtení dokladu tedy popis
  -- doplní; kdo už běh potvrzuje, tím není dotčen.
  --
  -- Slévá se JEN klíč `subject` (`||` nad celým metadata by sebral evidenci
  -- ostatních lane) a jen když volající nějaký předmět poslal — prázdný vstup
  -- nesmí popis vymazat.
  SELECT id INTO v_existing FROM public.production_batches WHERE batch_code = p_run_code LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF p_subject IS NOT NULL AND jsonb_typeof(p_subject) = 'object'
       AND p_subject <> '{}'::jsonb THEN
      UPDATE public.production_batches
         SET metadata = coalesce(metadata, '{}'::jsonb)
                        || jsonb_build_object('subject',
                             coalesce(metadata->'subject', '{}'::jsonb) || p_subject),
             updated_at = now()
       WHERE id = v_existing;

      -- …a TAM, ODKUD SE ČTE. Metadata dávky jsou evidence; povrchy (fronta
      -- předání, dispečink) berou hodnoty z `input_data` KROKU, kam se předmět
      -- vlévá při zakládání běhu. Bez tohohle UPDATE by obnova skončila v místě,
      -- kam se nikdo nedívá: naměřeno 2026-07-30 — 12 211 dávek mělo řidiče
      -- v metadatech a dispečink jich zobrazil NULA.
      --
      -- Pořadí slučování je TOTOŽNÉ se zakládáním (p_subject || input_data):
      -- předmět je základ, konfigurace uzlu ho přebíjí. Doplní se tedy klíče,
      -- které krok ještě nemá, a nic existujícího se nepřepíše — ani ruční
      -- úprava, ani vazbou přiřazený uzel.
      UPDATE public.production_workflow_steps s
         SET input_data = p_subject || coalesce(s.input_data, '{}'::jsonb),
             updated_at = now()
       WHERE s.batch_id = v_existing
         AND NOT (coalesce(s.input_data, '{}'::jsonb) @> p_subject);

      RETURN jsonb_build_object('ok', true, 'already_open', true, 'subject_refreshed', true,
                                'batch_id', v_existing, 'run_code', p_run_code);
    END IF;
    RETURN jsonb_build_object('ok', true, 'already_open', true,
                              'batch_id', v_existing, 'run_code', p_run_code);
  END IF;

  INSERT INTO public.production_batches
    (batch_code, product_name, production_date, workflow_template_id, status, metadata, created_by)
  VALUES
    (p_run_code, p_subject_label, p_due_date, v_template_id, 'planned',
     jsonb_build_object('subject', coalesce(p_subject, '{}'::jsonb)), auth.uid())
  RETURNING id INTO v_batch_id;

  -- Story PŘED materializací: complete_workflow_step přeskočí naraci i goal
  -- re-evaluaci mlčky, když batch story nemá, a doplnit ji zpětně by znamenalo
  -- běh, jehož první milníky se nikam nezapsaly.
  v_story := public.ensure_production_batch_story(v_batch_id, NULL, p_subject_label);

  v_steps := public.create_production_workflow_steps_from_template(v_batch_id);
  IF NOT coalesce((v_steps->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', coalesce(v_steps->>'error', 'materialization failed'),
                              'batch_id', v_batch_id);
  END IF;

  -- Předmět do všech uzlů + per-uzel přiřazení. `||` má vpravo přednost, proto
  -- se p_subject aplikuje ZLEVA: konfigurace uzlu přebije data běhu.
  -- (v_bindings = p_node_bindings s referencemi přeloženými na authorized_twin_id.)
  UPDATE public.production_workflow_steps s
     SET input_data = coalesce(p_subject, '{}'::jsonb)
                      || coalesce(s.input_data, '{}'::jsonb)
                      || coalesce(v_bindings->s.step_code, '{}'::jsonb),
         assigned_user_id = coalesce(
           nullif(v_bindings->s.step_code->>'assigned_user_id', '')::uuid,
           s.assigned_user_id),
         -- Vazbou přiřazený uzel ROLI ZTRÁCÍ. Jinak by ji predikát vyhodnotil
         -- dřív a pustil k němu každého držitele té role — čímž by přiřazení
         -- konkrétnímu člověku nezúžilo vůbec nic.
         assigned_role = CASE
           WHEN v_bindings->s.step_code ? 'authorized_twin_id' THEN NULL
           ELSE s.assigned_role END,
         updated_at = now()
   WHERE s.batch_id = v_batch_id
     AND (p_subject <> '{}'::jsonb OR v_bindings ? s.step_code);
  GET DIAGNOSTICS v_bound = ROW_COUNT;

  -- ── twin puls (ADR-003 K2): první lidský uzel dluží hned od otevření běhu ──
  -- Kloub workflow_step_open_beat vrací NULL pro strojový uzel nebo běh bez
  -- subjektu; selhání kloubu nesmí shodit založený běh (Z7) — zapíše se.
  BEGIN
    SELECT s.id INTO v_first_step
      FROM public.production_workflow_steps s
     WHERE s.batch_id = v_batch_id AND s.status = 'pending'
     ORDER BY s.step_order, s.created_at
     LIMIT 1;
    IF v_first_step IS NOT NULL THEN
      v_first_beat := public.workflow_step_open_beat(v_first_step);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'workflow.beat_joint_failed',
            jsonb_build_object('batch_id', v_batch_id, 'error', SQLERRM));
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'run_code', p_run_code,
    'story_id', v_story->>'story_id',
    'steps_created', v_steps->>'created',
    'steps_bound', v_bound,
    'twin_refs_resolved', v_resolved,
    'first_beat_id', v_first_beat);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_workflow_run_for_subject(text, text, text, date, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_workflow_run_for_subject(text, text, text, date, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_workflow_run_for_subject(text, text, text, date, jsonb, jsonb) TO authenticated;
