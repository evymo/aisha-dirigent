-- Function: public.mint_production_tokens_on_release
-- Arguments: p_batch_id uuid
-- Description: Mint (and optionally burn) tokens when a batch is released. Called by trigger trg_batch_release_tokens or manually.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.mint_production_tokens_on_release(
  p_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch production_batches%ROWTYPE;
  v_rule token_reward_rules%ROWTYPE;
  v_output_volume numeric := 0;
  v_loss_volume numeric := 0;
  v_mint_amount numeric;
  v_burn_amount numeric;
  v_mint_event_id uuid;
  v_burn_event_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT * INTO v_batch FROM production_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  -- Get output volume from flow records (finished nodes)
  SELECT
    COALESCE(SUM(CASE WHEN tn.node_type = 'finished' THEN r.volume_l ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tn.node_type = 'waste' THEN r.volume_l ELSE 0 END), 0)
  INTO v_output_volume, v_loss_volume
  FROM production_flow_records r
  JOIN production_flow_nodes tn ON tn.id = r.target_node_id
  WHERE r.batch_id = p_batch_id AND r.is_storno = false;

  -- If no flow records, use batch actual_quantity as fallback
  IF v_output_volume = 0 AND v_batch.actual_quantity IS NOT NULL THEN
    v_output_volume := v_batch.actual_quantity;
  END IF;

  -- Get mint rule
  SELECT * INTO v_rule
  FROM token_reward_rules
  WHERE action_type = 'production_batch_released' AND is_active = true;

  IF FOUND THEN
    v_mint_amount := v_output_volume * v_rule.base_amount * v_rule.multiplier;

    IF v_mint_amount > 0 THEN
      INSERT INTO production_token_events (
        batch_id, event_type, token_type, amount, reason,
        description, reference_volume, created_by
      ) VALUES (
        p_batch_id, 'mint', COALESCE(v_rule.token_type, 'aisha'),
        v_mint_amount,
        'production_batch_released',
        format('Auto-mint on batch %s release: %s L output × %s',
          v_batch.batch_code, v_output_volume, v_rule.base_amount * v_rule.multiplier),
        v_output_volume, auth.uid()
      )
      RETURNING id INTO v_mint_event_id;
    END IF;
  END IF;

  -- Get burn rule for losses
  SELECT * INTO v_rule
  FROM token_reward_rules
  WHERE action_type = 'production_loss_penalty' AND is_active = true;

  IF FOUND AND v_loss_volume > 0 THEN
    v_burn_amount := v_loss_volume * v_rule.base_amount * v_rule.multiplier;

    INSERT INTO production_token_events (
      batch_id, event_type, token_type, amount, reason,
      description, loss_volume, created_by
    ) VALUES (
      p_batch_id, 'burn', COALESCE(v_rule.token_type, 'aisha'),
      v_burn_amount,
      'production_loss_penalty',
      format('Auto-burn on batch %s losses: %s L × %s',
        v_batch.batch_code, v_loss_volume, v_rule.base_amount * v_rule.multiplier),
      v_loss_volume, auth.uid()
    )
    RETURNING id INTO v_burn_event_id;
  END IF;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'tokens'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_batch_id::text,
    p_entity_type := 'production_token_automation',
    p_new_values := jsonb_build_object(
      'output_volume', v_output_volume,
      'loss_volume', v_loss_volume,
      'minted', COALESCE(v_mint_amount, 0),
      'burned', COALESCE(v_burn_amount, 0)
    ),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := format('Production token automation: minted %s, burned %s for batch %s',
      COALESCE(v_mint_amount, 0), COALESCE(v_burn_amount, 0), v_batch.batch_code),
    p_tags := ARRAY['admin', 'tokens', 'production', 'automation'],
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'output_volume', v_output_volume,
    'loss_volume', v_loss_volume,
    'minted', COALESCE(v_mint_amount, 0),
    'burned', COALESCE(v_burn_amount, 0),
    'mint_event_id', v_mint_event_id,
    'burn_event_id', v_burn_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mint_production_tokens_on_release(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_production_tokens_on_release(uuid) TO authenticated;
