-- ============================================================================
-- Source of Truth: hr_zdroje_uctu_admin
-- Popis: Pro správu v Lidé a účty: plný přístup (vse) a zdroje dat, ke kterým jde uživateli udělit
--        přístup, a jestli je má. Z DAT, ne z konfigurace — co ingest skutečně
--        zpracoval (klíče původu v li_doc_scope_keys):
--          instance = instance zdrojů podle záznamu konektoru (`@instance`, např. agendy
--                     Money), s počtem dokladů;
--          slozky   = adresáře vstupu ingestu (`@cesta`) do 2. úrovně, s počtem dokladů;
--          firmy    = smluvní strany smluvních dokumentů podle IČO (`@firma`), s počtem
--                     dokladů; jméno z přehledu (dvojče s tím IČO), jinak nejčastější
--                     jméno strany z dokladů — IČO je klíč, jméno jen popisek.
--        ⭐ Majitel 2026-09-28: „MODĚVA, Avant… to jsou zdroje dat z Money, které chceme
--        zpřístupnit" — přístup uděluje správa, ingest o něm nerozhoduje.
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_zdroje_uctu_admin(p_user_id uuid)
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
  RETURN jsonb_build_object(
    -- ⭐ PLNÝ PŘÍSTUP (2026-09-28): jeden přepínač „všechna data bez výběru"
    'vse', jsonb_build_object(
      'zdroj', 'vse:*',
      'dokladu', (SELECT count(*) FROM public.li_source_registry r WHERE r.superseded_by IS NULL),
      'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g WHERE g.user_id = p_user_id AND g.zdroj = 'vse:*')),
    -- ⭐ PO ZDROJÍCH (2026-09-28): dokumenty zpracovaného vstupu a zdroje dvojčat
    'vstupy', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'zdroj', 'vstup:' || z.hodnota, 'label', z.zobrazeni, 'dokladu', z.n,
               'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g
                                   WHERE g.user_id = p_user_id AND lower(g.zdroj) = 'vstup:' || z.hodnota))
             ORDER BY z.n DESC)
        FROM (SELECT k.hodnota, max(k.zobrazeni) AS zobrazeni, count(DISTINCT k.source_sha256) AS n
                FROM public.li_doc_scope_keys k WHERE k.field_key = '@vstup'
               GROUP BY k.hodnota) z
    ), '[]'::jsonb),
    'dvojcata', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'zdroj', 'udalosti:' || z.zdroj, 'label', z.zdroj, 'dokladu', z.n, 'druhy', z.druhy,
               'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g
                                   WHERE g.user_id = p_user_id AND lower(g.zdroj) = 'udalosti:' || z.zdroj))
             ORDER BY z.n DESC, z.zdroj)
        FROM (SELECT lower(e.source) AS zdroj, count(DISTINCT e.twin_id) AS n,
                     string_agg(DISTINCT t.entity_type, ', ') AS druhy
                FROM public.twin_events e
                JOIN public.twin_entities t ON t.id = e.twin_id
               GROUP BY lower(e.source)) z
    ), '[]'::jsonb),
    'instance', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'zdroj', 'instance:' || z.zobrazeni, 'label', z.zobrazeni, 'dokladu', z.n,
               'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g
                                   WHERE g.user_id = p_user_id AND lower(g.zdroj) = 'instance:' || z.hodnota))
             ORDER BY z.n DESC, z.zobrazeni)
        FROM (SELECT k.hodnota, max(k.zobrazeni) AS zobrazeni, count(DISTINCT k.source_sha256) AS n
                FROM public.li_doc_scope_keys k WHERE k.field_key = '@instance'
               GROUP BY k.hodnota) z
    ), '[]'::jsonb),
    'slozky', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'zdroj', 'cesta:' || z.zobrazeni, 'label', z.zobrazeni, 'dokladu', z.n,
               'uroven', z.uroven,
               'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g
                                   WHERE g.user_id = p_user_id AND lower(g.zdroj) = 'cesta:' || z.hodnota))
             ORDER BY z.zobrazeni)
        FROM (SELECT k.hodnota, max(k.zobrazeni) AS zobrazeni, count(DISTINCT k.source_sha256) AS n,
                     cardinality(string_to_array(k.hodnota, '/')) AS uroven
                FROM public.li_doc_scope_keys k WHERE k.field_key = '@cesta'
               GROUP BY k.hodnota) z
       WHERE z.uroven <= 2
    ), '[]'::jsonb),
    'firmy', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'zdroj', 'firma:' || z.hodnota,
               'label', coalesce(z.z_prehledu, z.z_dokladu, 'IČO ' || z.hodnota),
               'ico', z.hodnota, 'dokladu', z.n,
               'udeleno', EXISTS (SELECT 1 FROM public.data_source_grants g
                                   WHERE g.user_id = p_user_id AND lower(g.zdroj) = 'firma:' || z.hodnota))
             ORDER BY z.n DESC, z.hodnota)
        FROM (SELECT f.hodnota, f.n,
                     (SELECT t.label
                        FROM public.twin_external_refs r
                        JOIN public.twin_entities t ON t.id = r.twin_id
                       WHERE r.ref_kind = 'company_ico' AND r.source_key = f.hodnota AND r.state <> 'rejected'
                         AND t.status = 'active' AND t.label !~ '^[0-9 /.-]+$'
                       ORDER BY (r.state = 'confirmed') DESC, t.label
                       LIMIT 1) AS z_prehledu,
                     (SELECT j.jmeno
                        FROM (SELECT btrim(CASE
                                 WHEN btrim(coalesce(d.fields->'supplier_id'->>'value', d.fields->>'supplier_id')) = f.hodnota
                                 THEN coalesce(d.fields->'supplier_name'->>'value', d.fields->>'supplier_name')
                                 ELSE coalesce(d.fields->'counterparty'->>'value', d.fields->>'counterparty') END) AS jmeno
                                FROM public.li_doc_scope_keys k2
                                JOIN public.li_source_registry d ON d.source_sha256 = k2.source_sha256
                               WHERE k2.field_key = '@firma' AND k2.hodnota = f.hodnota) j
                       WHERE j.jmeno <> '' AND length(j.jmeno) <= 80
                       GROUP BY j.jmeno ORDER BY count(*) DESC, j.jmeno LIMIT 1) AS z_dokladu
                FROM (SELECT k.hodnota, count(DISTINCT k.source_sha256) AS n
                        FROM public.li_doc_scope_keys k WHERE k.field_key = '@firma'
                       GROUP BY k.hodnota) f) z
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_zdroje_uctu_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_zdroje_uctu_admin(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_zdroje_uctu_admin(uuid) IS
  'Správa: zdroje dat k udělení (instance zdrojů podle záznamu konektoru, složky = adresáře vstupu ingestu do 2. úrovně, firmy = smluvní strany smluvních dokumentů podle IČO) s počty dokladů a stavem u uživatele.';
