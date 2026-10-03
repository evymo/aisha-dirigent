/**
 * list_project_vulnerabilities — List vulnerability findings for a project.
 *
 * Called by vulnerability-aggregator edge function (service_role).
 * Returns JSON array of vulnerabilities matching filters.
 *
 * @param p_is_resolved boolean — Filter by resolved status (default false)
 * @param p_limit integer — Max rows to return (default 100)
 * @param p_project_slug text — Project slug to filter by
 */
CREATE OR REPLACE FUNCTION public.list_project_vulnerabilities(
  p_is_resolved boolean DEFAULT false,
  p_limit integer DEFAULT 100,
  p_project_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_project_slug IS NULL THEN
    RAISE EXCEPTION 'p_project_slug is required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      id,
      project_slug,
      package_name,
      severity,
      title,
      fixed_in,
      url,
      source,
      is_resolved,
      first_detected_at
    FROM public.project_vulnerabilities
    WHERE project_slug = p_project_slug
      AND is_resolved = p_is_resolved
    ORDER BY severity ASC, first_detected_at DESC
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_project_vulnerabilities(boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_project_vulnerabilities(boolean, integer, text)
  TO authenticated, service_role;
