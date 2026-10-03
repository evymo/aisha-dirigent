-- ============================================================================
-- Source of Truth: li_dedupe_knowledge_items
-- Popis: Sjednotí znalostní vrstvu na PRAVIDLO JEDNOHO ZÁZNAMU NA JEDEN DOKLAD.
--        V rámci (story_id, item_type, title) nechá jediný — nejnovější — záznam
--        a ostatní odstraní i s jejich chunky a embeddingy.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: knowledge_items.dedupe_completed s rozpadem po kategorii (bez PII).
--
-- PROČ TA DUPLICITA VŮBEC VZNIKÁ. li-driver zapisuje KB přes
-- upsert_story_knowledge_item_audited s p_id = NULL, což je vždy INSERT. Balíček
-- přitom identitu NESE (source_type='local_ingest', source_slug='<instance>-doc-…',
-- source_hash=sha dokladu) — driver ji zahodí, protože ji RPC neumí přijmout, a
-- záznam spadne na source_type='manual' s prázdným source_slug. Tím se vyřadí
-- OBĚ strukturální pojistky, které platforma proti duplicitě má
-- (idx_knowledge_items_source_slug_locale_unique i idx_knowledge_items_source_
-- unique) — nemají na čem zabrat. Měřeno 2026-07-30: 63 376 strojově
-- ingestovaných dokladů je v KB k nerozeznání od ručních poznámek.
-- Tahle funkce následek uklízí; PŘÍČINU musí opravit zápisní cesta driveru.
--
-- ROZSAH SE MUSÍ POJMENOVAT. p_categories je povinné a neprázdné: „smaž
-- duplicitní tituly v celé KB" je příliš velká zbraň na to, aby šla vystřelit
-- opomenutím. Volající řekne, kterou kategorii uklízí.
--
-- CO SE NESMÍ SMAZAT ANI OMYLEM: záznam, na kterém visí lidská práce —
-- knowledge_attribution nebo agent_knowledge_bindings. Takový se z úklidu
-- VYJME a vrátí se v `blocked`. Duplicita tam zůstane vidět; to je menší škoda
-- než tiše zahozená kurátorská vazba.
--
-- MAZAT MUSÍME RUČNĚ A V POŘADÍ: knowledge_chunks ani knowledge_embeddings
-- nemají FK na knowledge_items (ověřeno na živé DB 2026-07-30 — jediný CASCADE
-- vede z knowledge_multimodal_pages). DELETE nad položkami by tedy nechal
-- osiřelé chunky, které retrieval dál vidí.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_dedupe_knowledge_items(
  p_categories text[],
  p_dry_run    boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service     boolean := public.is_service_role();
  v_victims        uuid[];
  v_blocked        uuid[];
  v_by_category    jsonb;
  v_del_items      integer := 0;
  v_del_chunks     integer := 0;
  v_del_embeddings integer := 0;
BEGIN
  -- Authorization (FIRST, před jakýmkoli přístupem k datům)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    RAISE EXCEPTION 'p_categories must be a non-empty array of knowledge_items.category values';
  END IF;

  WITH ranked AS MATERIALIZED (
    SELECT ki.id,
           ki.category,
           row_number() OVER (
             PARTITION BY ki.story_id, ki.item_type, ki.title
             ORDER BY ki.created_at DESC, ki.id
           ) AS rn
    FROM public.knowledge_items ki
    WHERE ki.category = ANY (p_categories)
  ),
  losers AS (
    SELECT r.id, r.category,
           (EXISTS (SELECT 1 FROM public.knowledge_attribution a WHERE a.knowledge_item_id = r.id)
            OR EXISTS (SELECT 1 FROM public.agent_knowledge_bindings b WHERE b.knowledge_item_id = r.id)
           ) AS has_curation
    FROM ranked r
    WHERE r.rn > 1
  ),
  per_category AS (
    SELECT r.category,
           jsonb_build_object(
             'items',   count(*),
             'titles',  count(*) FILTER (WHERE r.rn = 1),
             'remove',  count(*) FILTER (WHERE r.rn > 1)
           ) AS detail
    FROM ranked r
    GROUP BY r.category
  )
  SELECT COALESCE((SELECT array_agg(id) FROM losers WHERE NOT has_curation), '{}'::uuid[]),
         COALESCE((SELECT array_agg(id) FROM losers WHERE has_curation), '{}'::uuid[]),
         COALESCE((SELECT jsonb_object_agg(category, detail) FROM per_category), '{}'::jsonb)
    INTO v_victims, v_blocked, v_by_category;

  IF NOT p_dry_run AND array_length(v_victims, 1) IS NOT NULL THEN
    -- Embeddingy visí na chunku i na položce; obě cesty musí zmizet, jinak
    -- zůstane vektor ukazující na neexistující text.
    WITH gone AS (
      DELETE FROM public.knowledge_embeddings e
      WHERE e.knowledge_item_id = ANY (v_victims)
         OR e.chunk_id IN (SELECT c.id FROM public.knowledge_chunks c
                            WHERE c.knowledge_item_id = ANY (v_victims))
      RETURNING 1
    )
    SELECT count(*) INTO v_del_embeddings FROM gone;

    WITH gone AS (
      DELETE FROM public.knowledge_chunks c
      WHERE c.knowledge_item_id = ANY (v_victims)
      RETURNING 1
    )
    SELECT count(*) INTO v_del_chunks FROM gone;

    WITH gone AS (
      DELETE FROM public.knowledge_items ki
      WHERE ki.id = ANY (v_victims)
      RETURNING 1
    )
    SELECT count(*) INTO v_del_items FROM gone;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'knowledge_items.dedupe_completed',
      jsonb_build_object(
        'categories', to_jsonb(p_categories),
        'by_category', v_by_category,
        'blocked', COALESCE(array_length(v_blocked, 1), 0),
        'removed', jsonb_build_object(
          'items', v_del_items,
          'chunks', v_del_chunks,
          'embeddings', v_del_embeddings
        )
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'duplicate_items', COALESCE(array_length(v_victims, 1), 0),
    'blocked_by_curation', COALESCE(array_length(v_blocked, 1), 0),
    'by_category', v_by_category,
    'removed', jsonb_build_object(
      'items', v_del_items,
      'chunks', v_del_chunks,
      'embeddings', v_del_embeddings
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_dedupe_knowledge_items(text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_dedupe_knowledge_items(text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_dedupe_knowledge_items(text[], boolean) TO service_role;
