-- generate_variable_symbol: Generate unique variable symbol for bank transfer
-- Uses variable_symbol_sequences table for atomic counter with year partitioning
-- Format: YYMM + 6-digit sequence (e.g., 2602000001 for Feb 2026, first order)
-- Idempotent: returns existing VS if order already has one
--
-- Arguments:
--   p_order_id uuid — order to generate/get variable symbol for
--
-- Returns: text — variable symbol (10 digits)
-- Security: SECURITY DEFINER (accesses orders + variable_symbol_sequences)
CREATE OR REPLACE FUNCTION public.generate_variable_symbol(
  p_order_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_next_val int;
  v_prefix text;
  v_vs text;
BEGIN
  -- Check if order already has a variable symbol
  SELECT variable_symbol INTO v_vs
  FROM public.orders WHERE id = p_order_id;

  IF v_vs IS NOT NULL THEN
    RETURN v_vs;
  END IF;

  -- Get next sequence value
  INSERT INTO public.variable_symbol_sequences (year, current_value)
  VALUES (v_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET current_value = variable_symbol_sequences.current_value + 1
  RETURNING current_value INTO v_next_val;

  -- Build VS: YYMM prefix + 6-digit sequence (max 10 digits total)
  v_prefix := to_char(CURRENT_DATE, 'YYMM');
  v_vs := v_prefix || lpad(v_next_val::text, 6, '0');

  -- Store on order
  UPDATE public.orders
  SET variable_symbol = v_vs, updated_at = now()
  WHERE id = p_order_id;

  RETURN v_vs;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_variable_symbol(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_variable_symbol(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_variable_symbol(uuid) TO service_role;
