-- Function: public.format_display_name_for_public
-- Arguments: p_display_name text, p_nickname text, p_is_public boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:29+01:00

CREATE OR REPLACE FUNCTION public.format_display_name_for_public(p_display_name text, p_nickname text, p_is_public boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_parts TEXT[];
    v_first_name TEXT;
    v_last_initial TEXT;
BEGIN
    -- If nickname is set, always use it
    IF p_nickname IS NOT NULL AND p_nickname <> '' THEN
        RETURN p_nickname;
    END IF;
    
    -- If profile is public, return full display name
    IF p_is_public THEN
        RETURN COALESCE(p_display_name, 'Anonymní');
    END IF;
    
    -- Otherwise format as "Jméno P."
    IF p_display_name IS NULL OR p_display_name = '' THEN
        RETURN 'Anonymní';
    END IF;
    
    v_parts := string_to_array(trim(p_display_name), ' ');
    
    IF array_length(v_parts, 1) = 1 THEN
        RETURN v_parts[1];
    END IF;
    
    v_first_name := v_parts[1];
    v_last_initial := LEFT(v_parts[array_length(v_parts, 1)], 1) || '.';
    
    RETURN v_first_name || ' ' || v_last_initial;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.format_display_name_for_public(p_display_name text, p_nickname text, p_is_public boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.format_display_name_for_public(p_display_name text, p_nickname text, p_is_public boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.format_display_name_for_public(p_display_name text, p_nickname text, p_is_public boolean) TO authenticated;
