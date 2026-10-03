-- ============================================================================
-- Source of Truth: hr_identity_hledat_admin
-- Popis: Hledání identit (dvojčat) pro vazbu na data v Lidé a účty — podle názvu,
--        bez osob a řidičů (ti se navazují jako účty, ne jako identity dat).
--        Vrací i počet potvrzených identifikátorů (jméno/IČO), aby správa
--        viděla, jestli vazba na tuhle identitu přinese nějaká data.
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_identity_hledat_admin(p_hledat text, p_limit integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_hledat, ''))) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'label')
      FROM (
        SELECT jsonb_build_object(
                 'twin_id', t.id, 'label', t.label, 'entity_type', t.entity_type,
                 'identifikatoru', (SELECT count(*) FROM public.twin_external_refs r
                                     WHERE r.twin_id = t.id AND r.state = 'confirmed'
                                       AND r.ref_kind IN ('company_name', 'company_ico')
                                       AND (r.valid_to IS NULL OR r.valid_to > now()))) AS x
          FROM public.twin_entities t
         WHERE t.status = 'active'
           AND t.entity_type NOT IN ('person', 'driver')
           AND t.label ILIKE '%' || btrim(p_hledat) || '%'
         ORDER BY t.label
         LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)
      ) s
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_identity_hledat_admin(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_identity_hledat_admin(text, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_identity_hledat_admin(text, integer) IS
  'Správa: hledání identit (dvojčat mimo osoby a řidiče) pro vazbu na data, s počtem potvrzených identifikátorů.';
