-- =============================================================================
-- Function: process_feedback_to_training
-- Purpose: Convert AI feedback into training examples (SFT/DPO)
-- Part of: AISHA Learning Engine (ALE) — Phase 1 (Feedback→Training pipeline)
-- Called by: n8n workflow or admin dashboard
--
-- Oprava 2026-09-28 (SELF_IMPROVEMENT_LOOP.md §3, K-02) — naměřeno na main 9087ef3df:
--   oba INSERTy dávaly `input = NULL` do `input text NOT NULL DEFAULT ''` a DPO řádek
--   nevyplnil `output` (NOT NULL). První vhodná zpětná vazba tak shodila CELOU dávku
--   (transakce se vrátí, nic se neoznačí jako zpracované) a každý další běh padl znovu:
--   z opravy uživatele nikdy nevznikl trénovací pár. Teď `input = ''` (prázdný kontext,
--   jak ho deklaruje tabulka) a u DPO `output = chosen` (dobrá odpověď je výstupem i pro SFT).
--   Příklady vznikají NEVALIDOVANÉ (is_validated = false) — export bere jen validované,
--   takže syrový obsah konverzace se touhle opravou do tréninku nedostane (filtr hodnot
--   a validace jsou SELF_IMPROVEMENT_LOOP.md §5.5 / §6.5).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_feedback_to_training(
  p_dataset_id uuid,
  p_feedback_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_min_rating smallint DEFAULT 4,
  p_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_is_service_role boolean := false;
  v_sft_count integer := 0;
  v_dpo_count integer := 0;
  v_skipped_count integer := 0;
  rec record;
  v_user_msg text;
  v_assistant_msg text;
BEGIN
  -- Auth check: admin/staff or service_role
  v_user_id := auth.uid();
  v_is_service_role := COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
    false
  );

  IF NOT v_is_service_role AND (v_user_id IS NULL OR NOT public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Permission denied: admin or staff required';
  END IF;

  -- Validate dataset exists
  IF NOT EXISTS (SELECT 1 FROM public.training_datasets WHERE id = p_dataset_id) THEN
    RAISE EXCEPTION 'Dataset not found: %', p_dataset_id;
  END IF;

  -- Process unprocessed feedback
  FOR rec IN
    SELECT
      af.id AS feedback_id,
      af.message_id,
      af.conversation_id,
      af.rating,
      af.correction_text,
      af.feedback_category,
      af.domain_tags,
      af.story_id,
      cm.content AS assistant_content,
      cm.model_used,
      cm.routing_category
    FROM public.ai_feedback af
    LEFT JOIN public.chat_messages cm ON cm.id = af.message_id
    WHERE af.is_processed = false
      AND (p_feedback_ids IS NULL OR af.id = ANY(p_feedback_ids))
      AND (p_org_id IS NULL OR af.org_id = p_org_id)
      AND (
        af.rating >= p_min_rating
        OR (af.correction_text IS NOT NULL AND length(trim(af.correction_text)) > 10)
      )
    ORDER BY af.created_at ASC
    LIMIT p_limit
  LOOP
    -- Get corresponding user message (previous message in conversation)
    SELECT cm.content INTO v_user_msg
    FROM public.chat_messages cm
    WHERE cm.conversation_id = rec.conversation_id
      AND cm.role = 'user'
      AND cm.created_at < (
        SELECT created_at FROM public.chat_messages WHERE id = rec.message_id
      )
    ORDER BY cm.created_at DESC
    LIMIT 1;

    v_assistant_msg := rec.assistant_content;

    -- Skip if we can't reconstruct the pair
    IF v_user_msg IS NULL OR v_assistant_msg IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      UPDATE public.ai_feedback SET is_processed = true, processed_at = now()
      WHERE id = rec.feedback_id;
      CONTINUE;
    END IF;

    -- Skip duplicates
    IF EXISTS (
      SELECT 1 FROM public.training_examples
      WHERE dataset_id = p_dataset_id
        AND source_id = rec.feedback_id
        AND source_type = 'ai_feedback'
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      UPDATE public.ai_feedback SET is_processed = true, processed_at = now()
      WHERE id = rec.feedback_id;
      CONTINUE;
    END IF;

    -- Case A: Has correction → DPO preference pair (chosen=correction, rejected=original)
    IF rec.correction_text IS NOT NULL AND length(trim(rec.correction_text)) > 10 THEN
      INSERT INTO public.training_examples (
        dataset_id, example_type, instruction, input, output,
        chosen, rejected,
        source_id, source_type, domain_tags, quality_score
      ) VALUES (
        p_dataset_id,
        'preference_pair',
        v_user_msg,
        '',
        rec.correction_text,
        rec.correction_text,
        v_assistant_msg,
        rec.feedback_id,
        'ai_feedback',
        rec.domain_tags,
        GREATEST(COALESCE(rec.rating, 0)::numeric, 1::numeric) / 5.0
      );
      v_dpo_count := v_dpo_count + 1;

    -- Case B: High rating without correction → SFT instruction pair
    ELSE
      INSERT INTO public.training_examples (
        dataset_id, example_type, instruction, input, output,
        source_id, source_type, domain_tags, quality_score
      ) VALUES (
        p_dataset_id,
        'instruction',
        v_user_msg,
        '',
        v_assistant_msg,
        rec.feedback_id,
        'ai_feedback',
        rec.domain_tags,
        rec.rating::numeric / 5.0
      );
      v_sft_count := v_sft_count + 1;
    END IF;

    -- Mark feedback as processed
    UPDATE public.ai_feedback SET is_processed = true, processed_at = now()
    WHERE id = rec.feedback_id;
  END LOOP;

  -- Update dataset stats
  UPDATE public.training_datasets
  SET record_count = (
    SELECT count(*) FROM public.training_examples WHERE dataset_id = p_dataset_id
  )
  WHERE id = p_dataset_id;

  -- Audit journal
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'TRAINING_DATA_PROCESSED',
    jsonb_build_object(
      'dataset_id', p_dataset_id,
      'sft_pairs', v_sft_count,
      'dpo_pairs', v_dpo_count,
      'skipped', v_skipped_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'sft_pairs', v_sft_count,
    'dpo_pairs', v_dpo_count,
    'skipped', v_skipped_count,
    'total_processed', v_sft_count + v_dpo_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_feedback_to_training(uuid, uuid[], integer, smallint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_feedback_to_training(uuid, uuid[], integer, smallint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_feedback_to_training(uuid, uuid[], integer, smallint, uuid) TO service_role;

COMMENT ON FUNCTION public.process_feedback_to_training(uuid, uuid[], integer, smallint, uuid) IS
  'Convert AI feedback into training examples (SFT/DPO). Called by n8n workflow or admin. Rate 4+ → SFT, corrections → DPO preference pairs even for low-rated responses.';
