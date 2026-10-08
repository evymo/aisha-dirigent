-- Function: mcp_search_knowledge_v3

-- Brick3 locale axis: chunk_locale added to RETURNS TABLE (surfaced).
-- Brick2-guard model identity: p_query_model is a HARD WHERE filter on ke.model /
-- ke.model_v2 — model identity is a CORRECTNESS invariant (a query embedded by model X
-- must only be cosine-compared against chunks embedded by model X), NOT a score term.
-- Brick5 cross-lingual (14-arg): p_locale text DEFAULT NULL appended AFTER p_query_model.
--   * preference-BOOST, never a hard filter (HARD invariant): a chunk whose locale = p_locale
--     gets a small subtraction from its vector distance so it reranks slightly earlier; a
--     non-matching locale still ranks (cross-lingual fallback rides the shared vector space).
--   * variant DEDUP via source_concept_id: locale variants of one source node collapse to one
--     WINNING variant (the item owning the best-scoring chunk), and only that item's chunks are
--     returned. Single-variant concepts are unaffected (winner = the one item → no regression).
-- Brick6 tier-ACL (15-arg): p_audience_user_id uuid DEFAULT NULL appended AFTER p_locale. The
-- WHERE gains a HARD filter audience_user_meets_tier_requirement(ki.minimum_tier, audience_user)
-- so under-tier users never retrieve a gated row. Only service_role may name a different
-- end-user; authenticated callers are pinned to auth.uid() (no tier spoof). The signature
-- changed (14→15), so the prior overloads are DROPped and REVOKE/GRANT re-issued at 15 args.
--
-- Parametry (2026-10-04): každý parametr buď filtruje či řadí v OBOU větvích (embedding v1
-- i v2), nebo je tu jmenovaná výjimka — parametr, který funkce přijme a mlčky ignoruje,
-- vypadá pro volajícího jako filtr. Hlídá brána mcp-search-v3-parametry.
--   p_query_text    výjimka: v3 je čistě vektorové hledání; text nefiltruje ani neřadí. Dřív ho
--                   nesla textová záloha při výpadku embeddingu — ta je od 2026-10-06 zrušená
--                   (P2: hledání bez embeddingu selže nahlas, embedding_unavailable).
--   p_context_tags  výjimka: ani ve v2 štítky NEFILTRUJÍ (jen přidávají body pořadí);
--                   v3 řadí vzdáleností vektoru a bodování štítků nemá.
-- Viditelnost GLOBÁLNÍCH položek: táž pravidla jako ve v2 (do 2026-10-04 šla globální
-- položka ven s jakoukoli viditelností). Položku příběhu hlídá kontrola p_story_id.
-- Které viditelnosti jdou komu, má jeden domov: public.knowledge_visibility_searchable — pro toho,
-- PRO KOHO se hledá (bez identity jen `public`, přihlášenému `members`, gildě `guild`).
-- Přístup k příběhu se měří u téhož publika i tehdy, když hledá služba (K6 rady, 2026-10-04).
-- ⛔ PODMÍNKA VOLAJÍCÍHO (K-35 2026-10-01, B8): pod službou se přístup k p_story_id měří jen
-- u PŘEDANÉHO publika (K6, níž v_story_ok); služba, která publikum zapomene, dostane jen globální
-- položky. Uživatelské cesty (svc-mcp-knowledge searchKnowledgeProd) přesto volají identitou
-- uživatele (B8), takže stráž příběhu platí i pro chybně ražený claim; pod službou jen služební
-- rag-eval se story ze zlaté sady v DB. Výčet volajících drží brána kb-pribeh-jen-pod-uzivatelem.
-- P2 IDENTITA VAH (2026-10-06, podpis beze změny — 15 argumentů). Jméno modelu NESTAČÍ: po
-- přepočtu na GPU nesou staré vektory (gguf / hf / MLX) totéž model_id jako nové a filtr podle
-- jména by je tiše míchal do pořadí (naměřeno na riq 2026-10-06: 126 443 starých vektorů ve
-- 3 identitách, 0 v cílové). Je-li zadán p_query_model, srovnává se dotaz JEN s vektory, jejichž
-- identita vah (public.fn_identita_vektoru(model_version)) = DEKLAROVANÁ identita modelu
-- (public.fn_deklarace_vah_embeddingu — týž domov jako dopočet v1). Tvrdý WHERE, ne člen skóre.
-- Identitu filtru počítá VÝHRADNĚ server z deklarace — volající ji nezadává ani neovlivní
-- (revize bezpečnosti 2026-10-07: parametr s identitou od volajícího by byl orákulum deklarace).
-- Kontrolu identity, kterou k vektoru dotazu ohlásila lane, dělá služba před voláním
-- (svc-mcp-knowledge overIdentituDotazu, služební rovina).
-- Pořadí: kontrola přihlášení a příběhu PŘED čtením deklarace; nedeklarovaná identita = jednotná
-- výjimka 22023 `embedding_identity_undeclared` bez hodnot (ani jména modelu, ani deklarace) —
-- nikdy prázdný výsledek, který by vypadal jako „nic nenalezeno“.
-- p_query_model NULL = bez filtru modelu (zpětná kompatibilita kontrol oprávnění; brick2 (f)).
-- Produkční volající model předávají vždy — hlídá brána brick2-model-guard.
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text);
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text);
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.mcp_search_knowledge_v3(p_query_embedding_v1 vector DEFAULT NULL::vector, p_query_embedding_v2 halfvec DEFAULT NULL::halfvec, p_query_text text DEFAULT NULL::text, p_item_types text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text, p_expertise_slug text DEFAULT NULL::text, p_context_tags text[] DEFAULT NULL::text[], p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 10, p_similarity_threshold numeric DEFAULT 0.3, p_story_id uuid DEFAULT NULL::uuid, p_model_pref text DEFAULT 'v1'::text, p_query_model text DEFAULT NULL::text, p_locale text DEFAULT NULL::text, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(knowledge_item_id uuid, chunk_id uuid, chunk_text text, chunk_slug text, similarity numeric, embedding_version text, chunk_locale text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_id uuid;
  -- Brick6: the end-user whose tier gates retrieval (service may override via the arg; else self).
  v_audience_user uuid;
  -- má ten, pro koho se hledá, profil partnera (viditelnost `guild`)
  v_in_guild boolean;
  -- smí ten, pro koho se hledá, číst příběh p_story_id
  v_story_ok boolean;
  -- P2: deklarovaná identita vah modelu dotazu (`<formát>:<sha256>`); NULL jen bez p_query_model
  v_identita text;
  -- locale preference nudge (rerank only): a locale match subtracts this from the cosine
  -- distance. Small relative to the [0,2] distance range — a same-language tie-breaker /
  -- gentle preference, never enough to override a materially better cross-lingual hit.
  c_locale_boost constant numeric := 0.05;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- ── RBAC: Per-story access check (ported verbatim from mcp_search_knowledge_v2) ─
  v_caller_role := public.get_jwt_role();
  v_caller_id := auth.uid();

  IF p_story_id IS NOT NULL AND v_caller_role IS DISTINCT FROM 'service_role' THEN
    IF NOT (
      public.is_admin_or_staff()
      OR EXISTS (
        SELECT 1 FROM public.partner_stories ps
        WHERE ps.id = p_story_id AND ps.user_id = v_caller_id
      )
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = p_story_id AND sp.user_id = v_caller_id
      )
    ) THEN
      RAISE EXCEPTION 'Access denied to story %', p_story_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Brick6 tier-ACL audience identity: only service_role (trusted orchestration) may name a
  -- different end-user via p_audience_user_id; authenticated callers are pinned to themselves
  -- (no tier spoofing). The tier check itself fails closed (unknown user ⇒ anonymous).
  v_audience_user := CASE
    WHEN v_caller_role = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;
  -- Gilda = kdo má profil partnera (totéž pravidlo jako get_expert_rules). Počítá se JEDNOU
  -- a z toho, PRO KOHO se hledá; bez identity false — ani služba bez publika `guild` nedostane.
  v_in_guild := public.knowledge_audience_in_guild(v_audience_user);
  -- Přístup k příběhu pro TOHO, PRO KOHO se hledá. Volající mimo službu hledá za sebe a je ověřen výš.
  -- Služba dostane položky příběhu jen tehdy, když publikum PŘEDÁ a to k příběhu přístup MÁ (vlastník /
  -- účastník; správu propouští vlastní větev predikátu níž) — podle dnešního stavu v databázi, ne podle
  -- toho, co platilo, když byl vydán token. Služba BEZ publika je bez identity: jen globální položky,
  -- stejně jako ve v2 (žádná výjimka pro servisní roli). Do 2026-10-04 se pro servisní roli neověřovalo
  -- nic: odebraný účastník četl dál a každá cesta, která publikum zapomněla předat, vydala příběh celý.
  v_story_ok := p_story_id IS NULL
    OR v_caller_role IS DISTINCT FROM 'service_role'
    OR EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = p_story_id AND ps.user_id = v_audience_user)
    OR EXISTS (SELECT 1 FROM public.story_participants sp WHERE sp.story_id = p_story_id AND sp.user_id = v_audience_user);

  -- P2: identita VAH, ne jen jméno modelu — AŽ PO kontrole přihlášení a příběhu výš. Deklaraci čte
  -- jediný domov (týž jako dopočet v1). Jeho podrobná zpráva (jméno modelu, návod pro data instance)
  -- patří do logu služby, ne volajícímu: tady se nahrazuje JEDNOTNOU výjimkou bez hodnot. Nikdy
  -- prázdný výsledek, který by vypadal jako „nic nenalezeno“.
  IF p_query_model IS NOT NULL THEN
    BEGIN
      SELECT d.identita INTO v_identita FROM public.fn_deklarace_vah_embeddingu(p_query_model) d;
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'vektorové hledání nedostupné (embedding_identity_undeclared)'
        USING ERRCODE = '22023';
    END;
  END IF;

  IF p_model_pref = 'v2' THEN
    IF p_query_embedding_v2 IS NULL THEN
      RAISE EXCEPTION 'p_query_embedding_v2 is required when p_model_pref = v2';
    END IF;
    RETURN QUERY
    WITH scored AS (
      SELECT
        ke.knowledge_item_id AS s_item_id,
        ke.chunk_id AS s_chunk_id,
        kc.chunk_text AS s_chunk_text,
        (COALESCE(ki.source_slug, ki.id::text) || ':' || kc.chunk_index)::text AS s_chunk_slug,
        (1 - (ke.embedding_v2 <=> p_query_embedding_v2))::numeric AS s_similarity,
        kc.locale AS s_chunk_locale,
        -- COALESCE so a NULL source_concept_id (trigger-bypassed insert, bulk load, or a
        -- not-yet-backfilled row) degrades to "own item = its own concept" (a singleton, no
        -- dedup) instead of NULL — a NULL concept would drop the row at the winner JOIN.
        COALESCE(ki.source_concept_id, ki.id) AS s_concept,
        (ke.embedding_v2 <=> p_query_embedding_v2)
          - CASE WHEN p_locale IS NOT NULL AND kc.locale = p_locale THEN c_locale_boost ELSE 0 END AS s_eff_dist
      FROM public.knowledge_embeddings ke
      JOIN public.knowledge_chunks kc ON kc.id = ke.chunk_id
      JOIN public.knowledge_items ki ON ki.id = ke.knowledge_item_id
      LEFT JOIN public.guild_expertise_areas gea ON gea.id = ki.expertise_area_id
     WHERE ke.embedding_v2 IS NOT NULL
       AND ki.status = 'active'
       AND public.knowledge_state_readable(ki.quarantine_status)
       -- Prázdný seznam typů = bez filtru typu (jako ve v2). Volající přes MCP ho posílá,
       -- když typy nezadá; `= ANY('{}')` by odfiltrovalo všechno.
       AND (p_item_types IS NULL OR cardinality(p_item_types) = 0 OR ki.item_type::text = ANY(p_item_types))
       AND (p_category IS NULL OR ki.category = p_category)
       AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
       -- Úryvky instrukcí pro model jen na výslovné přání (NULL = ne, jako ve v2).
       AND (p_include_ai_instructions IS TRUE OR kc.source_field <> 'ai_instructions')
       -- Jen globální položky a položky hledaného příběhu — i u zásad a rysů osobnosti: výjimka
       -- podle typu bez podmínky na příběh pouštěla zásadu cizího příběhu (do 2026-10-04).
       AND (
         (p_story_id IS NULL AND ki.story_id IS NULL)
         OR (p_story_id IS NOT NULL AND (ki.story_id = p_story_id OR ki.story_id IS NULL))
       )
       -- Viditelnost globální položky jako ve v2 — jeden domov, pro toho, pro koho se hledá; zásady
       -- a rysy výjimku podle typu nemají. Položka příběhu jen s přístupem publika k příběhu. Bez
       -- `ki.story_id IS NULL` u viditelnosti by položku příběhu s viditelností `public` (výchozí
       -- hodnota sloupce) propustila i tomu, kdo k příběhu nesmí. Správa (podle koho se hledá) vidí vše.
       AND (
         (ki.story_id IS NOT NULL AND v_story_ok)
         OR (ki.story_id IS NULL AND public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
         OR (SELECT public.is_admin_or_staff(v_audience_user))
       )
       -- Brick2-guard + P2: HARD model-identity filter (correctness, not a score term) — jméno
       -- modelu A identita vah vektoru = deklarovaná identita (fn_identita_vektoru, jeden domov).
       AND (p_query_model IS NULL OR ke.model_v2 = p_query_model)
       AND (p_query_model IS NULL OR public.fn_identita_vektoru(ke.model_v2_version) = v_identita)
       -- Brick6 tier-ACL: HARD filter — an under-tier audience user never retrieves a gated row.
       AND (ki.minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user))
       AND (1 - (ke.embedding_v2 <=> p_query_embedding_v2)) >= p_similarity_threshold
    ),
    winner AS (
      -- one winning variant (knowledge_item) per source-concept: the item owning the
      -- best (locale-boosted) chunk. Collapses cross-lingual near-duplicates.
      SELECT DISTINCT ON (s_concept) s_concept, s_item_id
      FROM scored ORDER BY s_concept, s_eff_dist ASC, s_item_id
    )
    SELECT s.s_item_id, s.s_chunk_id, s.s_chunk_text, s.s_chunk_slug, s.s_similarity,
           'v2'::text, s.s_chunk_locale
    FROM scored s
    JOIN winner w ON w.s_concept = s.s_concept AND w.s_item_id = s.s_item_id
    ORDER BY s.s_eff_dist ASC
    LIMIT p_limit;
  ELSE
    IF p_query_embedding_v1 IS NULL THEN
      RAISE EXCEPTION 'p_query_embedding_v1 is required when p_model_pref = v1';
    END IF;
    RETURN QUERY
    WITH scored AS (
      SELECT
        ke.knowledge_item_id AS s_item_id,
        ke.chunk_id AS s_chunk_id,
        kc.chunk_text AS s_chunk_text,
        (COALESCE(ki.source_slug, ki.id::text) || ':' || kc.chunk_index)::text AS s_chunk_slug,
        (1 - (ke.embedding <=> p_query_embedding_v1))::numeric AS s_similarity,
        kc.locale AS s_chunk_locale,
        -- COALESCE so a NULL source_concept_id (trigger-bypassed insert, bulk load, or a
        -- not-yet-backfilled row) degrades to "own item = its own concept" (a singleton, no
        -- dedup) instead of NULL — a NULL concept would drop the row at the winner JOIN.
        COALESCE(ki.source_concept_id, ki.id) AS s_concept,
        (ke.embedding <=> p_query_embedding_v1)
          - CASE WHEN p_locale IS NOT NULL AND kc.locale = p_locale THEN c_locale_boost ELSE 0 END AS s_eff_dist
      FROM public.knowledge_embeddings ke
      JOIN public.knowledge_chunks kc ON kc.id = ke.chunk_id
      JOIN public.knowledge_items ki ON ki.id = ke.knowledge_item_id
      LEFT JOIN public.guild_expertise_areas gea ON gea.id = ki.expertise_area_id
     WHERE ke.embedding IS NOT NULL
       AND ki.status = 'active'
       AND public.knowledge_state_readable(ki.quarantine_status)
       -- Prázdný seznam typů = bez filtru typu (jako ve v2). Volající přes MCP ho posílá,
       -- když typy nezadá; `= ANY('{}')` by odfiltrovalo všechno.
       AND (p_item_types IS NULL OR cardinality(p_item_types) = 0 OR ki.item_type::text = ANY(p_item_types))
       AND (p_category IS NULL OR ki.category = p_category)
       AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
       -- Úryvky instrukcí pro model jen na výslovné přání (NULL = ne, jako ve v2).
       AND (p_include_ai_instructions IS TRUE OR kc.source_field <> 'ai_instructions')
       -- Jen globální položky a položky hledaného příběhu — i u zásad a rysů osobnosti: výjimka
       -- podle typu bez podmínky na příběh pouštěla zásadu cizího příběhu (do 2026-10-04).
       AND (
         (p_story_id IS NULL AND ki.story_id IS NULL)
         OR (p_story_id IS NOT NULL AND (ki.story_id = p_story_id OR ki.story_id IS NULL))
       )
       -- Viditelnost globální položky jako ve v2 — jeden domov, pro toho, pro koho se hledá; zásady
       -- a rysy výjimku podle typu nemají. Položka příběhu jen s přístupem publika k příběhu. Bez
       -- `ki.story_id IS NULL` u viditelnosti by položku příběhu s viditelností `public` (výchozí
       -- hodnota sloupce) propustila i tomu, kdo k příběhu nesmí. Správa (podle koho se hledá) vidí vše.
       AND (
         (ki.story_id IS NOT NULL AND v_story_ok)
         OR (ki.story_id IS NULL AND public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
         OR (SELECT public.is_admin_or_staff(v_audience_user))
       )
       -- Brick2-guard + P2: HARD model-identity filter (correctness, not a score term) — jméno
       -- modelu A identita vah vektoru = deklarovaná identita (fn_identita_vektoru, jeden domov).
       AND (p_query_model IS NULL OR ke.model = p_query_model)
       AND (p_query_model IS NULL OR public.fn_identita_vektoru(ke.model_version) = v_identita)
       -- Brick6 tier-ACL: HARD filter — an under-tier audience user never retrieves a gated row.
       AND (ki.minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user))
       AND (1 - (ke.embedding <=> p_query_embedding_v1)) >= p_similarity_threshold
    ),
    winner AS (
      SELECT DISTINCT ON (s_concept) s_concept, s_item_id
      FROM scored ORDER BY s_concept, s_eff_dist ASC, s_item_id
    )
    SELECT s.s_item_id, s.s_chunk_id, s.s_chunk_text, s.s_chunk_slug, s.s_similarity,
           'v1'::text, s.s_chunk_locale
    FROM scored s
    JOIN winner w ON w.s_concept = s.s_concept AND w.s_item_id = s.s_item_id
    ORDER BY s.s_eff_dist ASC
    LIMIT p_limit;
  END IF;
END;
$function$
;

REVOKE ALL ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) TO service_role;
