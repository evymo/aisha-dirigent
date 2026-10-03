/**
 * SQL Function: fn_export_training_data
 *
 * Exports validated training examples from a dataset as JSONL-compatible rows.
 * Used by WF_TRAINING_EXPORT to prepare data for LoRA training.
 *
 * Returns rows formatted for SFT (instruction/output) or DPO (chosen/rejected).
 *
 * @param p_dataset_id - Training dataset to export from
 * @param p_min_quality - Minimum quality_score threshold (default 0.6)
 * @param p_limit - Maximum rows to export (default 10000)
 * @returns TABLE of JSONL-ready rows
 */
CREATE OR REPLACE FUNCTION public.fn_export_training_data(
  p_dataset_id uuid,
  p_limit integer DEFAULT 10000,
  p_min_quality numeric DEFAULT 0.6
)
RETURNS TABLE (
  example_id uuid,
  example_type text,
  jsonl_row jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth check: only admin/staff can export training data
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    te.id AS example_id,
    te.example_type,
    CASE
      WHEN te.example_type = 'preference_pair' THEN
        jsonb_build_object(
          'prompt', te.instruction,
          'chosen', te.chosen,
          'rejected', te.rejected
        )
      ELSE
        jsonb_build_object(
          'instruction', te.instruction,
          'input', COALESCE(te.input, ''),
          'output', te.output
        )
    END AS jsonl_row
  FROM training_examples te
  WHERE te.dataset_id = p_dataset_id
    AND te.is_validated = true
    AND (te.quality_score IS NULL OR te.quality_score >= p_min_quality)
  ORDER BY te.quality_score DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_export_training_data(uuid, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_export_training_data(uuid, integer, numeric) TO authenticated;
