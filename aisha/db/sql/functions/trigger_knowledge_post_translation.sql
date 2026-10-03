-- Function: trigger_knowledge_post_translation

CREATE OR REPLACE FUNCTION public.trigger_knowledge_post_translation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Translation is handled asynchronously via Supabase Database Webhook
  -- calling the translate-content Edge Function.
  -- This trigger serves as the hook point for that webhook.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION trigger_knowledge_post_translation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trigger_knowledge_post_translation() TO PUBLIC;
GRANT EXECUTE ON FUNCTION trigger_knowledge_post_translation() TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_knowledge_post_translation() TO service_role;
