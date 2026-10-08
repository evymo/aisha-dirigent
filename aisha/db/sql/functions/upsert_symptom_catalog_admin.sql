-- Function: upsert_symptom_catalog_admin
-- Purpose: Admin CRUD for symptom catalog entries
-- Access: admin only
-- Security: SECURITY DEFINER with authorization check + audit

CREATE OR REPLACE FUNCTION public.upsert_symptom_catalog_admin(
  p_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT NULL,
  p_color TEXT DEFAULT NULL,
  p_default_severity_scale INTEGER DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_translations JSONB DEFAULT NULL  -- {"cs": {"name": "...", "description": "..."}, "en": {...}}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id UUID;
  v_locale TEXT;
  v_trans JSONB;
  v_action TEXT;
BEGIN
  -- Authorization: admin only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_id IS NOT NULL THEN
    -- UPDATE existing
    UPDATE symptom_catalog SET
      code = COALESCE(p_code, code),
      category = COALESCE(p_category, category),
      icon = COALESCE(p_icon, icon),
      color = COALESCE(p_color, color),
      default_severity_scale = COALESCE(p_default_severity_scale, default_severity_scale),
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    v_action := 'update';
  ELSE
    -- INSERT new
    IF p_code IS NULL THEN
      RAISE EXCEPTION 'Code is required for new catalog entry';
    END IF;

    INSERT INTO symptom_catalog (
      code, category, icon, color, default_severity_scale,
      sort_order, is_active
    ) VALUES (
      p_code, COALESCE(p_category, 'general'), COALESCE(p_icon, '🩺'), COALESCE(p_color, '#ef4444'), COALESCE(p_default_severity_scale, 5),
      COALESCE(p_sort_order, 0), COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_id;

    v_action := 'create';
  END IF;

  -- Upsert translations if provided
  IF p_translations IS NOT NULL AND p_code IS NOT NULL THEN
    FOR v_locale IN SELECT jsonb_object_keys(p_translations) LOOP
      v_trans := p_translations -> v_locale;

      -- Name translation
      IF v_trans ? 'name' THEN
        INSERT INTO translations (locale, namespace, key, value, updated_at)
        VALUES (v_locale, 'symptom_catalog', p_code || '.name', v_trans->>'name', now())
        ON CONFLICT (locale, namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;

      -- Description translation
      IF v_trans ? 'description' THEN
        INSERT INTO translations (locale, namespace, key, value, updated_at)
        VALUES (v_locale, 'symptom_catalog', p_code || '.description', v_trans->>'description', now())
        ON CONFLICT (locale, namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;
    END LOOP;
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'CATALOG_' || upper(v_action),
    jsonb_build_object(
      'area', 'symptom_catalog',
      'severity', 'info',
      'entity_type', 'symptom_catalog',
      'entity_id', v_id,
      'code', p_code
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_symptom_catalog_admin(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_symptom_catalog_admin(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, JSONB) TO authenticated;

COMMENT ON FUNCTION public.upsert_symptom_catalog_admin(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, JSONB) IS 'Admin: create/update symptom catalog entries with translations. Admin role required.';
