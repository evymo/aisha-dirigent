-- Function: public.get_story_detail_audited
-- Arguments: p_story_id uuid
-- Description: Get story detail with entries, labels, reminders. Supports admin/staff,
--              partner, member, story_participants and stack_default access modes.
-- Security: SECURITY DEFINER, authenticated only.
-- Updated: 2026-10-07
--
-- ⛔ NAMĚŘENO 2026-10-06 (měření F9, tři lidé ve třech IDE): výchozí story stacku
--    (is_stack_default, partner_id NULL) skončila 'Story not found' — existenci příběhu
--    funkce poznávala podle partner_id. get_story_context z IDE tak padal právě na příběhu,
--    který RLS dává každému přihlášenému („Stack default story visible to all authenticated“).
--    Teď: existence = řádek existuje; režim stack_default má přednost jen před odmítnutím.
--    Režim stack_default čte jen to, co RLS dává každému přihlášenému, a ještě méně: záznamy
--    bez interních poznámek (jako člen; RLS by interní pustila), bez náhledu dokumentu člena,
--    bez jména vlastníka příběhu; štítky a připomínky prázdné (RLS je dává jen adminovi).
--    Jméno autora záznamu (křestní + iniciála) zůstává jako u účastníka — bez něj kontext
--    společné práce nedává smysl.

CREATE OR REPLACE FUNCTION public.get_story_detail_audited(p_story_id uuid)
 RETURNS TABLE(id uuid, partner_id uuid, user_id uuid, study_id uuid, title text, status text, priority text, is_starred boolean, is_read boolean, unread_count integer, last_activity_at timestamptz, created_at timestamptz, updated_at timestamptz, user_display_name text, study_name text, labels jsonb, entries jsonb, reminders jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_story_partner_id UUID;
  v_story_user_id UUID;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
  v_story_is_stack_default BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_partner_id := public.get_current_partner_id();

  -- Load story ownership once.
  SELECT ps.partner_id, ps.user_id, ps.is_stack_default
  INTO v_story_partner_id, v_story_user_id, v_story_is_stack_default
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found' USING ERRCODE = 'P0002';
  END IF;

  -- Determine access mode (priority order)
  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_story_user_id = v_user_id THEN
    v_owner_mode := 'member';
  ELSIF public.is_admin_or_staff() THEN
    v_owner_mode := 'admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = v_user_id
  ) THEN
    v_owner_mode := 'participant';
  ELSIF v_story_is_stack_default IS TRUE THEN
    v_owner_mode := 'stack_default';
  ELSE
    RAISE EXCEPTION 'Unauthorized: Story access denied' USING ERRCODE = '42501';
  END IF;

  v_audit_area := CASE
    WHEN v_owner_mode = 'admin' THEN 'admin'::public.journal_area
    WHEN v_owner_mode IN ('partner', 'participant') THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  -- Audit access (no sensitive data payload).
  PERFORM public.write_audit_journal(
      p_action_type := 'access'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object('owner_mode', v_owner_mode),
      p_entity_id := p_story_id::text,
      p_entity_type := 'partner_stories',
      p_severity := 'info'::public.journal_severity,
      p_summary := v_owner_mode || ' accessed story detail',
    p_user_id := v_user_id
  );

  -- Partner read marks clear unread counters.
  IF v_owner_mode = 'partner' THEN
    UPDATE public.partner_stories
    SET is_read = true, unread_count = 0
    WHERE id = p_story_id AND is_read = false;
  END IF;

  RETURN QUERY
  SELECT
    ps.id,
    ps.partner_id,
    ps.user_id,
    ps.study_id,
    ps.title,
    ps.status,
    ps.priority,
    ps.is_starred,
    ps.is_read,
    ps.unread_count,
    ps.last_activity_at,
    ps.created_at,
    ps.updated_at,
    -- Display name: member sees partner/business, others see user name
    CASE
      WHEN v_owner_mode = 'stack_default' THEN NULL
      WHEN v_owner_mode = 'member' THEN (
        SELECT pp.business_name
        FROM public.partner_profiles pp
        WHERE pp.id = ps.partner_id
      )
      ELSE (
        SELECT p.first_name || ' ' || LEFT(p.last_name, 1) || '.'
        FROM public.profiles p
        WHERE p.id = ps.user_id
      )
    END AS user_display_name,
    -- Study name
    (SELECT s.name FROM public.studies s WHERE s.id = ps.study_id) AS study_name,
    -- Labels
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id', sl.id, 'label', sl.label, 'color', sl.color))
       FROM public.story_labels sl WHERE sl.story_id = ps.id AND v_owner_mode <> 'stack_default'),
      '[]'::jsonb
    ) AS labels,
    -- Entries (hierarchical). Members never see internal notes.
    -- Admin, partner, participant see internal notes.
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', se.id,
          'parent_id', se.parent_id,
          'entry_type', se.entry_type,
          'content', se.content,
          'metadata', se.metadata,
          'is_internal', se.is_internal,
          'is_pinned', se.is_pinned,
          'document_id', se.document_id,
          'created_by', se.created_by,
          'created_at', se.created_at,
          'created_by_name', (
            SELECT COALESCE(p.first_name || ' ' || LEFT(p.last_name, 1) || '.', 'System')
            FROM public.profiles p WHERE p.id = se.created_by
          ),
          'document_preview', CASE WHEN se.document_id IS NOT NULL AND v_owner_mode <> 'stack_default' THEN (
            SELECT jsonb_build_object(
              'file_name', mhd.file_name,
              'mime_type', mhd.mime_type,
              'category', mhd.category
            )
            FROM public.member_health_documents mhd
            WHERE mhd.id = se.document_id
          ) ELSE NULL END
        ) ORDER BY se.is_pinned DESC, se.created_at ASC
       )
       FROM public.story_entries se
       WHERE se.story_id = ps.id
         AND (v_owner_mode IN ('partner', 'admin', 'participant') OR se.is_internal = false)),
      '[]'::jsonb
    ) AS entries,
    -- Reminders
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', sr.id,
          'remind_at', sr.remind_at,
          'message', sr.message,
          'is_completed', sr.is_completed
        ) ORDER BY sr.remind_at ASC
       )
       FROM public.story_reminders sr
       WHERE sr.story_id = ps.id AND sr.is_completed = false AND v_owner_mode <> 'stack_default'),
      '[]'::jsonb
    ) AS reminders
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_story_detail_audited(p_story_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_story_detail_audited(p_story_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_story_detail_audited(p_story_id uuid) TO authenticated;
