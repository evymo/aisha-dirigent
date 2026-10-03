-- Function: fn_protect_psyche_traits

CREATE OR REPLACE FUNCTION public.fn_protect_psyche_traits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.item_type = 'personality_trait' THEN
      RAISE EXCEPTION 'Psyché traits (personality DNA) are immutable and cannot be deleted. item_id=%', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.item_type = 'personality_trait' THEN
      -- Allow only usage_count and rating_avg updates (read tracking)
      IF OLD.body_markdown IS DISTINCT FROM NEW.body_markdown
         OR OLD.ai_instructions IS DISTINCT FROM NEW.ai_instructions
         OR OLD.title IS DISTINCT FROM NEW.title
         OR OLD.summary IS DISTINCT FROM NEW.summary
         OR OLD.item_type IS DISTINCT FROM NEW.item_type
         OR OLD.status IS DISTINCT FROM NEW.status
         OR OLD.ai_context_tags IS DISTINCT FROM NEW.ai_context_tags
      THEN
        RAISE EXCEPTION 'Psyché traits (personality DNA) are immutable. Only usage_count/rating_avg may change. item_id=%', OLD.id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION fn_protect_psyche_traits() FROM PUBLIC;
