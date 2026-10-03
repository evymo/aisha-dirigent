-- Function: public.create_story_entry_audited
-- Arguments: p_story_id uuid, p_entry_type text, p_content text, p_metadata jsonb, p_is_internal boolean, p_parent_id uuid, p_document_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:12+01:00

CREATE OR REPLACE FUNCTION public.create_story_entry_audited(p_story_id uuid, p_entry_type text, p_content text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_is_internal boolean DEFAULT false, p_parent_id uuid DEFAULT NULL::uuid, p_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Identita volajícího. Odděleně od vlastníka story ZÁMĚRNĚ: dřívější znění
  -- vybíralo `partner_stories.user_id` do téže proměnné, čímž volajícího přepsalo.
  -- Do v_caller se po tomhle přiřazení už nikdy nevybírá.
  v_caller UUID;
  v_partner_id UUID;
  v_story_partner_id UUID;
  v_story_owner_id UUID;
  v_story_is_default BOOLEAN;
  v_participant_role TEXT;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
  v_entry_id UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();

  SELECT ps.partner_id, ps.user_id, ps.is_stack_default
  INTO v_story_partner_id, v_story_owner_id, v_story_is_default
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  -- NOT FOUND, ne `partner_id IS NULL`: story bez partnera je členská story, ne
  -- neexistující. Dřívější podmínka je ztotožňovala a hlásila „Story not found“.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Nárok plyne z VAZBY, ne z vlastnictví: `partner_stories` nemá čtecí politiku
  -- pro `user_id`, jen pro účastníka a pro stack-default. Role té vazby navíc
  -- rozhoduje, jestli účastník smí i zapisovat — `viewer` je read-only.
  -- PK je (story_id, user_id, role), takže jeden člověk jich může držet víc;
  -- bereme tu nejširší.
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

  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_participant_role IN ('owner', 'collaborator', 'agent_supervisor') THEN
    v_owner_mode := 'member';
  ELSIF v_story_owner_id = v_caller THEN
    -- Story, která je O VOLAJÍCÍM. Vazba tu není zapsaná v story_participants,
    -- a přesto existuje — je to ta nejtěsnější možná. Doloženo pgTAP zkouškami
    -- 06_flowboard_provenance a 07_flowboard_approval: flowboard zapisuje běh do
    -- story jejího vlastníka a participant řádek k tomu nezakládá.
    -- (Že `partner_stories` nemá pro `user_id` čtecí RLS politiku, je samostatná
    -- mezera v modelu — neřeší se tady, aby oprava zůstala jednou opravou.)
    v_owner_mode := 'member';
  ELSIF v_participant_role = 'viewer' THEN
    -- ZÁMĚRNĚ před obecnými výjimkami níž: `viewer` je výslovné rozhodnutí o TOMTO
    -- člověku na TÉTO story. Kdyby ho přebil stack-default nebo role správce, byla
    -- by to tichá eskalace — a role by přestala něco znamenat.
    RAISE EXCEPTION 'Unauthorized: viewer role is read-only'
      USING ERRCODE = '42501';
  ELSIF COALESCE(v_story_is_default, false) THEN
    -- Stack-default story je veřejné přistání stacku; chatový editor /storyloop
    -- do ní píše BEZ participant řádku (viz RLS „Stack default story visible to
    -- all authenticated“). Kdyby sem nárok nesahal, editor by přestal fungovat.
    v_owner_mode := 'member';
  ELSIF public.is_admin_or_staff(v_caller) THEN
    -- Průřezová osa administrace. Zůstává v režimu 'member', takže interní entry
    -- z ní udělat nejde — to je oprávnění partnera, ne správce.
    v_owner_mode := 'member';
  ELSE
    RAISE EXCEPTION 'Unauthorized: Story access denied'
      USING ERRCODE = '42501';
  END IF;

  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  IF v_owner_mode = 'member' AND COALESCE(p_is_internal, false) THEN
    RAISE EXCEPTION 'Unauthorized: Member cannot create internal entries' USING ERRCODE = '42501';
  END IF;

  IF p_document_id IS NOT NULL THEN
    IF v_owner_mode = 'partner' THEN
      -- Partnerský režim se ptá na doklad ČLENA, kterého se story týká, a na to,
      -- že je s partnerem sdílený. Proto tady v_story_owner_id, ne volající —
      -- rozdíl, který dřívější znění zastíralo tím, že obojí bylo v jedné proměnné.
      IF NOT EXISTS (
        SELECT 1
        FROM public.member_health_documents mhd
        JOIN public.document_sharing_permissions dsp
          ON dsp.document_id = mhd.id
         AND dsp.revoked_at IS NULL
         AND dsp.can_view = true
        WHERE mhd.id = p_document_id
          AND mhd.user_id = v_story_owner_id
          AND (
            dsp.shared_with_partner_id = v_partner_id
            OR (
              dsp.shared_with_study_id IS NOT NULL
              AND public.is_study_consultant(dsp.shared_with_study_id)
            )
          )
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Document not shared with partner';
      END IF;
    ELSE
      -- Členský režim naopak žádá doklad VOLAJÍCÍHO. Přesně sem míří řidičská
      -- fotka: pořizuje ji účastník, ne vlastník story, a připojit smí jen tu svou.
      IF NOT EXISTS (
        SELECT 1
        FROM public.member_health_documents mhd
        WHERE mhd.id = p_document_id
          AND mhd.user_id = v_caller
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Document does not belong to current member';
      END IF;
    END IF;
  END IF;

  -- Legacy story entries are mirrored into the polymorphic (subject_type, subject_id)
  -- axis: subject='story', subject_id=story_id (story_entries.subject_id is NOT NULL).
  INSERT INTO public.story_entries (
    story_id, subject_type, subject_id, parent_id, entry_type, content, metadata,
    is_internal, document_id, created_by
  ) VALUES (
    p_story_id, 'story', p_story_id, p_parent_id, p_entry_type, p_content, p_metadata,
    CASE WHEN v_owner_mode = 'partner' THEN COALESCE(p_is_internal, false) ELSE false END,
    p_document_id,
    -- Podpis autora. Tohle je vlastnost, na které stojí důkazní hodnota záznamu:
    -- fotka předání i odečet měřiče mají smysl jen tehdy, když je z nich poznat,
    -- KDO u toho byl.
    v_caller
  )
  RETURNING id INTO v_entry_id;

  -- Audit (no content in log - sensitive data protection)
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object(
      'owner_mode', v_owner_mode,
      'story_id', p_story_id,
      'entry_type', p_entry_type,
      'is_internal', CASE WHEN v_owner_mode = 'partner' THEN COALESCE(p_is_internal, false) ELSE false END,
      'has_document', p_document_id IS NOT NULL
    ),
      p_entity_id := v_entry_id::text,
      p_entity_type := 'story_entries',
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner created story entry'
        ELSE 'Member created story entry'
      END,
    p_user_id := v_caller
  );

  RETURN v_entry_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_story_entry_audited(p_story_id uuid, p_entry_type text, p_content text, p_metadata jsonb, p_is_internal boolean, p_parent_id uuid, p_document_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_story_entry_audited(p_story_id uuid, p_entry_type text, p_content text, p_metadata jsonb, p_is_internal boolean, p_parent_id uuid, p_document_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_story_entry_audited(p_story_id uuid, p_entry_type text, p_content text, p_metadata jsonb, p_is_internal boolean, p_parent_id uuid, p_document_id uuid) TO authenticated;
