-- ============================================================================
-- Source of Truth: create_entity_evidence_preflight_audited
-- Popis: Preflight fotografické evidence POŘÍZENÉ V TERÉNU — autorizuje upload
--        a zaregistruje snímek jako UDÁLOST K ENTITĚ (twin_events).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================
--
-- JEDNA DRÁHA, DVĚ POUŽITÍ. Řidič u sklopky vyfotí předání; správce vyfotí
-- elektroměr na zdi. Akvizice je TÁŽ (telefon → MinIO → záznam), liší se jen
-- entita, ke které snímek patří, a kdo na ni má nárok. Proto tu není „foto
-- předání" a vedle „foto měřidla", ale jedno RPC s dispatchem — druhá kopie by
-- se rozešla při první změně a měřidla by zůstala o opravu pozadu.
--
-- PROČ twin_events A NE NOVÁ TABULKA: snímek je informace K ENTITĚ, a přesně to
-- twin_events jsou („místo setkání plán × skutečnost × doklad", append-only).
-- `event_type` je volný slug (slovník je doménová volba), `attrs` unese odkaz na
-- objekt a dvojice (source, source_ref) dává idempotenci zdarma. Nové silo by
-- znamenalo druhou pravdu o tomtéž a majitel ho pro odečty výslovně odmítl.
--
-- IDEMPOTENCE JE OBJEKTOVÝ KLÍČ, NE ČAS. `source_ref = p_file_path`, a ten je
-- v object key vyrobený z uuid — týž preflight zavolaný dvakrát (retry na
-- mizerné síti v lomu) proto nezaloží druhou událost. Kdyby klíčem byl čas,
-- každý retry by vyrobil nový „doklad" o téže fotce.
--
-- OBRÁZEK SE SEM NEDOSTANE. Ukládá se REFERENCE (bucket, klíč, velikost, typ);
-- binárka žije v MinIO. Jsonb není úložiště souborů — TOASTovaná fotka v řádku,
-- který čte fronta při každém načtení, je jistá cesta k pomalé ploše.
--
-- ⚠️ NÁROK NENÍ „PŘIHLÁŠENÝ". Kdo smí fotit, se ptá TÉŽE autority jako kdo smí
-- krok dokončit — sdíleného predikátu workflow_step_visible_to. Kdyby tu stála
-- vlastní kopie pravidla, rozešla by se s ním a řidič by směl fotit k běhu,
-- který nesmí ani vidět.
--
-- ⛔ KROK BEZ TWIN VAZBY FOTIT NELZE, a je to VĚDOMÁ hranice, ne opomenutí:
-- událost musí vědět, KOHO/ČEHO se týká. Uzel řízený rolí (naložení, přeprava)
-- takovou vazbu nemá; dosadit twin „nějak" by znamenalo vyrobit doklad o entitě,
-- kterou nikdo neurčil. Funkce to proto řekne nahlas místo tichého uložení
-- vedle. Rozšíření = dát uzlu vazbu v šabloně, ne změkčit tuhle podmínku.

CREATE OR REPLACE FUNCTION public.create_entity_evidence_preflight_audited(
  p_file_path   text,
  p_file_name   text,
  p_file_size   integer,
  p_mime_type   text,
  p_entity_kind text,
  p_entity_id   uuid,
  p_slot        text DEFAULT NULL
)
RETURNS TABLE(id uuid, file_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_twin_id       uuid;
  v_actor_twin_id uuid;
  v_story_id      uuid;
  v_batch_id      uuid;
  v_event_id      uuid;
  v_attrs         jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Cesta musí patřit volajícímu. Táž konvence jako u zdravotních dokumentů:
  -- object key začíná uid, takže podvržená cesta do cizí složky neprojde.
  IF p_file_path IS NULL OR p_file_path NOT LIKE v_uid::text || '/%' THEN
    RAISE EXCEPTION 'Invalid file path' USING ERRCODE = '22023';
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 THEN
    RAISE EXCEPTION 'file size must be positive' USING ERRCODE = '22023';
  END IF;

  -- Jen obrázky. Velikost a MIME hlídá i brána storage-auth; tady se to opakuje
  -- proto, že RPC je grantnuté `authenticated` a dá se zavolat i mimo ni.
  IF p_mime_type IS NULL OR p_mime_type NOT LIKE 'image/%' THEN
    RAISE EXCEPTION 'evidence must be an image (got %)', coalesce(p_mime_type, '<null>')
      USING ERRCODE = '22023';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity id is required' USING ERRCODE = '22023';
  END IF;

  -- ── Dispatch podle druhu entity ────────────────────────────────────────────
  -- Uzavřená množina a neznámý druh RAISE. Fail-closed: druh, kterému nerozumíme,
  -- nesmí skončit uložený, jako bychom mu rozuměli.
  IF p_entity_kind = 'workflow_step' THEN
    SELECT s.batch_id,
           -- KOMU UDÁLOST PATŘÍ: tomu, ČEHO se týká (subjekt běhu), a teprve
           -- když subjekt není znám, tomu, KDO ji pořídil. Není to fallback,
           -- ale deklarované pořadí: u odečtu je subjektem měřidlo a událost
           -- patří jemu, u předání zná uzel jen oprávněnou osobu. Kdyby foto
           -- měřidla viselo na odečítači, historie měřidla by ho neobsahovala —
           -- a právě ta je smyslem časové řady k entitě.
           coalesce((s.input_data->>'subject_twin_id')::uuid,
                    (s.input_data->>'authorized_twin_id')::uuid),
           (s.input_data->>'authorized_twin_id')::uuid
      INTO v_batch_id, v_twin_id, v_actor_twin_id
      FROM public.production_workflow_steps s
     WHERE s.id = p_entity_id
       -- TÁŽ autorita jako u dokončení kroku — žádná inline kopie pravidla.
       AND public.workflow_step_visible_to(v_uid, s.assigned_user_id, s.assigned_role, s.input_data);

    IF v_batch_id IS NULL THEN
      -- Nerozlišuje se „neexistuje" od „nesmíš": jinak by se dal existující krok
      -- vyzkoušet podle toho, která chyba přijde.
      RAISE EXCEPTION 'workflow step not found or not visible' USING ERRCODE = '42501';
    END IF;

    IF v_twin_id IS NULL THEN
      RAISE EXCEPTION 'step % has no subject_twin_id nor authorized_twin_id — evidence needs an entity to belong to', p_entity_id
        USING ERRCODE = '22023';
    END IF;

    SELECT b.story_id INTO v_story_id FROM public.production_batches b WHERE b.id = v_batch_id;

  ELSIF p_entity_kind = 'twin' THEN
    -- Odečet měřidla: entita JE twin (elektroměr, vodoměr).
    --
    -- ⛔ RLS TU NEPOMŮŽE. Tahle funkce je SECURITY DEFINER, takže čtení
    -- twin_entities běží s právy vlastníka a policy se NEUPLATNÍ — „SELECT
    -- vrátil řádek" by tedy neznamenalo „volající na něj má nárok", jen „twin
    -- existuje". Spoléhat se tu na RLS je klasická fail-open díra.
    --
    -- Nárok je proto výslovný a plyne z PRÁCE: fotit smíš to, na co máš otevřený
    -- úkol. To je přesně model odečtů — úkol s termínem říká, kdo kam má jít co
    -- změřit — a znamená, že oprávnění vzniká i zaniká s úkolem, bez zvláštní
    -- role a bez ruční správy seznamu.
    IF NOT (
      public.is_admin_or_staff()
      OR EXISTS (
           SELECT 1
             FROM public.production_workflow_steps s
            WHERE (s.input_data->>'subject_twin_id')::uuid = p_entity_id
              AND s.status NOT IN ('completed', 'failed')
              AND public.workflow_step_visible_to(v_uid, s.assigned_user_id, s.assigned_role, s.input_data)
         )
    ) THEN
      RAISE EXCEPTION 'twin not found or no open task authorizes capturing it' USING ERRCODE = '42501';
    END IF;

    SELECT t.id INTO v_twin_id FROM public.twin_entities t WHERE t.id = p_entity_id;
    IF v_twin_id IS NULL THEN
      RAISE EXCEPTION 'twin not found or no open task authorizes capturing it' USING ERRCODE = '42501';
    END IF;

  ELSE
    RAISE EXCEPTION 'unknown entity kind: % (allowed: workflow_step, twin)', coalesce(p_entity_kind, '<null>')
      USING ERRCODE = '22023';
  END IF;

  v_attrs := jsonb_strip_nulls(jsonb_build_object(
    'bucket',      'entity-evidence',
    'object_key',  p_file_path,
    'file_name',   p_file_name,
    'file_size',   p_file_size,
    'mime_type',   p_mime_type,
    'slot',        p_slot,
    'entity_kind', p_entity_kind,
    -- U kroku si událost drží i to, KTERÝ milník ji vyvolal; twin sám by řekl
    -- „patří k řidiči", ne „vznikla při tomhle předání".
    'step_id',     CASE WHEN p_entity_kind = 'workflow_step' THEN p_entity_id::text END,
    'captured_by', v_uid::text));

  -- occurred_at = TEĎ, protože preflight běží v okamžiku pořízení. Kdyby čas
  -- posílal klient, byl by to údaj od dokumentovaného o sobě samém.
  -- `related_twin_id` = kdo snímek pořídil, když se liší od subjektu. U odečtu
  -- tak zůstane u události měřidla i to, kdo tam byl — bez toho by časová řada
  -- entity věděla „co", ale ne „od koho".
  --
  -- ⚠️ `ON CONFLICT` musí opakovat i predikát: uq_twin_events_source_ref je
  -- PARTIÁLNÍ index (`WHERE source_ref IS NOT NULL`) a bez shodné podmínky by
  -- Postgres arbitr nenašel a příkaz by spadl na 42P10 — tedy až za běhu.
  INSERT INTO public.twin_events (event_type, twin_id, related_twin_id, story_id, occurred_at, attrs, source, source_ref)
  VALUES ('evidence_photo', v_twin_id,
          CASE WHEN v_actor_twin_id IS DISTINCT FROM v_twin_id THEN v_actor_twin_id END,
          v_story_id, now(), v_attrs, 'field-capture', p_file_path)
  ON CONFLICT (source, event_type, source_ref) WHERE source_ref IS NOT NULL DO UPDATE
    SET attrs = excluded.attrs
  RETURNING public.twin_events.id INTO v_event_id;

  -- ⛔ OBLAST AUDITU JE ENUM (journal_area) a 'evidence' v něm NENÍ. Do
  -- 2026-09-29 tu stálo holé `'evidence'` — literál bez přetypování v
  -- pojmenovaném argumentu brána enum-consistency nevidí, a preflight proto
  -- padal na 22P02 až za běhu, u každé fotky z terénu (naměřeno runtime testem
  -- prezdivka-meridla). Přetypování je explicitní, aby ho brána příště viděla.
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area        := 'operational_data'::journal_area,
    p_details     := jsonb_build_object(
                       'entity_kind', p_entity_kind,
                       'entity_id',   p_entity_id::text,
                       'file_size',   p_file_size,
                       'mime_type',   p_mime_type,
                       'slot',        p_slot),
    p_entity_id   := v_event_id::text,
    p_entity_type := 'twin_event',
    p_new_values  := NULL,
    p_old_values  := NULL,
    p_severity    := 'info',
    p_summary     := 'Field evidence photo registered',
    p_tags        := ARRAY['evidence','upload','field'],
    p_user_id     := v_uid
  );

  RETURN QUERY SELECT v_event_id, p_file_path;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_entity_evidence_preflight_audited(text,text,integer,text,text,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_entity_evidence_preflight_audited(text,text,integer,text,text,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_entity_evidence_preflight_audited(text,text,integer,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_entity_evidence_preflight_audited(text,text,integer,text,text,uuid,text) TO service_role;
