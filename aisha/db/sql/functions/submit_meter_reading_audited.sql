-- ============================================================================
-- Source of Truth: submit_meter_reading_audited
-- Popis: Terénní odečet měřidla — hodnota POTVRZENÁ tím, kdo ji pořizuje,
--        zapsaná jako pozorování k twinu MĚŘIDLA + dokončení milníku úkolu.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================
--
-- ⭐ HODNOTA JDE S POTVRZENÍM, NE PO NĚM (zadání majitele 2026-08-05).
-- Appka na místě z fotky hodnotu VYČTE, ukáže ji člověku a ten ji potvrdí nebo
-- opraví. Odesílá se tedy HODNOTA, ne úkol vyčíst ji později. Stroj pomáhá,
-- ale **validace zůstává na tom, kdo pořizuje**: `p_value` je povinné a není tu
-- žádná větev „hodnota bude doplněna dodatečně“.
--
-- ⚠️ PŘEPSÁNO 2026-08-05 — předchozí verze (regenerát z 07-25) dělala PRAVÝ OPAK
-- a je poučné, v čem:
--   · zapisovala `attrs.verification = 'pending'`, tedy hodnotu jako NÁVRH
--     čekající na ratifikaci. Tím se potvrzení pořizovatele měnilo v doporučení
--     a odečet ve dvoukolové schvalování tam, kde stačí jeden člověk u měřidla;
--   · věšela událost na OBJEKT (lokalitu) nebo nájemce a měřidlo nesla jen jako
--     `attrs.meter_ref` — tedy text. Historie konkrétního měřidla se z toho
--     číst nedala, přestože měřidla jsou twins (`entity_type='meter'`, 63 v
--     produkci);
--   · identifikovala přes `label` (`WHERE label = p_object_label LIMIT 1`), což
--     je vyhledávání podle jména, ne podle identity;
--   · autorizovala `is_service_role() OR is_admin_or_staff() OR v_uid IS NOT NULL`
--     — poslední člen znamená „kdokoli přihlášený“, takže to nebyla kontrola.
-- Nikdo ji nevolal (jen generované typy), takže se přepisuje, ne obchází.
--
-- ⭐ MĚŘIDLO NENÍ ZVLÁŠTNÍ DRUH DAT, jen zvláštní ZPŮSOB VSTUPU.
-- Hodnota z HomeAssistantu, z T-CARS, od našeho člověka s appkou i od nájemníka
-- s fotkou — všechno je totéž pozorování k téže entitě. Liší se `source` (kanál)
-- a kdo za údaj ručí. Proto `twin_events` vedle telemetrie a NE vlastní tabulka:
-- nové silo = druhá pravda o téže veličině a graf „stav v čase“ ze dvou míst.
--
-- FOTO JE VOLITELNÉ. Doklad je užitečný (dá se zpětně ověřit, jestli se
-- odečítač nespletl), ale odečet na něm nestojí — hodnotu potvrdil člověk.
-- Když foto je, nese se jako REFERENCE na objekt v MinIO (nahraný přes
-- create_entity_evidence_preflight_audited), nikdy jako obsah.
--
-- ⚠️ NÁROK PLYNE Z PRÁCE, ne z role. `twin_record_events_audited` vyžaduje
-- admin/staff/service (je to dávkový zapisovatel pro adaptéry), takže odečítač
-- v terénu do něj nedosáhne. Tady autorizuje TÝŽ predikát jako dokončení
-- milníku: kdo má na to měřidlo otevřený úkol, ten smí zapsat odečet.
-- Oprávnění vzniká i zaniká s úkolem, bez zvláštní role a bez správy seznamu.

