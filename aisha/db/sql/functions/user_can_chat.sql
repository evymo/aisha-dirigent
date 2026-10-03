-- Function: public.user_can_chat
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:35+01:00

CREATE OR REPLACE FUNCTION public.user_can_chat(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_registration BOOLEAN := false;
  v_has_membership BOOLEAN := false;
  v_uid uuid := auth.uid();
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Odpověď
  -- skládá dvě skutečnosti o účtu — aktivní registraci do studie a aktivní
  -- členství — a přihlášený je uměl zjistit pro libovolné uuid.
  --
  -- Odpovídá se jen o VOLAJÍCÍM; služba a správa na kohokoli. Změřeno, že to nic
  -- nerozbije: oba volající v repu (create_chat_conversation_audited,
  -- deliver_pending_news_to_chat) předávají `v_user_id := auth.uid()`.
  -- `false` = totéž co „nemůže chatovat", takže zamítnutí nic neprozradí.
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RETURN false;
    END IF;
  END IF;

  -- Check if user has any active study registration
  SELECT EXISTS (
    SELECT 1 FROM public.study_registrations 
    WHERE user_id = p_user_id 
    AND status IN ('active', 'completed')
  ) INTO v_has_registration;
  
  -- Check if user has active membership
  SELECT EXISTS (
    SELECT 1 FROM public.memberships 
    WHERE user_id = p_user_id 
    AND status = 'active'
  ) INTO v_has_membership;
  
  RETURN v_has_registration OR v_has_membership;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.user_can_chat(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_chat(p_user_id uuid) TO authenticated;
