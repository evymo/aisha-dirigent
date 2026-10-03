-- ============================================================================
-- Source of Truth: twin_relation_open_admin
-- Popis: Otevře hranu twinsverse (osa B) s platností od p_valid_from.
--        JEDINÁ ruční zápisová cesta pro hrany — tabulka nemá INSERT policy
--        záměrně: hrana bez auditní stopy by byla nárok bez důkazu.
--        Ingest/driver pojede vlastní definer cestou se stejným pravidlem.
-- Bezpečnost: SECURITY DEFINER + admin/staff check + REVOKE/GRANT pattern.
-- Pozn.: překryv téže hrany odmítá EXCLUDE constraint — tady se jen překládá
--        na čitelnou chybu, ne rozhoduje podruhé (jedno místo pravdy).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_relation_open_admin(
  p_source_twin_id uuid,
  p_target_twin_id uuid,
  p_relation_kind  text,
  p_valid_from     timestamptz DEFAULT now(),
  p_metadata       jsonb       DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- ⛔ NAMĚŘENO 2026-09-06: stráž pouštěla JEN admin/staff, takže `service_role`
  -- (seedy, provisioning, instanční overlay) vazbu otevřít NEUMĚL a demo svět
  -- padal na „admin/staff only". Sourozenci téhož modulu service_role pouští
  -- (`audience_tag_resource`, `audience_admin_bulk_tag`) — tahle dvojice byla
  -- výjimka bez důvodu. Sjednoceno na týž tvar.
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_relation_open_admin: admin/staff only'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    INSERT INTO public.twin_relations
      (source_twin_id, target_twin_id, relation_kind, valid_from, metadata)
    VALUES
      (p_source_twin_id, p_target_twin_id, p_relation_kind, p_valid_from,
       COALESCE(p_metadata, '{}'::jsonb))
    RETURNING id INTO v_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION
      'twin_relation_open_admin: hrana % —%→ % už v tom období platí — souběh téže hrany je duplicitní pravda; uzavři starou, nebo je to jiný druh vztahu',
      p_source_twin_id, p_relation_kind, p_target_twin_id
      USING ERRCODE = '23P01';
  END;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area        := 'system'::journal_area,
    p_details     := jsonb_build_object(
      'relation_id',    v_id,
      'source_twin_id', p_source_twin_id,
      'target_twin_id', p_target_twin_id,
      'relation_kind',  p_relation_kind,
      'valid_from',     p_valid_from
    ),
    p_entity_id   := v_id::text,
    p_entity_type := 'twin_relation',
    p_summary     := 'twin relation opened',
    p_user_id     := auth.uid()
  );

  RETURN jsonb_build_object('relation_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_relation_open_admin(uuid, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_relation_open_admin(uuid, uuid, text, timestamptz, jsonb) TO authenticated, service_role;