CREATE OR REPLACE FUNCTION public.submit_meter_reading_audited(
  p_step_id     uuid,
  p_value       numeric,
  p_note        text        DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_photo_key   text        DEFAULT NULL,
  -- Co appka vyčetla, NEŽ to člověk potvrdil. Drží se jen jako stopa kvality
  -- čtečky (jak často se strojní návrh liší od potvrzené hodnoty); autoritou
  -- je vždy `p_value`.
  p_suggested   numeric     DEFAULT NULL,
  p_unit        text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_twin_id  uuid;
  v_batch_id uuid;
  v_story_id uuid;
  v_at       timestamptz := coalesce(p_occurred_at, now());
  v_event_id uuid;
  v_step     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Odečet bez čísla není odečet, je to jen návštěva.
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'reading value is required — a confirmed reading is the point'
      USING ERRCODE = '22023';
  END IF;

  -- Nárok z práce (viz hlavička) — týž sdílený predikát jako dokončení milníku.
  SELECT s.batch_id, (s.input_data->>'subject_twin_id')::uuid
    INTO v_batch_id, v_twin_id
    FROM public.production_workflow_steps s
   WHERE s.id = p_step_id
     AND public.workflow_step_visible_to(v_uid, s.assigned_user_id, s.assigned_role, s.input_data);

  IF v_batch_id IS NULL THEN
    -- Nerozlišuje se „neexistuje“ od „nesmíš“, jinak by šel krok vyzkoušet.
    RAISE EXCEPTION 'workflow step not found or not visible' USING ERRCODE = '42501';
  END IF;

  IF v_twin_id IS NULL THEN
    RAISE EXCEPTION 'step % has no subject_twin_id — a reading needs the meter it belongs to', p_step_id
      USING ERRCODE = '22023';
  END IF;

  SELECT b.story_id INTO v_story_id FROM public.production_batches b WHERE b.id = v_batch_id;

  -- ── Pozorování k twinu MĚŘIDLA ────────────────────────────────────────────
  -- `source_ref` = krok, takže opakované odeslání téhož odečtu (retry z offline
  -- fronty na mizerné síti) hodnotu AKTUALIZUJE místo aby vyrobilo druhý údaj
  -- o témže odečtu. Idempotence stojí na kroku, nikdy na čase.
  --
  -- ⚠️ `ON CONFLICT` opakuje i predikát: uq_twin_events_source_ref je PARTIÁLNÍ
  -- index (`WHERE source_ref IS NOT NULL`) a bez shodné podmínky by Postgres
  -- arbitr nenašel a příkaz spadl až za běhu (42P10).
  INSERT INTO public.twin_events
    (event_type, twin_id, story_id, occurred_at, attrs, source, source_ref)
  VALUES ('meter_reading', v_twin_id, v_story_id, v_at,
          jsonb_strip_nulls(jsonb_build_object(
            'value',        p_value,
            'unit',         p_unit,
            -- Kdo za údaj RUČÍ. U IoT by tu byl adaptér, tady člověk — a to je
            -- celý rozdíl mezi kanály, ne jiný datový tvar.
            'confirmed_by', v_uid::text,
            'suggested',    p_suggested,
            'photo_key',    p_photo_key,
            'note',         p_note,
            'step_id',      p_step_id::text)),
          'field-reading', p_step_id::text)
  ON CONFLICT (source, event_type, source_ref) WHERE source_ref IS NOT NULL DO UPDATE
    SET attrs = excluded.attrs, occurred_at = excluded.occurred_at
  RETURNING public.twin_events.id INTO v_event_id;

  -- ── Milník ────────────────────────────────────────────────────────────────
  -- Dokončení je součástí TÉHOŽ úkonu: člověk u měřidla potvrdil hodnotu, tím
  -- je odečet hotový. Nechat krok otevřený by znamenalo, že se čeká na někoho
  -- dalšího — a na nikoho dalšího se nečeká.
  v_step := public.complete_workflow_step(
    p_step_id     => p_step_id,
    p_output_data => jsonb_strip_nulls(jsonb_build_object(
                       'value', p_value, 'unit', p_unit,
                       'via', 'field_reading', 'event_id', v_event_id::text)),
    p_notes       => p_note,
    p_occurred_at => v_at);

  IF NOT coalesce((v_step->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'milestone not completed: %', coalesce(v_step->>'error', 'unknown')
      USING ERRCODE = '42501';
  END IF;

  -- Audit nese FAKT a hodnotu, nikdy obrázek (ten žije v MinIO pod klíčem).
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_uid, 'METER_READING_SUBMITTED',
          jsonb_build_object('twin_id', v_twin_id, 'value', p_value, 'unit', p_unit,
                             'step_id', p_step_id, 'has_photo', p_photo_key IS NOT NULL,
                             'suggested_differs', p_suggested IS NOT NULL AND p_suggested <> p_value));

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'value', p_value, 'step', v_step);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_meter_reading_audited(uuid,numeric,text,timestamptz,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_meter_reading_audited(uuid,numeric,text,timestamptz,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_meter_reading_audited(uuid,numeric,text,timestamptz,text,numeric,text) TO service_role;

-- ⚠️ Starý TEXTOVÝ podpis musí zmizet, jinak by vedle nové funkce žil dál a
-- volání by mohlo trefit tu starou (zapisuje `verification:'pending'` na objekt
-- místo potvrzené hodnoty na měřidlo). DROP ale NEPATŘÍ SEM, nýbrž do heals.sql
-- — viz tamní blok. Důvod je provozní: SoT soubor se přehrává při KAŽDÉM
-- migrate, takže DROP v něm by se pokoušel padnout pokaždé, a na běžící DB na
-- funkci můžou viset policies/views („cannot drop function … because other
-- objects depend on it" — u is_admin_or_staff to bylo 253 policies).
-- Hlídá to brána rls-predikat-a-indexy.
