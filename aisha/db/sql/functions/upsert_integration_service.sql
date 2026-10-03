-- ============================================================================
-- Source of Truth: upsert_integration_service
-- Popis: Zaregistruje nebo aktualizuje integrační službu.
--        Používá Aisha při bootstrapu NocoDB/Langfuse.
-- ⛔ VLASTNICTVÍ A POVĚŘENÍ (2026-09-29): `service_name` je globální klíč. Dřív
--    DO UPDATE přepsal `managed_by` (převzetí služby jiného správce) a s NOVOU
--    `base_url` ponechal uložený `api_token` (COALESCE) — kdo změnil URL, poslal
--    tím cizí token na svůj server. Teď: existující službu aktualizuje jen týž
--    `managed_by` (jinak 42501 s klíčem a vlastníkem); při změně `base_url` platí
--    jen token předaný SPOLU s ní (bez něj NULL = zneplatněný); při stejné URL
--    zůstává uložený token jako dřív.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_integration_service(
  p_service_name  text,
  p_display_name  text,
  p_service_type  text,
  p_base_url      text,
  p_api_token     text DEFAULT NULL,
  p_config        jsonb DEFAULT '{}'::jsonb,
  p_managed_by    text DEFAULT 'aisha'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_vlastnik text;
BEGIN
  -- Authorization: admin/staff only
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  SELECT i.managed_by INTO v_vlastnik
    FROM public.integration_services i
   WHERE i.service_name = p_service_name
   FOR UPDATE;
  IF FOUND AND v_vlastnik IS DISTINCT FROM p_managed_by THEN
    RAISE EXCEPTION 'integration service % is managed by %', p_service_name, COALESCE(v_vlastnik, '(none)')
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.integration_services (
    service_name, display_name, service_type, base_url, api_token, config, managed_by
  )
  VALUES (
    p_service_name, p_display_name, p_service_type, p_base_url, p_api_token, p_config, p_managed_by
  )
  ON CONFLICT (service_name) DO UPDATE SET
    display_name  = EXCLUDED.display_name,
    service_type  = EXCLUDED.service_type,
    base_url      = EXCLUDED.base_url,
    -- Nová URL → jen nový token (nebo žádný); stejná URL → uložený token zůstává.
    api_token     = CASE WHEN EXCLUDED.base_url IS DISTINCT FROM integration_services.base_url
                         THEN EXCLUDED.api_token
                         ELSE COALESCE(EXCLUDED.api_token, integration_services.api_token) END,
    config        = integration_services.config || EXCLUDED.config,
    updated_at    = now()
  WHERE integration_services.managed_by IS NOT DISTINCT FROM EXCLUDED.managed_by
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Souběh: služba změnila správce mezi kontrolou a zápisem — nic se nepřevzalo.
    RAISE EXCEPTION 'integration service % is managed by another owner', p_service_name USING ERRCODE = '42501';
  END IF;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'INTEGRATION_UPSERT',
    jsonb_build_object(
      'area', 'integrations',
      'severity', 'info',
      'service_name', p_service_name,
      'service_type', p_service_type,
      'managed_by', p_managed_by
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_integration_service(text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_integration_service(text, text, text, text, text, jsonb, text) TO authenticated;
