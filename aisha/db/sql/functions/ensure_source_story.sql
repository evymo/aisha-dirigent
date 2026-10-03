-- Function: public.ensure_source_story
-- Story ingestovaného zdroje se RESOLVUJE z identity, nezadává se do konfigurace.
--
-- Proč: engine razítkoval do každého emitovaného řádku `impl.json → story_id`,
-- tedy UUID vypsané do konfigurace (v šabloně dokonce PRÁZDNÝ řetězec). Takový
-- balíček nepřežije přestavbu databáze — naměřeno 2026-08-30: 3 822 řádků
-- odkazovalo na story, která má v DB nula řádků, a driver na ní fail-closed
-- padal. Twins tutéž přestavbu přežívají právě proto, že jsou klíčované
-- IDENTITOU `(source, source_key)`, ne syrovým UUID.
--
-- Tvar je kanonický, ne nový: `ensure_production_batch_story` dělá totéž pro
-- výrobní dávku — VĚC, o které story je, si `story_id` drží, a RPC ho najde
-- nebo založí. Zde je tou věcí registrovaný zdroj.
--
-- Fail-closed: neznámý nebo neaktivní zdroj je STOP, ne založení story.
-- Shodně s `register_source_document_audited` — zdroj musí nejdřív projít
-- onboardingem (klasifikace, consent), teprve pak smí vlastnit obsah.
-- Nejistota se neobchází výchozí hodnotou.
--
-- Story vzniká ve stavu `inbox`, tedy NEVIDITELNÁ: o tom, že story vznikla,
-- rozhoduje automatika ingestu; o tom, že ji člověk uvidí, rozhoduje člověk.
--
-- Security: SECURITY DEFINER. Admin/staff nebo service_role.
-- @audit: required

