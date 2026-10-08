-- Function: public.upsert_story_knowledge_item_audited
-- Description: Create or update a knowledge_items row scoped to a story.
--   When p_id is NULL → INSERT (new item). When p_id is provided →
--   UPDATE (must already belong to the story; cross-story moves are
--   rejected). Writes audit_journal on every mutation.
-- Security: SECURITY DEFINER. Admin/staff only (story participants can
--   READ via list_story_knowledge_items but writes need admin role —
--   keeps the KB curation surface narrow).

-- Brick4: the trailing p_locale param changes the arity (10 → 11). A new DEFAULT
-- arg does NOT replace the old overload (different arg count), so drop the 10-arg
-- signature first or callers face an ambiguous pair.
DROP FUNCTION IF EXISTS public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text
);
-- 2026-07-30: totéž znovu, arita 11 → 14 (provenience zdroje). Kdyby tu 11-arg
-- varianta zůstala, každé volání s 11 argumenty by skončilo „function is not
-- unique" — obě by seděly, protože nová má zbytek s DEFAULTem.
DROP FUNCTION IF EXISTS public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text
);

-- ── PROČ PROVENIENCE (2026-07-30) ───────────────────────────────────────────
-- li-driver volal tuhle funkci s p_id = NULL, což je VŽDY INSERT. Balíček
-- přitom identitu zdroje NESE (source_type='local_ingest', source_slug=
-- '<instance>-doc-<sha12>', source_hash=sha dokladu) — driver ji zahodil, protože ji
-- funkce neuměla přijmout, a záznam spadl na source_type='manual' s prázdným
-- slugem. Tím se vyřadily OBĚ strukturální pojistky, které platforma proti
-- duplicitě má: idx_knowledge_items_source_slug_locale_unique i
-- idx_knowledge_items_source_unique neměly na čem zabrat.
--
-- Následek naměřený na produkci: 217 160 KB položek, z toho 137 097 duplicitních
-- (63 %) — každý replay téhož balíčku přidal celou další kopii. A 63 376 strojově
-- ingestovaných dokladů bylo v KB k nerozeznání od ručních poznámek.
--
-- Řešení není nový klíč: `knowledge_items.source_hash` je podle SoT tabulky
-- „the content-dedup key for re-ingestion idempotency" a partial unique index nad
-- (source_slug, locale) existuje od #33. Obojí čekalo, až je někdo použije.
-- Když volající pošle source_slug, funkce si podle něj NAJDE existující záznam
-- a jde UPDATE větví. Replay téhož balíčku je tím no-op místo duplikátu.
CREATE OR REPLACE FUNCTION public.upsert_story_knowledge_item_audited(
  p_story_id        uuid,
  p_id              uuid DEFAULT NULL,
  p_title           text DEFAULT NULL,
  p_body_markdown   text DEFAULT NULL,
  p_item_type       text DEFAULT NULL,
  p_summary         text DEFAULT NULL,
  p_category        text DEFAULT NULL,
  p_ai_context_tags text[] DEFAULT NULL,
  p_ai_instructions text DEFAULT NULL,
  p_visibility      text DEFAULT NULL,
  p_locale          text DEFAULT NULL,
  p_source_type     text DEFAULT NULL,
  p_source_slug     text DEFAULT NULL,
  p_source_hash     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_item_id        uuid;
  v_target_id      uuid := p_id;   -- p_id, nebo dohledaný podle provenience
  v_existing_story_id uuid;
  v_existing_title text;
  v_existing_tags  text[];
  v_action         public.journal_action_type;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- service_role je důvěryhodná platformní role (přísnější než admin/staff) a je
  -- jediným writerem federovaných zdrojů (např. li-driver z local-ingest). Bez
  -- této větve is_admin_or_staff(NULL) padne na false a čistý service_role call
  -- se zamítne → KB zápisní cesta pro source-broker driver by byla mrtvá.
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required to manage knowledge items'
      USING ERRCODE = '42501';
  END IF;

  -- Vyhrazené zdroje znalostí zapisuje JEN seed z repozitáře (prostý INSERT v seedu, nikdy
  -- tahle funkce). source_type sem přichází od volajícího — i od služby, která ho bere
  -- z nedůvěryhodného balíčku (ingest) — proto odmítnutí pro KAŽDÉHO volajícího.
  IF p_source_type = ANY (ARRAY['platform_knowledge'::text, 'instance_knowledge'::text]) THEN
    RAISE EXCEPTION 'upsert_story_knowledge_item_audited: source_type % is reserved for the repository seed — refused', p_source_type
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id) THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  -- Identita zdroje má přednost před slepým INSERTem: volající, který ví, ODKUD
  -- záznam je, nemusí vědět, jestli už v KB leží. Hledá se přes (source_slug,
  -- locale) — přesně dvojice, nad kterou stojí partial unique index, takže je to
  -- i rychlé a nemůže to vrátit dva řádky. Vyhrazené zdroje ('platform_knowledge',
  -- 'instance_knowledge') ten index vynechává a mají vlastní jmenný prostor: položka
  -- příběhu se stejným slugem vedle nich smí ležet a tady se na ně nenapojí.
  IF v_target_id IS NULL AND p_source_slug IS NOT NULL THEN
    SELECT ki.id INTO v_target_id
    FROM public.knowledge_items ki
    WHERE ki.source_slug = p_source_slug
      AND ki.locale = COALESCE(p_locale, 'global')
      AND ki.source_type <> ALL (ARRAY['platform_knowledge'::text, 'instance_knowledge'::text]);
  END IF;

  IF v_target_id IS NULL THEN
    -- INSERT path
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
      RAISE EXCEPTION 'Title is required for new knowledge items'
        USING ERRCODE = '22023';
    END IF;
    IF p_body_markdown IS NULL OR length(trim(p_body_markdown)) = 0 THEN
      RAISE EXCEPTION 'Body content is required for new knowledge items'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.knowledge_items (
      item_type, source_type, source_slug, source_hash, title, summary, body_markdown,
      ai_instructions, ai_context_tags, category, visibility,
      story_id, author_id, status, locale
    ) VALUES (
      COALESCE(p_item_type, 'engineering_doc')::public.knowledge_item_type,
      -- 'manual' zůstává výchozí, aby se ruční kurátorská cesta nezměnila;
      -- strojový zapisovatel se ale teď MŮŽE představit.
      COALESCE(p_source_type, 'manual'),
      p_source_slug,
      p_source_hash,
      p_title,
      p_summary,
      p_body_markdown,
      p_ai_instructions,
      COALESCE(p_ai_context_tags, '{}'::text[]),
      p_category,
      COALESCE(p_visibility, 'public'),
      p_story_id,
      v_user_id,
      'active',
      -- Brick4 locale axis: the caller's locale (defaults to the 'global' sentinel).
      -- COALESCE guards a NULL p_locale; the value must exist as a
      -- supported_languages(code) row (FK, no cascade) or the write fails 23503
      -- (fail-loud — never silently coerce an unsupported locale).
      COALESCE(p_locale, 'global')
    )
    RETURNING id INTO v_item_id;

    v_action := 'create'::public.journal_action_type;
  ELSE
    -- UPDATE path
    SELECT ki.story_id, ki.title, COALESCE(ki.ai_context_tags, '{}'::text[])
      INTO v_existing_story_id, v_existing_title, v_existing_tags
    FROM public.knowledge_items ki
    WHERE ki.id = v_target_id;

    IF v_existing_story_id IS NULL THEN
      RAISE EXCEPTION 'Knowledge item not found: %', v_target_id USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_story_id <> p_story_id THEN
      RAISE EXCEPTION 'Knowledge item % belongs to a different story',
        v_target_id USING ERRCODE = '42501';
    END IF;

    UPDATE public.knowledge_items
       SET title             = COALESCE(p_title, title),
           summary           = COALESCE(p_summary, summary),
           body_markdown     = COALESCE(p_body_markdown, body_markdown),
           ai_instructions   = COALESCE(p_ai_instructions, ai_instructions),
           ai_context_tags   = COALESCE(p_ai_context_tags, ai_context_tags),
           category          = COALESCE(p_category, category),
           visibility        = COALESCE(p_visibility, visibility),
           item_type         = COALESCE(p_item_type::public.knowledge_item_type, item_type),
           -- Brick4: opt-in locale correction on update. Omitting p_locale keeps the
           -- item's existing locale (COALESCE no-op) — an item never silently changes
           -- language on a content edit.
           locale            = COALESCE(p_locale, locale),
           -- Provenience se jen DOPLŇUJE, nikdy nemaže: replay bez těchto polí
           -- nesmí záznamu vzít to, čím byl identifikovaný.
           source_type       = COALESCE(p_source_type, source_type),
           source_slug       = COALESCE(p_source_slug, source_slug),
           source_hash       = COALESCE(p_source_hash, source_hash),
           version           = version + 1,
           updated_at        = now()
     WHERE id = v_target_id
    RETURNING id INTO v_item_id;

    v_action := 'update'::public.journal_action_type;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'story_id', p_story_id,
      'item_type', p_item_type,
      'tag_count', COALESCE(array_length(p_ai_context_tags, 1), 0)
    ),
    p_entity_id   := v_item_id::text,
    p_entity_type := 'knowledge_items',
    p_new_values  := jsonb_strip_nulls(jsonb_build_object(
      'title', p_title,
      'tags', p_ai_context_tags,
      'category', p_category,
      'visibility', p_visibility
    )),
    p_old_values  := CASE
      -- v_target_id, ne p_id: zápis dohledaný přes provenienci JE aktualizace
      -- a audit ji tak musí pojmenovat, jinak by replay vypadal jako nový záznam.
      WHEN v_target_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'title', v_existing_title,
        'tags', v_existing_tags
      )
    END,
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format(
      '%s knowledge_item for story %s',
      CASE WHEN v_target_id IS NULL THEN 'Created' ELSE 'Updated' END,
      p_story_id
    ),
    p_tags        := ARRAY['knowledge', 'story_kb'],
    p_user_id     := v_user_id
  );

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_story_knowledge_item_audited(
  uuid, uuid, text, text, text, text, text, text[], text, text, text, text, text, text
) TO service_role;
