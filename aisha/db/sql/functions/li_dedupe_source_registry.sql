-- ============================================================================
-- Source of Truth: li_dedupe_source_registry
-- Popis: Sjednotí evidenční registr na PRAVIDLO JEDNOHO ŘÁDKU NA JEDEN SKUTEČNÝ
--        DOKLAD. V rámci (doc_type, hodnota identifikujícího pole) nechá jedinou
--        — nejnovější — generaci a ostatní odstraní i s navázanými li_obligations
--        a li_links.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_source_registry.dedupe_completed s rozpadem po doc_type (bez PII).
--
-- PROČ TO NEUMÍ INGEST SÁM. Engine supersedes UMÍ (stage_link relation=supersedes
-- → registry.superseded_by, verify to re-derivuje), ale vidí jen JEDEN korpus
-- jednoho běhu. Dvě generace téhož dokladu vzniknou ve dvou během — a ty vedle
-- sebe vidí jedině databáze. Proto tahle funkce žije tady a ne v enginu.
--
-- PROČ SE IDENTITA PŘEDÁVÁ PARAMETREM. Kterým polem je doklad identifikován je
-- DATA instance (ingest/field_schemas/*.schema.json), ne vlastnost platformy:
-- dodací list má dn_number, faktura invoice_number, jiná instance bude mít jiná
-- jména. Natvrdo v SQL by to byl instanční název ve stack kódu. Volající pošle
-- mapu {doc_type: field_name} odvozenou z instance dat.
--
-- IDENTITA NEMUSÍ BÝT VYTĚŽENÉ POLE. Hodnota '@filename' říká „identitou je
-- jméno zdrojového souboru" — sloupec registru, ne extrakce. Někdy je to jediná
-- možnost: běh s vadnou konfigurací uloží doklad s fields = {} a vytěžený klíč
-- prostě NEMÁ, takže s opravenou generací nejde spárovat ničím jiným (změřeno
-- 2026-07-30: 22 000 z 22 916 faktur takhle dopadlo, ale filename mají všechny
-- a je unikátní). Často je to i identita LEPŠÍ: rozbalovač skládá jméno z čísla
-- dokladu a z ID zdrojového systému, které se novým stažením nemění — na rozdíl
-- od pole, které může vytěžit špatně. Whitelist je uzavřený (žádné dynamické
-- SQL): neznámý '@sloupec' je chyba, ne tiché nic.
--
-- CO SE DĚJE S TYPEM, PRO KTERÝ IDENTITA DEKLAROVANÁ NENÍ: NIC — ale funkce to
-- ŘEKNE. Vrací undeclared_doc_types s počty řádků, takže mlčení o nepokrytém
-- typu se nedá splést s „tam nic nebylo". Totéž pro řádky, kde deklarované pole
-- v dokladu chybí (no_identity_value): nejsou ani ponechané „protože jsou v
-- pořádku", ani smazané — jsou vidět jako mezera měřidla.
--
-- KTERÁ GENERACE VYHRAJE: nejpozději ingestovaná. Při shodě (celá dávka jednoho
-- exportu nese totéž now()) rozhoduje bohatší doklad — víc vyplněných polí, pak
-- víc položek — a nakonec id, aby byl výsledek deterministický. Pořadí je stejné
-- jako u ON CONFLICT v li_upsert_source_registry: poslední zápis vyhrává.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_dedupe_source_registry(
  p_identity_fields jsonb,
  p_dry_run         boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Kanonický boolean-NOT-NULL service check — deny-guard fail-CLOSED i bez claimu.
  v_is_service    boolean := public.is_service_role();
  v_victims       uuid[];
  v_shas          text[];
  v_by_doc_type   jsonb;
  v_no_identity   jsonb;
  v_undeclared    jsonb;
  v_del_registry  integer := 0;
  v_del_oblig     integer := 0;
  v_del_links     integer := 0;
BEGIN
  -- Authorization (FIRST, před jakýmkoli přístupem k datům)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_identity_fields IS NULL OR jsonb_typeof(p_identity_fields) <> 'object' THEN
    RAISE EXCEPTION 'p_identity_fields must be a jsonb object {doc_type: field_name}';
  END IF;

  -- Uzavřený whitelist sloupcových identit. Překlep v '@filename' by jinak
  -- spadl na „pole toho jména neexistuje" → identita NULL → celý typ by se
  -- tvářil jako nepokrytý a mlčky se neuklidil.
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_identity_fields) AS e(k, v)
    WHERE v LIKE '@%' AND v <> '@filename'
  ) THEN
    RAISE EXCEPTION 'unknown column identity in p_identity_fields (only ''@filename'' is supported)';
  END IF;

  -- Jedno pořadí, jedna cesta daty: MATERIALIZED drží žebříček v jednom průchodu,
  -- takže seznam obětí i rozpad po typu vycházejí prokazatelně z TÉHOŽ řazení
  -- (a ne ze dvou nezávisle spočítaných pohledů, které se mohou rozejít).
  WITH keyed AS (
    -- Identita se čte na JEDNOM místě; níž už se s ní jen pracuje.
    SELECT r.id,
           r.source_sha256,
           r.doc_type,
           CASE WHEN (p_identity_fields ->> r.doc_type) = '@filename'
                THEN r.filename
                ELSE r.fields -> (p_identity_fields ->> r.doc_type) ->> 'value'
           END AS identity_value,
           r.ingested_at,
           (SELECT count(*) FROM jsonb_object_keys(r.fields)) AS field_count,
           jsonb_array_length(r.line_items) AS line_count
    FROM public.li_source_registry r
    WHERE p_identity_fields ? r.doc_type
  ),
  ranked AS MATERIALIZED (
    SELECT k.id, k.source_sha256, k.doc_type, k.identity_value,
           row_number() OVER (
             PARTITION BY k.doc_type, k.identity_value
             ORDER BY k.ingested_at DESC, k.field_count DESC, k.line_count DESC, k.id
           ) AS rn
    FROM keyed k
    WHERE k.identity_value IS NOT NULL
  ),
  per_type AS (
    SELECT doc_type,
           jsonb_build_object(
             'rows',       count(*),
             'identities', count(DISTINCT identity_value),
             'remove',     count(*) FILTER (WHERE rn > 1)
           ) AS detail
    FROM ranked
    GROUP BY doc_type
  )
  SELECT COALESCE((SELECT array_agg(id) FROM ranked WHERE rn > 1), '{}'::uuid[]),
         COALESCE((SELECT array_agg(source_sha256) FROM ranked WHERE rn > 1), '{}'::text[]),
         COALESCE((SELECT jsonb_object_agg(doc_type, detail) FROM per_type), '{}'::jsonb)
    INTO v_victims, v_shas, v_by_doc_type;

  -- Mezera č. 1: typ má identitu deklarovanou, ale doklad ji nenese.
  SELECT COALESCE(jsonb_object_agg(doc_type, n), '{}'::jsonb) INTO v_no_identity
  FROM (
    SELECT r.doc_type, count(*) AS n
    FROM public.li_source_registry r
    WHERE p_identity_fields ? r.doc_type
      AND (CASE WHEN (p_identity_fields ->> r.doc_type) = '@filename'
                THEN r.filename
                ELSE r.fields -> (p_identity_fields ->> r.doc_type) ->> 'value'
           END) IS NULL
    GROUP BY r.doc_type
  ) missing;

  -- Mezera č. 2: typ v registru je, identitu pro něj nikdo nedeklaroval.
  SELECT COALESCE(jsonb_object_agg(doc_type, n), '{}'::jsonb) INTO v_undeclared
  FROM (
    SELECT r.doc_type, count(*) AS n
    FROM public.li_source_registry r
    WHERE NOT (p_identity_fields ? r.doc_type)
    GROUP BY r.doc_type
  ) undeclared;

  IF NOT p_dry_run AND array_length(v_victims, 1) IS NOT NULL THEN
    -- Odvozené vrstvy první: obojí ukazuje na doklad přes source_sha256, takže
    -- po smazání registru by z nich byly nedohledatelné sirotky.
    WITH gone AS (
      DELETE FROM public.li_obligations o
      WHERE o.source_sha256 = ANY (v_shas)
      RETURNING 1
    )
    SELECT count(*) INTO v_del_oblig FROM gone;

    -- Vazba ztrácí smysl, jakmile zmizí kterýkoli z jejích konců.
    WITH gone AS (
      DELETE FROM public.li_links l
      WHERE l.from_sha256 = ANY (v_shas) OR l.to_sha256 = ANY (v_shas)
      RETURNING 1
    )
    SELECT count(*) INTO v_del_links FROM gone;

    WITH gone AS (
      DELETE FROM public.li_source_registry r
      WHERE r.id = ANY (v_victims)
      RETURNING 1
    )
    SELECT count(*) INTO v_del_registry FROM gone;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'li_source_registry.dedupe_completed',
      jsonb_build_object(
        'identity_fields', p_identity_fields,
        'by_doc_type', v_by_doc_type,
        'no_identity_value', v_no_identity,
        'undeclared_doc_types', v_undeclared,
        'removed', jsonb_build_object(
          'registry', v_del_registry,
          'obligations', v_del_oblig,
          'links', v_del_links
        )
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'duplicate_rows', COALESCE(array_length(v_victims, 1), 0),
    'by_doc_type', v_by_doc_type,
    'no_identity_value', v_no_identity,
    'undeclared_doc_types', v_undeclared,
    'removed', jsonb_build_object(
      'registry', v_del_registry,
      'obligations', v_del_oblig,
      'links', v_del_links
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_dedupe_source_registry(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_dedupe_source_registry(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_dedupe_source_registry(jsonb, boolean) TO service_role;
