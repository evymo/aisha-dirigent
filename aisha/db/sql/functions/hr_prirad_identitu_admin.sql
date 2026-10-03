-- ============================================================================
-- Source of Truth: hr_prirad_identitu_admin
-- Popis: Naváže osobu účtu na identitu vazbou, kterou pravidla nároku znají
--        (twin_scope_doc_rules). Účet bez osoby ji dostane (twin_ensure_for_account).
--        Vazbu otevírá twin_relation_open_admin (audit). Rozhodnutí majitele
--        2026-09-28: vazby na data nastavuje správa u uživatele.
-- Bezpečnost: SECURITY DEFINER; jen správa. Druh vazby mimo pravidla = chyba
--   (vazba by nic neotevřela a v administraci by vypadala jako funkční).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_prirad_identitu_admin(
  p_relation_kind text,
  p_twin_id       uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_osoba uuid;
  v_label text;
  v_vysl  jsonb;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_scope_doc_rules p WHERE p.is_active AND p.relation_kind = p_relation_kind) THEN
    RAISE EXCEPTION 'relation_kind_bez_pravidla: druh vazby % pravidla nároku neznají', p_relation_kind USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_twin_id AND t.entity_type NOT IN ('person', 'driver')) THEN
    RAISE EXCEPTION 'identity_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) INTO v_label
    FROM aisha_auth.users u LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_osoba := public.twin_ensure_for_account(p_user_id, v_label, 'person');
  IF EXISTS (SELECT 1 FROM public.twin_relations v
              WHERE v.source_twin_id = v_osoba AND v.target_twin_id = p_twin_id AND v.relation_kind = p_relation_kind
                AND v.valid_from <= now() AND (v.valid_to IS NULL OR v.valid_to > now())) THEN
    RETURN jsonb_build_object('ok', true, 'osoba', v_osoba, 'uz_existuje', true);
  END IF;
  v_vysl := public.twin_relation_open_admin(v_osoba, p_twin_id, p_relation_kind, now(),
              jsonb_build_object('puvod', 'HR Lidé a účty', 'user_id', p_user_id));
  RETURN jsonb_build_object('ok', true, 'osoba', v_osoba, 'relation_id', v_vysl->'relation_id', 'uz_existuje', false);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_prirad_identitu_admin(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_prirad_identitu_admin(text, uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_prirad_identitu_admin(text, uuid, uuid) IS
  'Správa: naváže osobu účtu (založí ji, chybí-li) na identitu vazbou z pravidel nároku; audit přes twin_relation_open_admin.';
