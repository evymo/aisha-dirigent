-- ============================================================================
-- Source of Truth: hr_udel_zdroj_admin
-- Popis: Udělí / odebere uživateli přístup ke zdroji dat (instance:<druh>/<instance> |
--        cesta:<adresář vstupu> | firma:<IČO> | vstup:dokumenty | udalosti:<zdroj dvojčat> |
--        vse:* = plný přístup bez výběru). Jen zdroj, který v datech existuje (klíč původu),
--        jinak by udělení nic neotevřelo. Audit každé změny.
--        ⭐ Majitel 2026-09-28: přístup je rozhodnutí správy u uživatele, ne ingestu
--        („MODĚVA, Avant… to jsou zdroje dat z Money, které chceme zpřístupnit").
--        Přístup do SEKCE je zvlášť (udělení sekce).
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_udel_zdroj_admin(
  p_udelit  boolean,
  p_user_id uuid,
  p_zdroj   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_druh    text := split_part(coalesce(p_zdroj, ''), ':', 1);
  v_hodnota text := btrim(substr(coalesce(p_zdroj, ''), strpos(coalesce(p_zdroj, ''), ':') + 1));
  v_pocet   integer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  IF v_druh NOT IN ('instance', 'cesta', 'firma', 'vstup', 'udalosti', 'vse') OR v_hodnota = '' OR strpos(coalesce(p_zdroj, ''), ':') = 0 THEN
    RAISE EXCEPTION 'invalid_zdroj: očekává se instance:<druh>/<instance>, cesta:<adresář>, firma:<IČO>, vstup:dokumenty, udalosti:<zdroj> nebo vse:*' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_druh = 'vse' AND v_hodnota <> '*' THEN
    RAISE EXCEPTION 'invalid_zdroj: plný přístup je jen vse:*' USING ERRCODE = '22023';
  END IF;
  -- Plný přístup nemá klíč původu — otevírá všechno, co v datech je.
  -- Zdroj dvojčat existuje, když o nějakém dvojčeti nese data (twin_events.source).
  IF p_udelit AND v_druh = 'udalosti' AND NOT EXISTS (SELECT 1 FROM public.twin_events e
                               WHERE lower(e.source) = lower(v_hodnota)) THEN
    RAISE EXCEPTION 'zdroj_not_found: zdroj % v datech není', p_zdroj USING ERRCODE = 'P0002';
  END IF;
  IF p_udelit AND v_druh NOT IN ('vse', 'udalosti') AND NOT EXISTS (SELECT 1 FROM public.li_doc_scope_keys k
                               WHERE k.field_key = '@' || v_druh AND k.hodnota = lower(v_hodnota)) THEN
    RAISE EXCEPTION 'zdroj_not_found: zdroj % v datech není', p_zdroj USING ERRCODE = 'P0002';
  END IF;

  IF p_udelit THEN
    INSERT INTO public.data_source_grants (user_id, zdroj, granted_by)
    VALUES (p_user_id, v_druh || ':' || v_hodnota, auth.uid())
    ON CONFLICT (user_id, zdroj) DO NOTHING;
  ELSE
    DELETE FROM public.data_source_grants
     WHERE user_id = p_user_id AND lower(zdroj) = lower(v_druh || ':' || v_hodnota);
  END IF;
  GET DIAGNOSTICS v_pocet = ROW_COUNT;

  IF v_pocet > 0 THEN
    PERFORM public.write_audit_journal(
      p_action_type := (CASE WHEN p_udelit THEN 'create' ELSE 'delete' END)::public.journal_action_type,
      p_area        := 'admin'::public.journal_area,
      p_details     := jsonb_build_object('zdroj', v_druh || ':' || v_hodnota, 'target_user_id', p_user_id, 'udelit', p_udelit),
      p_entity_id   := p_user_id::text,
      p_entity_type := 'data_source_grants',
      p_new_values  := NULL,
      p_old_values  := NULL,
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('%s zdroj dat %s', CASE WHEN p_udelit THEN 'Udělen' ELSE 'Odebrán' END, v_druh || ':' || v_hodnota),
      p_tags        := ARRAY['admin', 'zdroje', 'narok'],
      p_user_id     := auth.uid()
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'zdroj', v_druh || ':' || v_hodnota, 'udeleno', p_udelit, 'zmena', v_pocet > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_udel_zdroj_admin(boolean, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_udel_zdroj_admin(boolean, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_udel_zdroj_admin(boolean, uuid, text) IS
  'Správa: udělí/odebere uživateli přístup ke zdroji dat (instance:<druh>/<instance> | cesta:<adresář vstupu> | firma:<IČO> | vstup:dokumenty | udalosti:<zdroj> | vse:*); jen zdroj existující v datech; audit.';
