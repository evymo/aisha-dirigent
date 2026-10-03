-- Function: get_symptom_catalog_admin
-- Purpose: Admin read of symptom catalog with all translations
-- Access: admin/staff only
-- Security: SECURITY DEFINER with authorization check

CREATE OR REPLACE FUNCTION public.get_symptom_catalog_admin()
RETURNS TABLE (
  id UUID,
  code TEXT,
  category TEXT,
  icon TEXT,
  color TEXT,
  default_severity_scale INTEGER,
  sort_order INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  translations JSONB  -- {"cs": {"name": "...", "description": "..."}, "en": {...}}
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Authorization: admin or staff
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'symptom_catalog',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read symptom catalog',
      p_tags := ARRAY['admin', 'symptom_catalog'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    syc.id,
    syc.code,
    syc.category,
    syc.icon,
    syc.color,
    syc.default_severity_scale,
    syc.sort_order,
    syc.is_active,
    syc.created_at,
    syc.updated_at,
    COALESCE(
      (
        SELECT jsonb_object_agg(sub.locale, sub.trans)
        FROM (
          SELECT
            t.locale,
            jsonb_build_object(
              'name', MAX(CASE WHEN t.key = syc.code || '.name' THEN t.value END),
              'description', MAX(CASE WHEN t.key = syc.code || '.description' THEN t.value END)
            ) AS trans
          FROM translations t
          WHERE t.namespace = 'symptom_catalog'
            AND t.key LIKE syc.code || '.%'
          GROUP BY t.locale
        ) sub
      ),
      '{}'::jsonb
    ) AS translations
  FROM symptom_catalog syc
  ORDER BY syc.sort_order, syc.code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_symptom_catalog_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_symptom_catalog_admin() TO authenticated;

COMMENT ON FUNCTION public.get_symptom_catalog_admin() IS 'Admin: returns full symptom catalog with all locale translations.';
