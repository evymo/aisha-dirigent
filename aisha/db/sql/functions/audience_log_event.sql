-- Function: audience_log_event

CREATE OR REPLACE FUNCTION public.audience_log_event(p_action_type text, p_action text, p_entity_type text, p_entity_id uuid, p_summary text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_audit_id UUID;
BEGIN
  -- audit_journal.entity_id is TEXT (not UUID) per existing aisha schema;
  -- we accept UUID for type safety + cast at insertion.
  INSERT INTO public.audit_journal (user_id, action_type, action, entity_type, entity_id, area, severity, summary, details)
  VALUES (auth.uid(), p_action_type, p_action, p_entity_type, p_entity_id::text, 'crm_ops', 'info', p_summary, p_details)
  RETURNING id INTO v_audit_id;
  RETURN v_audit_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_log_event(text,text,text,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_log_event(text,text,text,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_log_event(text,text,text,uuid,text,jsonb) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_log_event(text,text,text,uuid,text,jsonb) TO service_role;
