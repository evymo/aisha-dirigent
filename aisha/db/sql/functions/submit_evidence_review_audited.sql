-- The workbench "příprava" (preparation) WRITE path — the human-in-the-loop
-- confirmation of extracted evidence. Legal content is never authoritative without
-- a human (evidence doctrine). Single fixed audited RPC; the platform is the single
-- writer (the local box only produces files).
--
-- Authorization: REVIEWER (is_admin_or_staff), NOT service_role — this is a user
-- action, exactly the role li_* RLS admits for SELECT. SECURITY DEFINER so it can
-- flip the candidate_status after the role gate; fail-closed on unknown role/kind.
--
-- Dispatch on p_entity_kind (v1 scope = what the li_* silo natively models):
--   'obligation' -> li_obligations.candidate_status  (p_entity_id = li_obligations.id)
--        'HUMAN_CONFIRMED' promotes; anything else -> 'REJECTED'. An obligation is
--        never silently promoted — the CHECK constraint enforces the vocabulary.
--   'workflow_step' -> delegates to complete_workflow_step (p_entity_id = step id).
--        ⚠️ This branch is NOT reviewer-gated, and that is the point. A field worker
--        confirming his own milestone is not a back-office reviewer: authorization is
--        the milestone's OWN predicate (assignment · role · confirmed twin binding),
--        which complete_workflow_step already applies and which is STRICTER than
--        is_admin_or_staff for this case. The role gate therefore moved below the
--        dispatch instead of guarding the whole function — without that move the only
--        client able to press a queue button (the web shell hardwires this RPC) could
--        never complete a milestone, because a driver is not admin/staff.
--        A non-approving decision is recorded as a DEVIATION, which sets the step to
--        'failed' and raises a nudge — the milestone genuinely did not happen, so it
--        must not read as completed.
--
-- p_evidence — what only a person standing at the tailgate can supply (who took
-- delivery, their signature). It exists because the client USED to bypass this
-- function for exactly that reason: the dispatcher carried four scalars, and
-- complete_workflow_step carried jsonb, so the shell called complete_workflow_step
-- directly — and the one write with legal weight was the one write that produced no
-- audit_journal row, while the ordinary obligation review produced one. The evidence
-- now rides along and the bypass is gone.
--
-- The key set is CLOSED and an unknown key RAISES. Same reasoning as
-- surface_audience_allows: a payload the server does not understand must not be
-- stored as if it were understood, or the first typo becomes silent data loss.
--
-- POSITION IS NEVER TAKEN FROM THE CLIENT. A coordinate supplied by the party being
-- documented is not evidence, and browser geolocation reports the driver's phone, not
-- the vehicle. It is derived here from what the run already knows — the arrival signal
-- that completed the transport milestone, and failing that the telematics track of the
-- vehicle that signal names. When neither answers, geo_source says 'unavailable' and
-- that is an honest gap, not a blank field pretending to be a measurement.
--
-- 'twin_identity' -> twin_identity_confirm_binding / twin_identity_reject_binding
--        (p_entity_id = twin_external_refs.id, state='proposed'). Human ratification of a
--        cross-source identity proposal — e.g. a Raynet contact proposed onto an existing
--        twin. Added 2026-09-15: the review_queue blocks (get_twin_ref_review_block,
--        get_twin_identity_queue) advertised confirm/reject, but this dispatcher raised
--        22023 on the kind, so nobody could decide a single proposal from the surface.
--        Reviewer-gated like obligation (the binding functions re-check it and require a
--        real auth.uid()). The decision vocabulary is CLOSED in BOTH directions: a typo
--        must neither confirm an identity nor silently reject it, so an unknown decision
--        raises instead of falling through to reject (unlike obligation, a rejected
--        binding is a verdict on a person's identity). A key already confirmed to ANOTHER
--        twin is NOT superseded from here — that handover stays a deliberate act
--        (twin_identity_confirm_binding p_supersede) and the error surfaces to the user.
-- 'twin_relation' -> twin_relation_proposal_decide (p_entity_id =
--        twin_relation_proposal_groups.id). Human ratification of a GROUP of proposed
--        edges between twins — the system proposes links across sources, a person
--        approves them (owner 2026-09-28, decided per group). Reviewer-gated; the
--        decide function re-checks it and requires a real auth.uid(). Closed
--        vocabulary both ways, like twin_identity.
-- 'twin_identity_group' -> twin_ref_group_decide (p_entity_id = id skupiny z
--        get_twin_ref_group_block). Hromadné schválení třídy shody dvou nezávislých
--        zdrojů pravdy (majitel 2026-09-28); jen 'confirmed', po položkách touž
--        ratifikací, deník twin_ref_davky, vrácení twin_ref_davka_vratit.
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-18): poloha TABLETU smí přijít jako `device_position`,
-- ale uloží se jako `device_geo` VEDLE odvozené `geo`, nikdy místo ní. Je to další
-- metainformace k záznamu — shoda dvou nezávislých zdrojů (`agreement_m`) zvyšuje
-- důvěryhodnost v čase a místě; tvrzení zařízení samo o sobě důkazem není, a proto
-- `geo` zůstává jen odvozená. Tvar a výpočet shody drží evidence_device_geo.
--
-- 'document'/'extraction' are intentionally NOT accepted yet: li_source_registry has
-- no human-review column (its status is the ingest completeness signal AUTO_PASS/
-- REVIEW, not a human verdict). Promoting a whole document's extraction needs a
-- schema column that does not exist; faking it via status would conflate ingest
-- completeness with human review. Deferred to a follow-up that adds the column —
-- until then this fails closed rather than mutating the wrong meaning.

