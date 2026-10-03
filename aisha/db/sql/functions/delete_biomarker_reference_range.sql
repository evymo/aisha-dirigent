-- Function: public.delete_biomarker_reference_range
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:21+01:00

CREATE OR REPLACE FUNCTION public.delete_biomarker_reference_range(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    DELETE FROM public.biomarker_reference_ranges WHERE id = p_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_biomarker_reference_range(p_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_biomarker_reference_range(p_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_biomarker_reference_range(p_id uuid) TO authenticated;
