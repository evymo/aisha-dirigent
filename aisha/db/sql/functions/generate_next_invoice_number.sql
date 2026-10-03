-- generate_next_invoice_number: Generate next sequential invoice number
-- Uses invoice_sequences table for atomic counter with year+prefix partitioning
-- Format: PREFIX-YYYY-NNNNN (e.g., FAK-2026-00001)
--
-- Arguments:
--   p_prefix text (default 'FAK') — invoice number prefix
--
-- Returns: text — generated invoice number
-- Security: SECURITY DEFINER (accesses invoice_sequences table)
CREATE OR REPLACE FUNCTION public.generate_next_invoice_number(
  p_prefix text DEFAULT 'FAK'::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_next_val int;
BEGIN
  INSERT INTO public.invoice_sequences (prefix, year, current_value)
  VALUES (p_prefix, v_year, 1)
  ON CONFLICT (prefix, year)
  DO UPDATE SET
    current_value = invoice_sequences.current_value + 1,
    updated_at = now()
  RETURNING current_value INTO v_next_val;

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_next_val::text, 5, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_next_invoice_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_next_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_next_invoice_number(text) TO service_role;
