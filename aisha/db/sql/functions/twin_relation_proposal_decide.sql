-- ============================================================================
-- Source of Truth: twin_relation_proposal_decide
-- Popis: Člověk rozhodne SKUPINU návrhů hran (schválit / zamítnout). Schválení
--        otevře hrany; zamítnutí je lepkavé (navrhovatel ho nepřepíše).
-- Bezpečnost: SECURITY DEFINER + admin/staff S IDENTITOU + REVOKE/GRANT.
--
-- ⭐ JEDNOTKOU ROZHODNUTÍ JE SKUPINA (majitel 2026-09-28: „po skupinách").
-- Rozhoduje se o členech, kteří v tu chvíli ČEKAJÍ — návrh, který navrhovatel
-- přidá až po kliknutí, se schválením neprotlačí (neviděl ho nikdo), zůstane ve
-- frontě jako další otázka téže skupiny.
--
-- ⭐ HRANU OTEVÍRÁ twin_relation_open_admin, ne vlastní INSERT. Je to jediné
-- ruční zápisové místo hran: nese pravidlo překryvu (EXCLUDE → čitelná chyba)
-- a auditní stopu per hrana. Druhá cesta by dřív nebo později pravidla rozvedla.
--
-- Návrh, jehož hrana MEZITÍM začala platit (otevřel ji někdo ručně), se uzavře
-- jako 'superseded' s odkazem na ni — ne jako chyba a ne jako druhá kopie.
-- Návrh v KONFLIKTU (překryv s jinou platností téže hrany) zůstane čekat
-- a počítá se do `conflicts`: rozhodnout ho znamená nejdřív uzavřít starou hranu,
-- a to je vědomý úkon, ne vedlejší účinek hromadného kliknutí.
--
-- Rozhoduje ČLOVĚK: service_role sem nesmí. Ratifikace, kterou udělá stroj,
-- by z návrhu udělala fakt bez člověka — přesně to, co tahle vrstva odděluje.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_relation_proposal_decide(
  p_group_id uuid,
  p_decision text,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  g       public.twin_relation_proposal_groups%ROWTYPE;
  p       record;
  v_rel   uuid;
  v_res   jsonb;
  n_app   int := 0;
  n_rej   int := 0;
  n_fact  int := 0;
  n_conf  int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_relation_proposal_decide: rozhoduje přihlášený správce (admin/staff)'
      USING ERRCODE = '42501';
  END IF;
  -- Výčet je UZAVŘENÝ v obou směrech: překlep nesmí vazbu ani otevřít, ani
  -- tiše zamítnout (týž princip jako větev twin_identity v dispečeru).
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'twin_relation_proposal_decide: neznámé rozhodnutí % (approved|rejected)', p_decision
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO g
    FROM public.twin_relation_proposal_groups
   WHERE id = p_group_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'twin_relation_proposal_decide: skupina % neexistuje', p_group_id
      USING ERRCODE = 'P0002';
  END IF;

  FOR p IN
    SELECT x.id, x.source_twin_id, x.target_twin_id, x.relation_kind, x.valid_from, x.confidence
      FROM public.twin_relation_proposals x
     WHERE x.group_id = p_group_id AND x.state = 'proposed'
     ORDER BY x.id
       FOR UPDATE
  LOOP
    IF p_decision = 'rejected' THEN
      UPDATE public.twin_relation_proposals
         SET state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = p_note
       WHERE id = p.id;
      n_rej := n_rej + 1;
      CONTINUE;
    END IF;

    SELECT r.id INTO v_rel
      FROM public.twin_relations r
     WHERE r.source_twin_id = p.source_twin_id
       AND r.target_twin_id = p.target_twin_id
       AND r.relation_kind  = p.relation_kind
       AND r.valid_to IS NULL
     LIMIT 1;
    IF v_rel IS NOT NULL THEN
      UPDATE public.twin_relation_proposals
         SET state = 'superseded', relation_id = v_rel,
             decided_by = v_uid, decided_at = now(), decision_note = p_note
       WHERE id = p.id;
      n_fact := n_fact + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_res := public.twin_relation_open_admin(
        p.source_twin_id, p.target_twin_id, p.relation_kind,
        COALESCE(p.valid_from, now()),
        jsonb_build_object(
          'proposal_id', p.id,
          'group_id',    g.id,
          'group_key',   g.group_key,
          'rule_key',    g.rule_key,
          'proposed_by', g.source,
          'confidence',  p.confidence,
          'approved_by', v_uid));
      UPDATE public.twin_relation_proposals
         SET state = 'approved', relation_id = (v_res->>'relation_id')::uuid,
             decided_by = v_uid, decided_at = now(), decision_note = p_note
       WHERE id = p.id;
      n_app := n_app + 1;
    EXCEPTION WHEN exclusion_violation THEN
      n_conf := n_conf + 1;                 -- zůstává 'proposed'
    END;
  END LOOP;

  PERFORM public.write_audit_journal(
    p_action_type := (CASE WHEN p_decision = 'approved' THEN 'approve' ELSE 'reject' END)::journal_action_type,
    p_area        := 'system'::journal_area,
    p_details     := jsonb_build_object(
      'group_id',     g.id,
      'group_key',    g.group_key,
      'rule_key',     g.rule_key,
      'source',       g.source,
      'decision',     p_decision,
      'approved',     n_app,
      'rejected',     n_rej,
      'already_fact', n_fact,
      'conflicts',    n_conf),
    p_entity_id   := g.id::text,
    p_entity_type := 'twin_relation_proposal_group',
    p_summary     := 'twin relation proposals decided',
    p_user_id     := v_uid
  );

  RETURN jsonb_build_object(
    'group_id',     g.id,
    'decision',     p_decision,
    'approved',     n_app,
    'rejected',     n_rej,
    'already_fact', n_fact,
    'conflicts',    n_conf
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_relation_proposal_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_relation_proposal_decide(uuid, text, text) TO authenticated;