-- p_occurred_at — KDY SE TO STALO V TERÉNU, ne kdy to doletělo. Řidič potvrdí
-- předání v lomu bez signálu a telefon se sync-ne o hodinu později; bez tohohle
-- parametru by se do evidence zapsal čas synchronizace, tedy údaj o naší síti
-- místo údaje o dodávce. Kontrakt DocumentStateChange to říká výslovně a
-- complete_workflow_step to už umí — jen sem ta cesta nevedla, takže offline
-- fronta neměla jak pravdivý čas doručit. NULL = teď (online potvrzení).
create or replace function public.submit_evidence_review_audited(
  p_entity_kind text,
  p_entity_id   uuid,
  p_decision    text,
  p_note        text default null,
  p_evidence    jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', pg_temp
as $$
declare
  v_status    text;
  v_hit       boolean := false;
  v_step      jsonb;
  v_ev        jsonb   := coalesce(p_evidence, '{}'::jsonb);
  v_stray     text;
  v_signature text;
  v_recipient text;
  v_geo       jsonb;
  v_dev_geo   jsonb;
  v_count     integer;
  v_example   jsonb;
begin
  -- Milestone branch first: it carries its own, stricter authorization (see header).
  if p_entity_kind = 'workflow_step' then
    -- Closed key set. An unknown key is a caller mistake, and storing it silently
    -- would make the mistake permanent and invisible.
    select string_agg(k, ', ') into v_stray
      from jsonb_object_keys(v_ev) k
     where k not in ('recipient', 'signature', 'device_position');
    if v_stray is not null then
      raise exception 'unknown evidence key(s): % (allowed: recipient, signature, device_position)', v_stray
        using errcode = '22023';
    end if;

    v_recipient := nullif(btrim(coalesce(v_ev->>'recipient', '')), '');
    v_signature := nullif(v_ev->>'signature', '');

    -- A signature pad produces tens of kilobytes. Anything far above that is either a
    -- photo in the wrong field or an attempt to use jsonb as a file store; both are
    -- refused here rather than TOASTed into the row that the queue reads every load.
    if v_signature is not null and octet_length(v_signature) > 262144 then
      raise exception 'signature too large (% bytes, limit 262144)', octet_length(v_signature)
        using errcode = '22023';
    end if;
    if v_signature is not null and v_signature not like 'data:image/%' then
      raise exception 'signature must be an image data URI' using errcode = '22023';
    end if;

    v_geo := public.workflow_step_derived_position(p_entity_id);
    -- Validuje se PŘED complete_workflow_step: vadný tvar nesmí nechat krok hotový
    -- bez evidence, kterou klient poslal.
    v_dev_geo := public.evidence_device_geo(v_ev->'device_position', v_geo);

    v_step := public.complete_workflow_step(
      p_step_id       => p_entity_id,
      p_output_data   => jsonb_strip_nulls(jsonb_build_object(
                           'decision', p_decision, 'note', p_note,
                           'via', 'surface_review_queue',
                           'recipient', v_recipient,
                           'signature', v_signature,
                           'geo', v_geo,
                           'device_geo', v_dev_geo)),
      p_notes         => p_note,
      p_has_deviation => (p_decision <> 'HUMAN_CONFIRMED'),
      p_occurred_at   => p_occurred_at);

    -- complete_workflow_step reports refusal as {ok:false,...} with HTTP 200, so a
    -- silent no-op would look like success to the client. Turn it into an error.
    if not coalesce((v_step->>'ok')::boolean, false) then
      raise exception 'milestone not completed: %', coalesce(v_step->>'error', 'unknown')
        using errcode = '42501';
    end if;

    -- The audit row records that a signature was taken and how big it was, never the
    -- image: audit_journal is read far more often than the evidence is, and a page of
    -- base64 in every row makes the journal unreadable for the case it exists to serve.
    insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'content', 'info',
            array['surface', 'write', 'workflow'],
            jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                               'decision', p_decision, 'status', v_step->>'status',
                               'note', p_note, 'recipient', v_recipient,
                               'signature_bytes', coalesce(octet_length(v_signature), 0),
                               'geo_source', v_geo->>'geo_source',
                               'device_geo_source', v_dev_geo->>'geo_source',
                               'geo_agreement_m', v_dev_geo->'agreement_m')
            -- F2: odbavení z tabletu nese ověřený kid (na kterém tabletu k předání došlo).
            || case when public.current_device_kid() is null then '{}'::jsonb
                    else jsonb_build_object('device_kid', public.current_device_kid()) end);

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'geo_source',  v_geo->>'geo_source',
      'device_geo_source', v_dev_geo->>'geo_source',
      'state',       coalesce(v_step->>'status', 'unknown'));
  end if;

  if jsonb_strip_nulls(v_ev) <> '{}'::jsonb then
    raise exception 'p_evidence is only accepted for entity_kind ''workflow_step'''
      using errcode = '22023';
  end if;

  if not public.is_admin_or_staff() then
    raise exception 'reviewer role required' using errcode = '42501';
  end if;

  if p_entity_kind = 'twin_identity' then
    if p_decision in ('confirmed', 'approved', 'HUMAN_CONFIRMED') then
      v_step := public.twin_identity_confirm_binding(p_entity_id);
      v_status := 'confirmed';
    elsif p_decision in ('rejected', 'REJECTED', 'HUMAN_REJECTED') then
      v_step := public.twin_identity_reject_binding(p_entity_id, p_note);
      v_status := 'rejected';
    else
      raise exception 'decision % not recognised for twin_identity (confirmed | rejected)', p_decision
        using errcode = '22023';
    end if;

    insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'content', 'info',
            array['surface', 'write', 'twin_identity'],
            -- Bez source_key: to je PII (týž důvod jako v twin_identity_list_unmatched).
            jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                               'decision', p_decision, 'status', v_status, 'note', p_note));

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'state',       v_status,
      'binding',     v_step);
  end if;

  -- Relation-proposal branch (2026-09-28): a person decides a GROUP of proposed
  -- twin edges (p_entity_id = twin_relation_proposal_groups.id). The group is the
  -- unit of decision (owner: „po skupinách"); twin_relation_proposal_decide opens
  -- the approved edges through twin_relation_open_admin and writes its own audit
  -- row per group. The decision vocabulary is CLOSED in both directions, exactly as
  -- for twin_identity: a typo must neither open edges nor silently reject them.
  if p_entity_kind = 'twin_relation' then
    if p_decision in ('confirmed', 'approved', 'HUMAN_CONFIRMED') then
      v_step := public.twin_relation_proposal_decide(p_entity_id, 'approved', p_note);
      v_status := 'approved';
    elsif p_decision in ('rejected', 'REJECTED', 'HUMAN_REJECTED') then
      v_step := public.twin_relation_proposal_decide(p_entity_id, 'rejected', p_note);
      v_status := 'rejected';
    else
      raise exception 'decision % not recognised for twin_relation (approved | rejected)', p_decision
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'state',       v_status,
      'result',      v_step);
  end if;

  -- Skupina návrhů identit (get_twin_ref_group_block): položka fronty = celá třída
  -- shody dvou nezávislých zdrojů. twin_ref_group_decide skupinu najde v datech bloku,
  -- třídu spočítá znovu a každou položku schválí touž ratifikací jako výš (majitel
  -- 2026-09-28: hromadně jen se shodou dvou zdrojů pravdy; vratné přes batch_id).
  if p_entity_kind = 'twin_identity_group' then
    v_step := public.twin_ref_group_decide(p_entity_id, p_decision, p_note);

    insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'content', 'info',
            array['surface', 'write', 'twin_identity'],
            jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                               'decision', p_decision, 'batch_id', v_step->>'batch_id',
                               'potvrzeno', v_step->'potvrzeno', 'chyba', v_step->'chyba',
                               'note', p_note));

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'state',       'confirmed',
      'batch',       v_step);
  end if;

  -- Flow-map branch: ratifying a node the ingest MEASURED and proposed inactive
  -- (propose_production_flow_node). Approval is what puts a node into production —
  -- it is the human act the proposal verb deliberately cannot perform.
  --
  -- A rejection does NOT delete the row and does NOT reopen next drain: the verdict
  -- is written onto the proposal, and the queue below filters on its absence. Without
  -- that, every re-drain would resurrect what a person already dismissed and the queue
  -- would never converge — the reviewer would re-decide the same 400 places forever.
  -- (Fresh evidence still refreshes `measured`; the verdict survives it.)
  if p_entity_kind = 'flow_node' then
    update public.production_flow_nodes
       set is_active = (p_decision in ('confirmed', 'approved', 'HUMAN_CONFIRMED')),
           metadata   = coalesce(metadata, '{}'::jsonb)
                        || jsonb_build_object('proposal',
                             coalesce(metadata->'proposal', '{}'::jsonb)
                             || jsonb_build_object(
                                  'decision',    case when p_decision in ('confirmed', 'approved', 'HUMAN_CONFIRMED')
                                                      then 'approved' else 'rejected' end,
                                  'decided_by',  auth.uid(),
                                  'decided_at',  now(),
                                  'decided_note', p_note)),
           updated_at = now()
     where id = p_entity_id
    returning is_active into v_hit;

    if v_hit is null then
      raise exception 'no flow node row for id %', p_entity_id using errcode = 'P0002';
    end if;

    insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'products', 'info',
            array['surface', 'write', 'flow_tracking'],
            jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                               'decision', p_decision, 'is_active', v_hit, 'note', p_note));

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'state',       case when v_hit then 'approved' else 'rejected' end);
  end if;

  -- Dotaz na pravdu nad nálezy (2026-09-28): p_entity_id = li_finding_question_id
  -- (pravidlo × druh nálezu), ne id jednoho nálezu. Odpověď platí pro celé pravidlo,
  -- tedy i pro doklady, které ingest přinese později — proto se ukládá vedle nálezů
  -- (li_finding_verdicts), ne do nich. Dotaz musí EXISTOVAT (aspoň jeden nález ho
  -- nese): uuid, které nic nepojmenovává, by jinak založilo verdikt o ničem.
  -- Slovník je uzavřený v obou směrech jako u twin_identity — překlep nesmí ani
  -- potvrdit, ani tiše zamítnout pravidlo.
  if p_entity_kind = 'finding' then
    if p_decision in ('confirmed', 'approved', 'HUMAN_CONFIRMED') then
      v_status := 'confirmed';
    elsif p_decision in ('rejected', 'REJECTED', 'HUMAN_REJECTED') then
      v_status := 'rejected';
    else
      raise exception 'decision % not recognised for finding (confirmed | rejected)', p_decision
        using errcode = '22023';
    end if;

    -- Totéž, co člověk viděl ve frontě: jen nálezy aktuálních verzí dokladů
    -- (li_finding_is_current), počet dokladů a nejnovější nález jako příklad.
    select count(distinct coalesce(d->>'filename', d->>'source_sha256')),
           (array_agg(jsonb_build_object('rule_key', f.rule_key, 'finding', f.finding)
                      order by f.ingested_at desc, f.id))[1],
           (array_agg(jsonb_strip_nulls(jsonb_build_object(
                        'document',    coalesce(f.documents->0->>'filename', f.documents->0->>'source_slug'),
                        'description', f.raw_data->>'description',
                        'fields',      public.li_finding_evidence_fields(f.evidence)))
                      order by f.ingested_at desc, f.id))[1]
      into v_count, v_step, v_example
      from public.li_findings f
      left join lateral jsonb_array_elements(coalesce(f.documents, '[]'::jsonb)) d on true
     where public.li_finding_question_id(f.rule_key, f.finding) = p_entity_id
       and public.li_finding_is_current(f.documents);

    if v_step is null then
      raise exception 'no finding question for id %', p_entity_id using errcode = 'P0002';
    end if;

    insert into public.li_finding_verdicts
      (question_id, rule_key, finding, decision, decided_by, decided_at, decided_note,
       documents_count, example)
    values
      (p_entity_id, v_step->>'rule_key', v_step->>'finding', v_status, auth.uid(), now(), p_note,
       v_count, v_example)
    on conflict (question_id) do update set
      decision        = excluded.decision,
      decided_by      = excluded.decided_by,
      decided_at      = excluded.decided_at,
      decided_note    = excluded.decided_note,
      documents_count = excluded.documents_count,
      example         = excluded.example;

    insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'content', 'info',
            array['surface', 'write', 'finding'],
            jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                               'rule_key', v_step->>'rule_key', 'finding', v_step->>'finding',
                               'decision', p_decision, 'status', v_status, 'note', p_note));

    return jsonb_build_object(
      'entity_kind', p_entity_kind,
      'entity_id',   p_entity_id,
      'decision',    p_decision,
      'state',       v_status);
  end if;

  if p_entity_kind <> 'obligation' then
    raise exception 'entity_kind % not supported (obligation, workflow_step, flow_node, twin_identity, twin_identity_group, twin_relation and finding only; li_source_registry has no human-review column yet)',
      p_entity_kind using errcode = '22023';
  end if;

  -- Map the decision onto the li_obligations vocabulary. Only an explicit approve
  -- promotes; every other decision records as REJECTED (never a silent promotion).
  v_status := case when p_decision = 'HUMAN_CONFIRMED' then 'HUMAN_CONFIRMED' else 'REJECTED' end;

  update public.li_obligations
     set candidate_status = v_status,
         updated_at       = now()
   where id = p_entity_id;
  get diagnostics v_hit = row_count;

  if not v_hit then
    raise exception 'no obligation row for id %', p_entity_id using errcode = 'P0002';
  end if;

  -- Audit — platform pattern (additive insert into audit_journal, hash-chain #585),
  -- identical signature to upsert_contract_extract_audited.
  insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  values (auth.uid(), 'evidence.review_decided', 'evidence.review_decided', 'content', 'info',
          array['surface', 'write', 'moderation'],
          jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id,
                             'decision', p_decision, 'status', v_status, 'note', p_note));

  return jsonb_build_object(
    'entity_kind', p_entity_kind,
    'entity_id',   p_entity_id,
    'decision',    p_decision,
    'state',       lower(v_status)
  );
end;
$$;

-- Reviewers call this as themselves (authenticated); the body gates on is_admin_or_staff().
-- Not exposed to anon; service_role retains it for automation/back-office.
revoke all on function public.submit_evidence_review_audited(text, uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.submit_evidence_review_audited(text, uuid, text, text, jsonb, timestamptz) to authenticated, service_role;

-- ⚠️ Starý 5-argumentový podpis MUSÍ ZMIZET. `create or replace` s novým
-- parametrem, který má DEFAULT, nevytvoří novou verzi téže funkce, ale DRUHOU
-- funkci vedle: volání s pěti argumenty by pak bylo nejednoznačné (42725) —
-- nebo hůř, trefilo by starou verzi BEZ propsaného času a offline potvrzení by
-- se tiše zapisovala s časem synchronizace. Táž past už jednou stála
-- workflow_step_visible_to, viz její hlavička.
DROP FUNCTION IF EXISTS public.submit_evidence_review_audited(text, uuid, text, text, jsonb);