CREATE OR REPLACE FUNCTION public.ensure_source_story(
  p_source_slug text,
  p_title       text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source   public.agent_knowledge_sources%ROWTYPE;
  v_story_id uuid;
  v_navrzen  uuid;
  -- ⛔ NE `FOUND`: přepíše ho KAŽDÝ následující příkaz (UPDATE i INSERT níž),
  -- takže by rozhodnutí „zdroj mám" záviselo na tom, kolik řádků se právě
  -- dotklo auditu. Příznak drží ODPOVĚĎ, ne poslední vedlejší účinek.
  v_mam      boolean := false;
BEGIN
  IF NOT (public.is_admin_or_staff(auth.uid()) OR public.is_service_role()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin, staff or service role required');
  END IF;

  IF p_source_slug IS NULL OR btrim(p_source_slug) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source slug required');
  END IF;

  SELECT * INTO v_source
  FROM public.agent_knowledge_sources
  WHERE source_slug = p_source_slug AND is_active;
  v_mam := FOUND;

  -- ⭐ SJEDNOCENÍ IDENTITY: aktivní zdroj smí POHLTIT historický slug.
  --
  -- ⛔ NAMĚŘENO 2026-09-02: engine značí balíčky `local-ingest`, ale TŘI balíčky
  -- ze 3.–4. 8. nesou `aisha-local-ingest` (jméno aplikace, ne registrovaného
  -- zdroje) — jednorázová anomálie jednoho exportního běhu, poznatelná i podle
  -- odlišného tvaru `export_id` (bez časové zóny). Ta tři jména založila NÁVRH,
  -- který se nedá aktivovat, a od té doby blokují každý běh: 1435 syncs, 1435
  -- failures, `last_success_at` NULL.
  --
  -- Bez tohohle kroku má jedna skutečnost DVĚ identity a obě se tváří jako
  -- samostatný zdroj. Řešit to přejmenováním v balíčcích nejde — jsou podepsané
  -- a už odeslané; řešit to druhým aktivním zdrojem by duplicitu zabetonovalo.
  --
  -- Pohlcení je KURÁTOROVANÉ ROZHODNUTÍ, ne heuristika: zapisuje ho člověk přes
  -- `set_data_source_config` do `config.nahrazuje`. Stroj nikdy neuhodne, že dvě
  -- jména znamenají totéž — to je tvrzení o světě, ne o datech.
  IF NOT v_mam THEN
    SELECT * INTO v_source
    FROM public.agent_knowledge_sources
    WHERE is_active AND (config -> 'nahrazuje') ? p_source_slug
    ORDER BY source_slug
    LIMIT 1;
    v_mam := FOUND;
    IF v_mam THEN
      -- Aby administrace neukazovala pohlcený návrh dál jako „čeká na
      -- klasifikaci": stav se zapíše k němu, ne jen do logu. Idempotentní.
      UPDATE public.agent_knowledge_sources
         SET config = coalesce(config, '{}'::jsonb)
                      || jsonb_build_object('superseded_by', v_source.source_slug),
             updated_at = now()
       WHERE source_slug = p_source_slug
         AND coalesce(config ->> 'superseded_by', '') <> v_source.source_slug;
      INSERT INTO public.audit_journal (user_id, action, metadata)
      VALUES (auth.uid(), 'ingest.source.absorbed',
              jsonb_build_object('slug', p_source_slug,
                                 'resolved_to', v_source.source_slug));
    END IF;
  END IF;

  IF NOT v_mam THEN
    -- ⭐ ZDROJ NAJDE INGEST, AKTIVUJE HO ČLOVĚK.
    --
    -- Odmítnutí zůstává (viz níž `ok:false`) — obsah bez kontextu nemá scope.
    -- Co se mění: dřív po sobě odmítnutí NENECHALO STOPU, takže operátor musel
    -- tušit, že se někde hlásí zdroj čekající na klasifikaci. „Nic tu není" se
    -- nedalo odlišit od „nikdo se nehlásil".
    --
    -- Zakládá se proto NEAKTIVNÍ řádek — návrh. Žádné oprávnění tím nevzniká:
    -- neaktivní zdroj nesmí vyrobit obsah ani kontext a `activation_guard` ho
    -- bez úplné 4D klasifikace ani nepustí aktivovat. Je to táž doktrína jako
    -- u vazeb: stroj navrhuje s důkazem, člověk ratifikuje VZOR — jednou pro
    -- zdroj, ne pro každý balíček.
    --
    -- Klasifikace se ZÁMĚRNĚ nedoplňuje ani prázdná: `legal_basis` a `retention_class`
    -- jsou fakta o právním vztahu, ne o datech. Uhodnout je nejde ani nemá.
    IF EXISTS (SELECT 1 FROM public.agent_knowledge_sources WHERE source_slug = p_source_slug) THEN
      -- Zdroj JE, jen není aktivní. Nesaháme na něj: mohl být vypnutý záměrně
      -- a přepsat cizí rozhodnutí návrhem by bylo horší než mlčet.
      RETURN jsonb_build_object('ok', false, 'error', 'unknown or inactive source',
                                'source_slug', p_source_slug, 'proposed', false);
    END IF;

    -- Slug musí projít formátem tabulky, jinak by INSERT spadl výjimkou místo
    -- odpovědi. Neplatný slug je vada balíčku, ne důvod ke zhroucení.
    IF p_source_slug ~ '^[a-z0-9][a-z0-9_-]*$' THEN
      INSERT INTO public.agent_knowledge_sources (source_slug, namespace, is_active, config)
      VALUES (p_source_slug,
              -- Provizorní jmenný prostor: říká, ODKUD se zdroj ohlásil.
              -- Není to tvrzení o zařazení — to nastaví člověk při schválení.
              'ingest/' || p_source_slug,
              false,
              jsonb_build_object('proposed_by', 'ingest',
                                 'proposed_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                                 'note', 'Ohlásil se ingest. Chybí 4D klasifikace '
                                      || '(source_type, data_sensitivity, retention_class, legal_basis) '
                                      || 'a vlastník (owner); bez nich zdroj nelze aktivovat.'))
      ON CONFLICT (source_slug) DO NOTHING
      RETURNING id INTO v_navrzen;

      IF v_navrzen IS NOT NULL THEN
        INSERT INTO public.audit_journal (user_id, action, metadata)
        VALUES (auth.uid(), 'ingest.source.proposed',
                jsonb_build_object('source_slug', p_source_slug, 'source_id', v_navrzen));
      END IF;
    END IF;

    -- Táž chyba a týž kód jako register_source_document_audited: jedna vlastnost,
    -- jedna odpověď. Zdroj mimo registr nesmí vyrobit obsah ani kontext.
    RETURN jsonb_build_object('ok', false, 'error', 'unknown or inactive source',
                              'source_slug', p_source_slug,
                              'proposed', v_navrzen IS NOT NULL);
  END IF;

  IF v_source.story_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'story_id', v_source.story_id, 'created', false);
  END IF;

  INSERT INTO public.partner_stories (
    partner_id, user_id, title, status, priority, origin, is_stack_default, project_preview
  ) VALUES (
    NULL,
    auth.uid(),
    COALESCE(NULLIF(btrim(p_title), ''), v_source.source_slug),
    'inbox',            -- neviditelná, dokud ji člověk nepřijme
    'normal',
    'ingest',
    false,
    jsonb_build_object(
      'summary', 'Kontext ingestovaného zdroje ' || v_source.source_slug,
      'goals', '[]'::jsonb,
      'constraints', '[]'::jsonb,
      'success_criteria', '[]'::jsonb)
  ) RETURNING id INTO v_story_id;

  UPDATE public.agent_knowledge_sources
     SET story_id = v_story_id, updated_at = now()
   WHERE id = v_source.id;

  PERFORM public.add_story_system_entry(
    v_story_id, 'tracking_event', 'ingest.source.story_created',
    jsonb_build_object('source_slug', v_source.source_slug,
                       'namespace', v_source.namespace),
    now(), 'agent_knowledge_sources', v_source.id);

  RETURN jsonb_build_object('ok', true, 'story_id', v_story_id, 'created', true);
END $function$;

REVOKE ALL ON FUNCTION public.ensure_source_story(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_source_story(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_source_story(text,text) TO service_role;
