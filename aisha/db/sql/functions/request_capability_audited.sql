-- Function: public.request_capability_audited
--
-- Meta-nástroj smyčky samoučení (F4, MCP request_capability): agent v chatu nebo v IDE narazí na
-- otázku, na kterou nemá nástroj („Je IČO 27082440 platné?“), a místo vymýšlení odpovědi podá
-- NÁVRH schopnosti. Návrh jde do fronty správy (improvement_proposals), nikdy se sám neschválí.
--
-- ⛔ PROČ NE fn_create_improvement_proposal: ta je od K-15 jen pro službu a správu (u plně
--    autonomního agenta s nízkým rizikem by návrh rovnou auto-schválila). Tahle cesta je pro
--    uživatele a je užší: typ capability_request, stav pending_review, riziko high (výsledkem
--    je kód), žádné auto-schválení.
--
-- Pravidla (test src/tests/db/schopnost-navrh-a-most.runtime.test.ts):
--   - přihlášený uživatel; capability = slug budoucího nástroje (snake_case);
--   - důkaz: p_run_id, pokud je, musí být běh, který volající smí číst (fn_user_can_read_run) —
--     jinak by si kdokoli připnul cizí běh/trace jako „důkaz“;
--   - příběh: p_story_id, pokud je, musí volající smět ZAPISOVAT (can_access_story, p_for_write) —
--     most ho předá běhu Claude jako příběh, takže cizí příběh by běh do cizí story připnul;
--   - schopnost, která už existuje jako aktivní nástroj (agent_tools), návrh nezakládá;
--   - týž slug s otevřeným návrhem = tentýž návrh (anomaly_key), ne nový;
--   - strop 5 žádostí za hodinu na uživatele;
--   - otázka a důvod jsou NEDŮVĚRYHODNÝ text uživatele/modelu — ukládají se jako data, prompt
--     běhu je cituje jako data (fn_spawn_capability_run_admin).
--
-- Security: SECURITY DEFINER (tabulka návrhů je jen pro správu), authenticated.

CREATE OR REPLACE FUNCTION public.request_capability_audited(
  p_capability text,
  p_question   text,
  p_reason     text DEFAULT NULL,
  p_run_id     uuid DEFAULT NULL,
  p_story_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_klic        text;
  v_existujici  uuid;
  v_nastroj     uuid;
  v_existujici_autor uuid;
  v_za_hodinu   int;
  v_navrh       uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_capability IS NULL OR p_capability !~ '^[a-z][a-z0-9_]{2,62}$' THEN
    RAISE EXCEPTION 'capability must be a snake_case tool name (3–63 chars)' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_question, '')), '') IS NULL OR length(p_question) > 2000 THEN
    RAISE EXCEPTION 'question must be 1–2000 characters' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'reason must be at most 2000 characters' USING ERRCODE = '22023';
  END IF;

  IF p_run_id IS NOT NULL AND public.fn_user_can_read_run(v_caller, p_run_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: run is not readable by the caller' USING ERRCODE = '42501';
  END IF;
  IF p_story_id IS NOT NULL AND public.can_access_story(p_story_id, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: story access denied' USING ERRCODE = '42501';
  END IF;

  SELECT t.id INTO v_nastroj
  FROM public.agent_tools t
  WHERE t.name = p_capability AND t.is_active;
  IF v_nastroj IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'exists', 'capability', p_capability);
  END IF;

  v_klic := 'capability:' || p_capability;
  -- Serialize both the per-user quota and cross-user slug deduplication.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('capability-user:' || v_caller::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_klic, 0));
  SELECT ip.id, ip.created_by INTO v_existujici, v_existujici_autor
  FROM public.improvement_proposals ip
  WHERE ip.anomaly_key = v_klic
    AND ip.status IN ('draft', 'pending', 'pending_review', 'approved', 'auto_approved', 'in_progress')
  LIMIT 1;
  IF v_existujici IS NOT NULL THEN
    RETURN jsonb_strip_nulls(jsonb_build_object('status', 'already_requested',
      'proposal_id', CASE WHEN v_existujici_autor = v_caller THEN v_existujici END, 'capability', p_capability));
  END IF;

  SELECT count(*) INTO v_za_hodinu
  FROM public.improvement_proposals ip
  WHERE ip.created_by = v_caller
    AND ip.proposal_type = 'capability_request'
    AND ip.created_at > now() - interval '1 hour';
  IF v_za_hodinu >= 5 THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'capability', p_capability);
  END IF;

  INSERT INTO public.improvement_proposals (
    proposal_type, status, title, description, rationale, source, agent_slug, category,
    risk_level, created_by, run_id, anomaly_key, proposed_value, metadata
  ) VALUES (
    'capability_request',
    'pending_review',
    'Chybí schopnost: ' || p_capability,
    btrim(p_question),
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    'request_capability',
    NULL, -- human request; no instance-specific agent_catalog row is required
    'capability',
    'high',
    v_caller,
    p_run_id,
    v_klic,
    jsonb_build_object('capability', p_capability),
    jsonb_build_object(
      'capability', p_capability,
      'question', btrim(p_question),
      'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
      'evidence_run_id', p_run_id,
      'story_id', p_story_id,
      'requested_by', v_caller,
      'untrusted_fields', jsonb_build_array('question', 'reason')
    )
  )
  RETURNING id INTO v_navrh;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'admin'::public.journal_area,
    p_details := jsonb_build_object('proposal_id', v_navrh, 'capability', p_capability, 'evidence_run_id', p_run_id),
    p_entity_id := v_navrh::text,
    p_entity_type := 'improvement_proposals',
    p_severity := 'info'::public.journal_severity,
    p_summary := 'capability requested: ' || p_capability,
    p_user_id := v_caller
  );

  RETURN jsonb_build_object('status', 'proposed', 'proposal_id', v_navrh, 'capability', p_capability);
END;
$$;

REVOKE ALL ON FUNCTION public.request_capability_audited(text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_capability_audited(text, text, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_capability_audited(text, text, text, uuid, uuid) TO authenticated;
