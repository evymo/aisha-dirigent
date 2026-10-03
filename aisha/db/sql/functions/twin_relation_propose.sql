-- ============================================================================
-- Source of Truth: twin_relation_propose
-- Popis: Navrhovatel (zdroj, ingest, importér instančních dat) předá SKUPINU
--        návrhů hran mezi dvojčaty s důkazem. Nic se tu neotevírá — návrh
--        čeká na člověka (twin_relation_proposal_decide).
-- Bezpečnost: SECURITY DEFINER + service_role/admin/staff + REVOKE/GRANT.
--
-- Vstup:
--   p_group     {group_key, source, rule_key, title?, evidence?}
--   p_proposals [{proposal_key, source_twin_id, target_twin_id, relation_kind,
--                 valid_from?, confidence?, evidence?}]
--
-- Pravidla (každé z nich je měřené v src/tests/db/navrhy-vazeb.test.ts):
--   · IDEMPOTENCE: týž group_key / proposal_key trefí týž řádek. Instanční
--     data se přehrávají při KAŽDÉM nasazení, takže neidempotentní návrh by
--     frontu zdvojoval s každým deployem.
--   · ROZHODNUTÍ JE LEPKAVÉ: schválený ani zamítnutý návrh se neaktualizuje
--     a neoživuje. Lidské „ne" se nevrací (týž princip jako
--     twin_propose_identity_by_signals); počítá se do `decided_kept`.
--   · FAKT NEČEKÁ NA SCHVÁLENÍ: když hrana už platí, návrh se uloží jako
--     'superseded' s odkazem na ni — do fronty nepatří, není o čem rozhodovat.
--   · SKUPINA PATŘÍ SVÉMU ZDROJI: cizí zdroj skupinu nepřepíše a návrh nepřejde
--     do jiné skupiny — jinak by jeden navrhovatel mohl přepsat důkaz druhého.
--   · Vadný vstup PADÁ (22023), nic se tiše nepřeskakuje: tichý přeskok by
--     vypadal jako „nic k navržení".
--
-- Proč hook instančních dat smí volat: přehrává SQL jako `service_role`
-- (scripts/deploy/instance-data-hook.sh, PGOPTIONS role) — is_service_role()
-- tu cestu zná, takže importér nemusí opisovat pravidla do vlastního INSERTu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_relation_propose(
  p_group     jsonb,
  p_proposals jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key       text := nullif(btrim(p_group->>'group_key'), '');
  v_source    text := nullif(btrim(p_group->>'source'), '');
  v_rule      text := nullif(btrim(p_group->>'rule_key'), '');
  v_title     text := nullif(btrim(p_group->>'title'), '');
  v_gevidence jsonb := COALESCE(p_group->'evidence', '{}'::jsonb);
  v_group_id  uuid;
  v_owner     text;
  p           jsonb;
  v_pkey      text;
  v_src       uuid;
  v_tgt       uuid;
  v_kind      text;
  v_from      timestamptz;
  v_conf      numeric;
  v_ev        jsonb;
  v_old       public.twin_relation_proposals%ROWTYPE;
  v_rel       uuid;
  n_new       int := 0;
  n_upd       int := 0;
  n_same      int := 0;
  n_kept      int := 0;
  n_fact      int := 0;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'twin_relation_propose: service_role or admin/staff only'
      USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR v_source IS NULL OR v_rule IS NULL THEN
    RAISE EXCEPTION 'twin_relation_propose: group needs group_key, source and rule_key'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_proposals) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'twin_relation_propose: proposals must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  -- ── Skupina ────────────────────────────────────────────────────────────────
  -- ON CONFLICT místo „select, pak insert": dva souběžní navrhovatelé téhož
  -- klíče se jinak oba rozhodnou vložit a druhý spadne na unikátnosti.
  INSERT INTO public.twin_relation_proposal_groups (group_key, source, rule_key, title, evidence)
  VALUES (v_key, v_source, v_rule, v_title, v_gevidence)
  ON CONFLICT (group_key) DO NOTHING
  RETURNING id INTO v_group_id;

  IF v_group_id IS NULL THEN
    SELECT g.id, g.source INTO v_group_id, v_owner
      FROM public.twin_relation_proposal_groups g
     WHERE g.group_key = v_key
       FOR UPDATE;
    IF v_owner IS DISTINCT FROM v_source THEN
      RAISE EXCEPTION 'twin_relation_propose: skupina % patří zdroji %, ne %',
        v_key, v_owner, v_source
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.twin_relation_proposal_groups g
       SET rule_key = v_rule,
           title    = COALESCE(v_title, g.title),
           evidence = v_gevidence
     WHERE g.id = v_group_id
       AND (g.rule_key, g.title, g.evidence)
           IS DISTINCT FROM (v_rule, COALESCE(v_title, g.title), v_gevidence);
  END IF;

  -- ── Návrhy ────────────────────────────────────────────────────────────────
  FOR p IN SELECT value FROM jsonb_array_elements(p_proposals) LOOP
    v_pkey := nullif(btrim(p->>'proposal_key'), '');
    v_src  := nullif(p->>'source_twin_id', '')::uuid;
    v_tgt  := nullif(p->>'target_twin_id', '')::uuid;
    v_kind := nullif(btrim(p->>'relation_kind'), '');
    v_from := nullif(p->>'valid_from', '')::timestamptz;
    v_conf := nullif(p->>'confidence', '')::numeric;
    v_ev   := COALESCE(p->'evidence', '{}'::jsonb);

    IF v_pkey IS NULL OR v_src IS NULL OR v_tgt IS NULL OR v_kind IS NULL THEN
      RAISE EXCEPTION 'twin_relation_propose: návrh potřebuje proposal_key, source_twin_id, target_twin_id a relation_kind (%)',
        left(p::text, 200)
        USING ERRCODE = '22023';
    END IF;

    -- Hrana už platí → není o čem rozhodovat.
    SELECT r.id INTO v_rel
      FROM public.twin_relations r
     WHERE r.source_twin_id = v_src
       AND r.target_twin_id = v_tgt
       AND r.relation_kind  = v_kind
       AND r.valid_to IS NULL
     LIMIT 1;

    SELECT * INTO v_old
      FROM public.twin_relation_proposals x
     WHERE x.proposal_key = v_pkey
       FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.twin_relation_proposals
        (group_id, proposal_key, source_twin_id, target_twin_id, relation_kind,
         valid_from, confidence, evidence, state, relation_id)
      VALUES
        (v_group_id, v_pkey, v_src, v_tgt, v_kind, v_from, v_conf, v_ev,
         CASE WHEN v_rel IS NULL THEN 'proposed' ELSE 'superseded' END, v_rel);
      IF v_rel IS NULL THEN n_new := n_new + 1; ELSE n_fact := n_fact + 1; END IF;
      CONTINUE;
    END IF;

    IF v_old.group_id <> v_group_id THEN
      RAISE EXCEPTION 'twin_relation_propose: návrh % patří jiné skupině', v_pkey
        USING ERRCODE = '22023';
    END IF;

    IF v_old.state <> 'proposed' THEN
      n_kept := n_kept + 1;                 -- lepkavé rozhodnutí: nesahat
    ELSIF v_rel IS NOT NULL THEN
      UPDATE public.twin_relation_proposals
         SET state = 'superseded', relation_id = v_rel
       WHERE id = v_old.id;
      n_fact := n_fact + 1;
    ELSIF (v_old.source_twin_id, v_old.target_twin_id, v_old.relation_kind,
           v_old.valid_from, v_old.confidence, v_old.evidence)
          IS NOT DISTINCT FROM (v_src, v_tgt, v_kind, v_from, v_conf, v_ev) THEN
      n_same := n_same + 1;
    ELSE
      UPDATE public.twin_relation_proposals
         SET source_twin_id = v_src, target_twin_id = v_tgt, relation_kind = v_kind,
             valid_from = v_from, confidence = v_conf, evidence = v_ev
       WHERE id = v_old.id;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id',     v_group_id,
    'inserted',     n_new,
    'updated',      n_upd,
    'unchanged',    n_same,
    'decided_kept', n_kept,
    'already_fact', n_fact
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_relation_propose(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_relation_propose(jsonb, jsonb) TO authenticated, service_role;
