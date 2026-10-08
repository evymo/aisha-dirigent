-- Function: public.fn_capability_replay_admin
--
-- Konec smyčky schopnosti (F4): když člověk nástroj zaregistroval (upsert_agent_tool_admin) a
-- běh i CI jsou za ním, správa návrh uzavře a vyžádá si REPLAY původní otázky. Funkce:
--   - ověří, že návrh je capability_request ve stavu approved/in_progress;
--   - ověří úspěšný, schválený běh této schopnosti; CI a kontrolu PR před registrací ověřuje člověk;
--   - ověří, že nástroj `capability` je v registru AKTIVNÍ — bez registrace replay nedává smysl
--     a návrh by „aplikováno“ hlásil bez jediné změny (poučení K-05 v approve_improvement_…);
--   - návrh přepne na 'applied' (applied_at, outcome s id nástroje);
--   - ohlásí replay na kanálu `capability_replay` (jen id, žádný text otázky — ten je
--     nedůvěryhodný a čte ho až příjemce z návrhu) a vrátí podklad replaye volajícímu
--     (Mission Control otázku pošle do chatu příběhu).
--
-- Kdo replay v chatu provede, je mimo tuto funkci (kanál nebo tlačítko MC).
--
-- Security: SECURITY DEFINER, admin/staff.

CREATE OR REPLACE FUNCTION public.fn_capability_replay_admin(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_navrh   record;
  v_nastroj uuid;
BEGIN
  IF public.is_admin_or_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_navrh
  FROM public.improvement_proposals
  WHERE id = p_proposal_id
    AND proposal_type = 'capability_request'
    AND status IN ('approved', 'in_progress')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'capability proposal not found or not in approved/in_progress' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.id = NULLIF(v_navrh.metadata->>'agent_run_id', '')::uuid
      AND r.kind = 'claude_cli_task' AND r.status = 'succeeded' AND r.exit_code = 0
      AND r.approved_at IS NOT NULL
      AND r.inputs->>'capability_proposal_id' = p_proposal_id::text
  ) THEN
    RAISE EXCEPTION 'capability run has not completed successfully with approval' USING ERRCODE = 'P0002';
  END IF;

  SELECT t.id INTO v_nastroj
  FROM public.agent_tools t
  WHERE t.name = v_navrh.metadata->>'capability' AND t.is_active;
  IF v_nastroj IS NULL THEN
    RAISE EXCEPTION 'capability % is not registered as an active tool yet', v_navrh.metadata->>'capability'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.improvement_proposals
  SET status = 'applied',
      applied_at = now(),
      outcome = COALESCE(outcome, '{}'::jsonb) || jsonb_build_object('tool_id', v_nastroj, 'replay_requested_at', now(),
                                                                     'replay_requested_by', auth.uid()),
      updated_at = now()
  WHERE id = p_proposal_id;

  PERFORM pg_notify('capability_replay', jsonb_build_object(
    'proposal_id', p_proposal_id,
    'tool_id', v_nastroj,
    'story_id', v_navrh.metadata->>'story_id',
    'evidence_run_id', v_navrh.run_id
  )::text);

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'admin'::public.journal_area,
    p_details := jsonb_build_object('proposal_id', p_proposal_id, 'tool_id', v_nastroj),
    p_entity_id := p_proposal_id::text,
    p_entity_type := 'improvement_proposals',
    p_severity := 'info'::public.journal_severity,
    p_summary := 'capability applied, replay requested: ' || (v_navrh.metadata->>'capability'),
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object(
    'proposal_id', p_proposal_id,
    'capability', v_navrh.metadata->>'capability',
    'tool_id', v_nastroj,
    'question', v_navrh.metadata->>'question',
    'story_id', v_navrh.metadata->>'story_id',
    'evidence_run_id', v_navrh.run_id,
    'untrusted_fields', jsonb_build_array('question')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_capability_replay_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_capability_replay_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_capability_replay_admin(uuid) TO authenticated;
