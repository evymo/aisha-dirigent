-- ============================================================================
-- Source of Truth: public.get_entry_types
-- Popis: List the ACTIVE discussion post types available for a subject (the
--        composer asks "what can I post here?"). Stack universals + the
--        implementation's own types, filtered by applies_to.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; authenticated only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_entry_types(
  p_subject_type text DEFAULT NULL
)
RETURNS TABLE(
  entry_type      text,
  name_key        text,
  description_key text,
  metadata_schema jsonb,
  render_block    text,
  sort_order      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT d.entry_type, d.name_key, d.description_key, d.metadata_schema, d.render_block, d.sort_order
    FROM public.entry_type_definitions d
    WHERE d.is_active
      AND (
        p_subject_type IS NULL
        OR cardinality(d.applies_to) = 0
        OR p_subject_type = ANY(d.applies_to)
      )
    ORDER BY d.sort_order, d.entry_type;
END;
$$;

REVOKE ALL ON FUNCTION public.get_entry_types(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_entry_types(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entry_types(text) TO service_role;
