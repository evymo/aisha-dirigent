-- ============================================================================
-- Source of Truth: deactivate_data_source
-- Popis: Vypne JEDEN zdroj dat podle slugu.
--
-- Doplňuje `deactivate_plugin_runtime`, který je kill-switch nad CELÝM
-- pluginem (všechny registry naráz) a bere `plugin_id`. Administrace ale
-- potřebuje vypnout jeden zdroj, a to bez pluginu vůbec nejde vyjádřit —
-- `money` žádný plugin nemá.
--
-- Vypnutí NIKDY nic nemaže a nesahá na pověření: vypnutý zdroj se má dát zapnout
-- zpět, aniž je člověk musí zadávat znovu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deactivate_data_source(p_source_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_id uuid;
  v_active    boolean;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id, is_active INTO v_source_id, v_active
    FROM public.agent_knowledge_sources
   WHERE source_slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'deactivate_data_source: zdroj % neexistuje', p_source_slug;
  END IF;

  IF NOT v_active THEN
    RETURN jsonb_build_object('source_slug', p_source_slug, 'is_active', false, 'changed', false);
  END IF;

  UPDATE public.agent_knowledge_sources
     SET is_active = false, updated_at = now()
   WHERE id = v_source_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'DATA_SOURCE_DEACTIVATED', jsonb_build_object(
    'area', 'ingest', 'severity', 'warning',
    'source_slug', p_source_slug, 'source_id', v_source_id
  ));

  RETURN jsonb_build_object('source_slug', p_source_slug, 'is_active', false, 'changed', true);
END;
$$;

COMMENT ON FUNCTION public.deactivate_data_source(text) IS
  'Vypne jeden zdroj dat podle slugu. Nemaže pověření — vypnutý zdroj jde zapnout zpět. Idempotentní, auditované. Admin/staff nebo service_role.';

REVOKE ALL ON FUNCTION public.deactivate_data_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_data_source(text) TO authenticated, service_role;
