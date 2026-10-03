-- Function: public.validate_invitation
-- Arguments: p_invite_code text
-- Description: Validates an invitation code and returns study/partner info. Used during registration.
-- Security: SECURITY DEFINER - public validation for registration flow.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.validate_invitation(p_invite_code text)
 RETURNS TABLE(invited_email text, is_valid boolean, parent_study_id uuid, parent_study_name text, partner_id uuid, partner_name text, prefill_first_name text, prefill_last_name text, prefill_notes text, prefill_phone text, study_id uuid, study_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_invitation RECORD;
    v_study RECORD;
    v_parent_study RECORD;
    v_partner RECORD;
BEGIN
    -- Find the invitation
    SELECT 
        i.id, 
        i.study_id, 
        i.is_active, 
        i.expires_at, 
        i.max_uses, 
        i.used_count,
        i.created_by,
        i.email,
        i.prefill_first_name,
        i.prefill_last_name,
        i.prefill_phone,
        i.prefill_notes
    INTO v_invitation
    FROM invitations i
    WHERE i.code = p_invite_code;
    
    -- Check if invitation exists and is valid
    IF v_invitation IS NULL THEN
        RETURN QUERY SELECT 
            NULL::TEXT, FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    IF NOT v_invitation.is_active THEN
        RETURN QUERY SELECT 
            NULL::TEXT, FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    IF v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at < NOW() THEN
        RETURN QUERY SELECT 
            NULL::TEXT, FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    IF v_invitation.max_uses IS NOT NULL AND v_invitation.used_count >= v_invitation.max_uses THEN
        RETURN QUERY SELECT 
            NULL::TEXT, FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    -- Get study info if present
    IF v_invitation.study_id IS NOT NULL THEN
        SELECT s.id, s.name, s.parent_study_id
        INTO v_study
        FROM studies s
        WHERE s.id = v_invitation.study_id;
        
        -- Get parent study info if this is a child study
        IF v_study.parent_study_id IS NOT NULL THEN
            SELECT ps.id, ps.name
            INTO v_parent_study
            FROM studies ps
            WHERE ps.id = v_study.parent_study_id;
        END IF;
    END IF;
    
    -- Get partner info if invitation creator is a partner
    SELECT pp.id, pp.display_name
    INTO v_partner
    FROM partner_profiles pp
    WHERE pp.user_id = v_invitation.created_by
      AND pp.is_certified = TRUE;
    
    -- Return columns in alphabetical order to match TypeScript types
    RETURN QUERY SELECT 
        v_invitation.email,
        TRUE,
        v_parent_study.id,
        v_parent_study.name,
        v_partner.id,
        v_partner.display_name,
        v_invitation.prefill_first_name,
        v_invitation.prefill_last_name,
        v_invitation.prefill_notes,
        v_invitation.prefill_phone,
        v_study.id,
        v_study.name;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.validate_invitation(p_invite_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation(p_invite_code text) TO public;
