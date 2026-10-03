-- Function: update_rule_embedding
--
-- Writes a freshly-generated content_embedding onto an expert_rule, for the
-- svc-mcp-knowledge POST /embeddings/rules worker. p_embedding is the JSON array
-- string the worker produces (JSON.stringify of the float vector) — cast to
-- vector(1024). Touches updated_at so downstream invalidation is observable.
-- Service-role only — matches the route's verifyServiceRole gate.
CREATE OR REPLACE FUNCTION public.update_rule_embedding(p_embedding text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  UPDATE expert_rules
     SET content_embedding = p_embedding::vector,
         updated_at = now()
   WHERE id = p_id;
END;
$function$
;

REVOKE ALL ON FUNCTION update_rule_embedding(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rule_embedding(text, uuid) TO service_role;
