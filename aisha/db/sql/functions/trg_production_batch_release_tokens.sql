-- Function: trg_production_batch_release_tokens

CREATE OR REPLACE FUNCTION public.trg_production_batch_release_tokens()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only fire when status changes TO 'released'
  IF NEW.status = 'released' AND (OLD.status IS DISTINCT FROM 'released') THEN
    -- Set auth context for the trigger (use the person who made the update)
    PERFORM public.mint_production_tokens_on_release(p_batch_id := NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION trg_production_batch_release_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trg_production_batch_release_tokens() TO PUBLIC;
GRANT EXECUTE ON FUNCTION trg_production_batch_release_tokens() TO authenticated;
GRANT EXECUTE ON FUNCTION trg_production_batch_release_tokens() TO service_role;
