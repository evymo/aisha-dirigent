-- ============================================================================
-- Source of Truth: twin_relation_close_admin
-- Popis: Uzavře hranu twinsverse k p_valid_to. Uzavření NENÍ smazání —
--        historie zůstává („kam patřil k rozhodnému dni" musí jít zodpovědět).
--        Přesun subjektu = close staré hrany + open nové; obě operace auditované.
-- Bezpečnost: SECURITY DEFINER + admin/staff check + REVOKE/GRANT pattern.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_relation_close_admin(
  p_relation_id uuid,
  p_valid_to    timestamptz DEFAULT now(),
  p_reason      text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.twin_relations%ROWTYPE;
BEGIN
  -- ⛔ NAMĚŘENO 2026-09-06: stráž pouštěla JEN admin/staff, takže `service_role`
  -- (seedy, provisioning, instanční overlay) vazbu otevřít NEUMĚL a demo svět
  -- padal na „admin/staff only". Sourozenci téhož modulu service_role pouští
  -- (`audience_tag_resource`, `audience_admin_bulk_tag`) — tahle dvojice byla
  -- výjimka bez důvodu. Sjednoceno na týž tvar.
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'twin_relation_close_admin: admin/staff only'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.twin_relations WHERE id = p_relation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'twin_relation_close_admin: hrana % neexistuje', p_relation_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_row.valid_to IS NOT NULL THEN
    -- Znovu-uzavření by tiše PŘEPSALO historii (posunulo konec platnosti bez
    -- stopy). Uzavřená hrana je uzavřená; oprava intervalu je nový nález,
    -- ne UPDATE.
    RAISE EXCEPTION 'twin_relation_close_admin: hrana % je už uzavřená k %',
      p_relation_id, v_row.valid_to
      USING ERRCODE = '22023';
  END IF;
  IF p_valid_to <= v_row.valid_from THEN
    RAISE EXCEPTION 'twin_relation_close_admin: konec % nesmí předběhnout začátek %',
      p_valid_to, v_row.valid_from
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.twin_relations
     SET valid_to = p_valid_to,
         metadata = CASE WHEN p_reason IS NULL THEN metadata
                         ELSE metadata || jsonb_build_object('close_reason', p_reason) END
   WHERE id = p_relation_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area        := 'system'::journal_area,
    p_details     := jsonb_build_object(
      'relation_id',    p_relation_id,
      'source_twin_id', v_row.source_twin_id,
      'target_twin_id', v_row.target_twin_id,
      'relation_kind',  v_row.relation_kind,
      'valid_to',       p_valid_to,
      'reason',         p_reason
    ),
    p_entity_id   := p_relation_id::text,
    p_entity_type := 'twin_relation',
    p_summary     := 'twin relation closed',
    p_user_id     := auth.uid()
  );

  RETURN jsonb_build_object('relation_id', p_relation_id, 'valid_to', p_valid_to);
END;
$function$;

REVOKE ALL ON FUNCTION public.twin_relation_close_admin(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_relation_close_admin(uuid, timestamptz, text) TO authenticated, service_role;
