-- ============================================================================
-- Source of Truth: twin_identity_resolve
-- Popis: Runtime lookup identity: (source, source_key, ref_kind) → twin_id.
--        Čte VÝHRADNĚ potvrzené a časově platné vazby (autoritativní jen
--        confirmed — návrhy runtime nikdy nevidí). p_at umožňuje historický
--        dotaz „čí byl tenhle čip v čase T" (jízda z minulého měsíce se
--        resolvne na tehdejšího držitele, ne dnešního).
--        Nenalezeno → NULL (ne výjimka): chybějící vazba je běžný stav,
--        adaptér na něj reaguje návrhem (twin_identity_propose_binding).
--        ⭐ p_entity_type (2026-09-27): vazba je jedinečná v rámci DRUHU entity
--        (vozidlo 5 a osoba 5 téhož zdroje jsou dvě vazby). Kdo druh zná, ať ho
--        předá; bez něj jedno dvojče → vrátí ho, víc druhů → výjimka.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_identity_resolve(
  p_source text,
  p_source_key text,
  p_ref_kind text DEFAULT 'primary_id',
  p_at timestamptz DEFAULT NULL,
  p_entity_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_at timestamptz := COALESCE(p_at, now());
  v_twin uuid;
  v_druhu integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_source IS NULL OR btrim(p_source) = '' THEN
    RAISE EXCEPTION 'p_source must not be blank';
  END IF;
  IF p_source_key IS NULL OR btrim(p_source_key) = '' THEN
    RAISE EXCEPTION 'p_source_key must not be blank';
  END IF;

  -- Víc DRUHŮ pod týmž klíčem (vozidlo 5 × osoba 5) bez p_entity_type = výjimka,
  -- ne náhodný výběr: tichá záměna řidiče za vozidlo je přesně ta vada, kvůli
  -- které je druh entity v klíči vazby.
  SELECT count(DISTINCT r.entity_type) INTO v_druhu
  FROM public.twin_external_refs r
  WHERE r.source = p_source
    AND r.source_key = p_source_key
    AND r.ref_kind = COALESCE(p_ref_kind, 'primary_id')
    AND r.state = 'confirmed'
    AND r.valid_from <= v_at
    AND (r.valid_to IS NULL OR r.valid_to > v_at)
    AND (p_entity_type IS NULL OR r.entity_type = p_entity_type);
  IF v_druhu > 1 THEN
    RAISE EXCEPTION 'twin_identity_resolve: klíč zdroje % patří % druhům entit — předej p_entity_type', p_source, v_druhu
      USING ERRCODE = '21000';
  END IF;

  SELECT r.twin_id INTO v_twin
  FROM public.twin_external_refs r
  WHERE r.source = p_source
    AND r.source_key = p_source_key
    AND r.ref_kind = COALESCE(p_ref_kind, 'primary_id')
    AND r.state = 'confirmed'
    AND r.valid_from <= v_at
    AND (r.valid_to IS NULL OR r.valid_to > v_at)
    AND (p_entity_type IS NULL OR r.entity_type = p_entity_type)
  ORDER BY r.valid_from DESC
  LIMIT 1;

  RETURN v_twin;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_identity_resolve(text, text, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_identity_resolve(text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_identity_resolve(text, text, text, timestamptz, text) TO service_role;
