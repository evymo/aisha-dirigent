-- ============================================================================
-- Source of Truth: audience_admin_assign_twin
-- Popis: Přiřadí DVOJČE správci — i entitu bez účtu. Přiřazení je hrana
--        twinsverse `assigned_to` (dvojče → dvojče správce), platná od teď;
--        předchozí platné přiřazení téhož dvojčete se UZAVŘE (ne smaže).
--
-- ⛔ PROČ (naměřeno 2026-09-15): „Přiřadit" bralo `target.user_ids`, u dvojčete
-- bez účtu prázdné → 22023. Starý zápis (study_consultants, scope 'actor') se
-- pro dvojče s účtem zachovává, aby čočka overlaye (assigned_to_partner_id)
-- nelhala; pravdou přiřazení je ale hrana — registr ji ukazuje ve `relations`.
--
-- Správce musí mít dvojče (twin_for_account); bez něj 22023 — přiřadit „nikomu"
-- by byl tichý zápis bez adresáta.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_admin_assign_twin(p_twin_id uuid, p_assigned_to_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_assignee_twin uuid;
  v_actor_id      uuid;
  v_closed        integer := 0;
  v_rel           jsonb := NULL;
  v_old           record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_twin_id IS NULL OR p_assigned_to_user_id IS NULL THEN
    RAISE EXCEPTION 'twin and assignee are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_twin_id) THEN
    RAISE EXCEPTION 'Subject not found: twin %', p_twin_id USING ERRCODE = '22023';
  END IF;
  v_assignee_twin := public.twin_for_account(p_assigned_to_user_id);
  IF v_assignee_twin IS NULL THEN
    RAISE EXCEPTION 'assignee % has no twin — run twin backfill first', p_assigned_to_user_id USING ERRCODE = '22023';
  END IF;
  IF v_assignee_twin = p_twin_id THEN
    RAISE EXCEPTION 'a twin cannot be assigned to itself' USING ERRCODE = '22023';
  END IF;

  -- Předchozí platná přiřazení: stejný správce = nic nového, jiný = uzavřít.
  FOR v_old IN
    SELECT rel.id, rel.target_twin_id FROM public.twin_relations rel
     WHERE rel.source_twin_id = p_twin_id AND rel.relation_kind = 'assigned_to' AND rel.valid_to IS NULL
  LOOP
    IF v_old.target_twin_id = v_assignee_twin THEN
      v_rel := jsonb_build_object('relation_id', v_old.id, 'unchanged', true);
    ELSE
      PERFORM public.twin_relation_close_admin(v_old.id, now(), 'reassigned');
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  IF v_rel IS NULL THEN
    v_rel := public.twin_relation_open_admin(p_twin_id, v_assignee_twin, 'assigned_to', now(),
               jsonb_build_object('assigned_by', auth.uid()));
  END IF;

  -- Čočka účtu (overlay) — jen když dvojče účet má.
  SELECT r.source_key::uuid INTO v_actor_id
  FROM public.twin_external_refs r
  WHERE r.twin_id = p_twin_id AND r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL
    AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  LIMIT 1;
  IF v_actor_id IS NOT NULL THEN
    PERFORM public.audience_admin_assign_actors(ARRAY[v_actor_id], p_assigned_to_user_id);
  END IF;

  RETURN v_rel || jsonb_build_object('closed', v_closed, 'assignee_twin_id', v_assignee_twin);
END;
$function$;

REVOKE ALL ON FUNCTION public.audience_admin_assign_twin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audience_admin_assign_twin(uuid, uuid) TO authenticated, service_role;
