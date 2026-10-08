-- Function: public.add_story_knowledge_audited
--
-- Zápis znalosti do příběhu POD IDENTITOU UŽIVATELE (MCP nástroj add_knowledge, F2 smyčky
-- samoučení). Člověk nebo jeho agent v IDE/chatu zapíše, co se naučil, k příběhu, na kterém
-- pracuje; AISHA to po lidském ověření najde při hledání.
--
-- ⛔ PROČ NOVÁ FUNKCE (naměřeno 2026-10-07, mapa F2): jediná zápisová cesta knowledge_items
--    s příběhem (upsert_story_knowledge_item_audited) je jen pro správu/službu;
--    create_knowledge_post_audited píše diskusní příspěvek tématu, fn_capture_learning paměť
--    agenta vázanou na běh. Účastník příběhu neměl jak znalost zapsat.
--
-- Pravidla (každé má test v src/tests/db/znalost-z-mcp.runtime.test.ts):
--   - PŘÍBĚH: volající ho musí smět ZAPISOVAT — stejný nárok jako create_story_entry_audited
--     (partner příběhu, účastník owner/collaborator/agent_supervisor, vlastník, správa), ALE bez
--     otevřeného zápisu do výchozí story stacku: znalost tam není záznam editoru, je to obsah,
--     který by jinak mohl kdokoli přihlášený podstrčit. viewer je jen ke čtení.
--   - VIDITELNOST 'private': položku příběhu čte napřímo jen vlastník a účastník
--     (knowledge_items_story_participants_read); 'private' zajistí, že ji funkce hledání
--     nevydají nikomu dalšímu ani u výchozí story (knowledge_visibility_searchable).
--   - K OVĚŘENÍ: quarantine_status 'flagged' + značka ceka_na_cloveka. Čtení agentovi vydá jen
--     čitelný stav (knowledge_state_readable: clear/reviewed/reinstated), takže položka do
--     hledání nevstoupí, dokud ji správa neuvolní (fn_reinstate_knowledge_item_audited).
--     Automatický sken (fn_record_safety_scan_audited) ji na 'clear' NEPUSTÍ — viz značka.
--   - OBSAH je nedůvěryhodný vstup: typy jen dokumentační (žádné expert_rule, rysy, hodnoty),
--     žádné ai_instructions, délky omezené. Vektor dopočítá trigger trg_knowledge_embedding_auto.
--
-- Security: SECURITY DEFINER (RLS knowledge_items zápis uživateli nedává), authenticated.

CREATE OR REPLACE FUNCTION public.add_story_knowledge_audited(
  p_story_id        uuid,
  p_title           text,
  p_body_markdown   text,
  p_item_type       text DEFAULT 'case_study',
  p_summary         text DEFAULT NULL,
  p_ai_context_tags text[] DEFAULT '{}'::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller             uuid := auth.uid();
  v_partner_id         uuid;
  v_story_partner_id   uuid;
  v_story_owner_id     uuid;
  v_participant_role   text;
  v_item_id            uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL OR length(p_title) > 300 THEN
    RAISE EXCEPTION 'title must be 1–300 characters' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_body_markdown, '')), '') IS NULL OR length(p_body_markdown) > 20000 THEN
    RAISE EXCEPTION 'body must be 1–20000 characters' USING ERRCODE = '22023';
  END IF;
  IF p_summary IS NOT NULL AND length(p_summary) > 1000 THEN
    RAISE EXCEPTION 'summary must be at most 1000 characters' USING ERRCODE = '22023';
  END IF;
  -- Jen dokumentační typy: expert_rule / personality_trait / core_value řídí chování agenta.
  IF p_item_type IS NULL OR p_item_type NOT IN ('engineering_doc', 'domain_doc', 'playbook', 'case_study') THEN
    RAISE EXCEPTION 'item_type must be engineering_doc, domain_doc, playbook or case_study' USING ERRCODE = '22023';
  END IF;
  IF cardinality(COALESCE(p_ai_context_tags, '{}'::text[])) > 20 OR EXISTS (
    SELECT 1 FROM unnest(p_ai_context_tags) tag
    WHERE tag IS NULL OR length(btrim(tag)) NOT BETWEEN 1 AND 100
  ) THEN
    RAISE EXCEPTION 'at most 20 nonempty context tags, each at most 100 characters' USING ERRCODE = '22023';
  END IF;

  SELECT ps.partner_id, ps.user_id
  INTO v_story_partner_id, v_story_owner_id
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found' USING ERRCODE = 'P0002';
  END IF;

  v_partner_id := public.get_current_partner_id();

  -- Nejširší vazba volajícího k příběhu (PK story_participants je (story_id, user_id, role)).
  SELECT sp.role::text
  INTO v_participant_role
  FROM public.story_participants sp
  WHERE sp.story_id = p_story_id
    AND sp.user_id = v_caller
  ORDER BY CASE sp.role::text
             WHEN 'owner' THEN 0
             WHEN 'agent_supervisor' THEN 1
             WHEN 'collaborator' THEN 2
             ELSE 3
           END
  LIMIT 1;

  IF v_participant_role = 'viewer' THEN
    RAISE EXCEPTION 'Unauthorized: viewer role is read-only' USING ERRCODE = '42501';
  END IF;

  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    NULL; -- partner příběhu
  ELSIF v_participant_role IN ('owner', 'collaborator', 'agent_supervisor') THEN
    NULL;
  ELSIF v_story_owner_id = v_caller THEN
    NULL;
  ELSIF public.is_admin_or_staff(v_caller) THEN
    NULL;
  ELSE
    -- Včetně výchozí story stacku bez vazby (viz hlavička).
    RAISE EXCEPTION 'Unauthorized: Story access denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.knowledge_items (
    item_type, source_type, title, summary, body_markdown, ai_context_tags,
    visibility, story_id, author_id, status, locale,
    quarantine_status, quarantine_reason, quarantine_metadata
  ) VALUES (
    p_item_type::public.knowledge_item_type,
    'mcp_user',
    btrim(p_title),
    NULLIF(btrim(COALESCE(p_summary, '')), ''),
    p_body_markdown,
    COALESCE(p_ai_context_tags, '{}'::text[]),
    'private',
    p_story_id,
    v_caller,
    'active',
    'global',
    'flagged',
    'k_overeni: zapsáno nástrojem add_knowledge pod identitou uživatele (nedůvěryhodný vstup)',
    jsonb_build_object('ceka_na_cloveka', true, 'zdroj', 'mcp', 'nastroj', 'add_knowledge', 'autor', v_caller)
  )
  RETURNING id INTO v_item_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := jsonb_build_object('item_id', v_item_id, 'story_id', p_story_id, 'item_type', p_item_type,
                                    'quarantine_status', 'flagged'),
    p_entity_id := v_item_id::text,
    p_entity_type := 'knowledge_items',
    p_severity := 'info'::public.journal_severity,
    p_summary := 'knowledge item added via MCP (awaiting human review)',
    p_user_id := v_caller
  );

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_story_knowledge_audited(uuid, text, text, text, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_story_knowledge_audited(uuid, text, text, text, text, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_story_knowledge_audited(uuid, text, text, text, text, text[]) TO authenticated;
