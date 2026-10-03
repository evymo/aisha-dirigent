-- Function: trg_update_training_dataset_counts
-- Trigger function: maintains record_count and validated_count on training_datasets
-- Triggered by: INSERT, UPDATE (is_validated), DELETE on training_examples

CREATE OR REPLACE FUNCTION public.trg_update_training_dataset_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.training_datasets
    SET record_count = record_count + 1,
        validated_count = validated_count + CASE WHEN NEW.is_validated THEN 1 ELSE 0 END,
        updated_at = now()
    WHERE id = NEW.dataset_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.training_datasets
    SET record_count = GREATEST(record_count - 1, 0),
        validated_count = GREATEST(validated_count - CASE WHEN OLD.is_validated THEN 1 ELSE 0 END, 0),
        updated_at = now()
    WHERE id = OLD.dataset_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_validated IS DISTINCT FROM NEW.is_validated THEN
    UPDATE public.training_datasets
    SET validated_count = validated_count + CASE WHEN NEW.is_validated THEN 1 ELSE -1 END,
        updated_at = now()
    WHERE id = NEW.dataset_id;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_update_training_dataset_counts() FROM PUBLIC;
