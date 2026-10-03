-- Function: public.should_auto_approve_order
-- Arguments: p_user_id uuid, p_order_value numeric
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:06+01:00

CREATE OR REPLACE FUNCTION public.should_auto_approve_order(p_user_id uuid, p_order_value numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule RECORD;
  v_has_role boolean;
  v_cert_level integer;
  v_uid uuid := auth.uid();
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Pravidla
  -- automatického schválení se ptají na roli (`user_roles`) a certifikační
  -- úroveň partnera, takže „schválil by se uuid X nákup za částku Y?" je
  -- binární vyhledávání cizí role a úrovně — pro libovolné uuid.
  --
  -- Odpovídá se jen o VOLAJÍCÍM; služba a správa na kohokoli. Změřeno, že to nic
  -- nerozbije: v repu ji nevolá žádná politika, funkce ani klient.
  -- `false` = „neschválit automaticky", tedy bezpečná výchozí cesta.
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RETURN false;
    END IF;
  END IF;

  -- Get user's certification level
  SELECT certification_level INTO v_cert_level
  FROM public.partner_profiles
  WHERE user_id = p_user_id;
  
  -- Check each active rule
  FOR v_rule IN
    SELECT required_role, min_certification_level, max_order_value
    FROM public.order_approval_rules
    WHERE is_active = true
    ORDER BY priority DESC
  LOOP
    -- Check role requirement
    IF v_rule.required_role IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM public.user_roles 
        WHERE user_id = p_user_id AND role = v_rule.required_role
      ) INTO v_has_role;
      IF NOT v_has_role THEN CONTINUE; END IF;
    END IF;
    
    -- Check certification level
    IF v_rule.min_certification_level IS NOT NULL THEN
      IF v_cert_level IS NULL OR v_cert_level < v_rule.min_certification_level THEN
        CONTINUE;
      END IF;
    END IF;
    
    -- Check order value
    IF v_rule.max_order_value IS NOT NULL AND p_order_value > v_rule.max_order_value THEN
      CONTINUE;
    END IF;
    
    -- All conditions passed - auto-approve
    RETURN true;
  END LOOP;
  
  RETURN false;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.should_auto_approve_order(p_user_id uuid, p_order_value numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_auto_approve_order(p_user_id uuid, p_order_value numeric) TO authenticated;
