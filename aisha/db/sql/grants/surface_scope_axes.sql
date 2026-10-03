-- Grants: surface_scope_axes
REVOKE ALL ON TABLE public.surface_scope_axes FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.surface_scope_axes TO authenticated;
GRANT ALL ON TABLE public.surface_scope_axes TO service_role;
