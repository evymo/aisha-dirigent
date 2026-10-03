-- ============================================================================
-- Source of Truth: list_flowboard_graphs
-- Popis: List the caller's flowboard graphs (admin/staff: all), newest first.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_flowboard_graphs()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.updated_at DESC), '[]'::jsonb)
    FROM public.flowboard_graphs g
   WHERE g.created_by = auth.uid() OR is_admin_or_staff();
$$;
REVOKE ALL ON FUNCTION public.list_flowboard_graphs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_flowboard_graphs() TO authenticated, service_role;
