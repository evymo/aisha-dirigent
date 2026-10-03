-- ============================================================================
-- Source of Truth: audience_admin_untag_twin
-- Popis: Odebere štítek DVOJČETI — z dvojčete samotného (resource_type 'twin')
--        i z jeho účtu (resource_type 'actor', starší štítky z doby, kdy se
--        štítkovalo jen přes účet).
--
-- ⛔ PROČ OBĚ STRANY: registr (audience_admin_twin_directory_v.tags) ukazuje
-- sjednocení štítků dvojčete a jeho účtu. Kdyby odebrání smazalo jen jednu
-- stranu, štítek by na ploše zůstal a akce by vypadala, že nefunguje.
-- Přidání jde přes obecné audience_tag_resource('…', 'twin', twin_id).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_admin_untag_twin(p_twin_id uuid, p_label text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_removed integer;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_twin_id IS NULL OR coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'twin and label are required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.story_labels sl
  WHERE sl.label = p_label
    AND ((sl.resource_type = 'twin' AND sl.resource_id = p_twin_id)
      OR (sl.resource_type = 'actor' AND sl.resource_id IN (
            SELECT r.source_key::uuid FROM public.twin_external_refs r
             WHERE r.twin_id = p_twin_id AND r.ref_kind = 'account' AND r.state = 'confirmed'
               AND r.valid_to IS NULL
               AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')));
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$function$;

REVOKE ALL ON FUNCTION public.audience_admin_untag_twin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audience_admin_untag_twin(uuid, text) TO authenticated, service_role;
