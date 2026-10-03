-- Function: fn_rag_eval_golden_set_updated_at

CREATE OR REPLACE FUNCTION public.fn_rag_eval_golden_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION fn_rag_eval_golden_set_updated_at() FROM PUBLIC;
