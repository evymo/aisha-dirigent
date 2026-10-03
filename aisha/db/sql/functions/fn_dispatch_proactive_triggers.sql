-- Function: fn_dispatch_proactive_triggers
-- Generic AFTER INSERT/UPDATE trigger — the data-driven proactive dispatch engine.
--
-- Attached (automatically, via trg_proactive_defs_sync → fn_apply_proactive_dispatch_install)
-- to every table named by an ACTIVE ai_proactive_trigger_definitions row. For each firing
-- row it evaluates the matching definitions and, for each that passes its condition and is
-- outside its cooldown, records a pending ai_proactive_runs row (the OUTBOX — written in the
-- same transaction as the business row) and wakes the executor EVENT-DRIVEN with
-- pg_notify('ai_proactive_dispatch'). The executor in event-worker claims the run
-- (claim_proactive_run), acts on the rule's channel and finalizes it (finish_proactive_run);
-- a notify missed while it was down is caught up from the outbox (claim_pending_proactive_runs).
--
-- ⛔ NO pg_net (2026-09-28). This function used to bridge rules with `workflow_name` to n8n
-- via net.http_post — but pg_net is NOT in the DB image, so that branch never delivered a
-- single request (measured: no `net` schema). A dead branch that looks like delivery is
-- worse than none; it is removed and the outbox + executor is the only delivery path.
-- Gate sot-bez-pg-net keeps the remaining net.http_* users as a ratchet that only shrinks.
--
-- This is the generalized form of fn_notify_rule_change: instead of one hardcoded channel
-- and webhook path, the reactive rules live as DATA in ai_proactive_trigger_definitions.
--
-- Fail-safe: per-definition work is wrapped so one bad rule can never abort the source
-- table's transaction nor block sibling rules (RAISE WARNING to the server log + continue).

CREATE OR REPLACE FUNCTION public.fn_dispatch_proactive_triggers()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_new         jsonb;
  v_old         jsonb;
  v_record_id   uuid;
  v_def         record;
  v_user_id     uuid;
  v_run_id      uuid;
  v_payload     jsonb;
BEGIN
  v_new := to_jsonb(NEW);
  v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  -- Best-effort source record id (most tables use an `id uuid` PK).
  BEGIN
    v_record_id := NULLIF(v_new ->> 'id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_record_id := NULL;
  END;

  FOR v_def IN
    SELECT *
    FROM ai_proactive_trigger_definitions
    WHERE source_table = TG_TABLE_NAME
      AND source_event = TG_OP
      AND is_active = true
  LOOP
    BEGIN
      -- 1. Condition gate (pure, injection-free DSL).
      IF NOT fn_proactive_condition_matches(v_def.condition, v_new, v_old, TG_OP) THEN
        CONTINUE;
      END IF;

      -- 2. Resolve the owning user (proactive runs are user-scoped). A rule whose
      --    source row + author yield no user is misconfigured → skip (never fabricate).
      v_user_id := COALESCE(NULLIF(v_new ->> 'user_id', '')::uuid, v_def.created_by);
      IF v_user_id IS NULL THEN
        RAISE WARNING 'proactive: rule % on % has no resolvable user_id — skipped', v_def.name, TG_TABLE_NAME;
        CONTINUE;
      END IF;

      -- 3. Cooldown — recorded at dispatch time so it holds even if the executor is down.
      IF v_def.cooldown_minutes > 0 AND EXISTS (
        SELECT 1 FROM ai_proactive_runs r
        WHERE r.trigger_definition_id = v_def.id
          AND (v_record_id IS NULL OR r.source_record_id IS NOT DISTINCT FROM v_record_id)
          AND r.created_at > now() - make_interval(mins => v_def.cooldown_minutes)
      ) THEN
        CONTINUE;
      END IF;

      -- 4. Record the pending run (the durable event record + cooldown anchor).
      INSERT INTO ai_proactive_runs (
        trigger_definition_id, user_id, source_record_id, source_data, status, metadata
      ) VALUES (
        v_def.id, v_user_id, v_record_id, v_new, 'pending',
        jsonb_build_object('source_table', TG_TABLE_NAME, 'source_event', TG_OP, 'dispatched_at', now())
      )
      RETURNING id INTO v_run_id;

      -- 5. Build the wake-up payload — IDENTIFIERS ONLY. ⛔ pg_notify caps the payload at
      --    8000 bytes; the source row used to ride along, so a large row made pg_notify raise,
      --    the EXCEPTION below rolled the block back — INCLUDING the run just inserted — and
      --    the rule silently never fired. The executor reads source_data and action_config
      --    from the outbox when it claims the run; the wake-up only has to name it.
      v_payload := jsonb_build_object(
        'proactive_run_id', v_run_id,
        'definition_id',    v_def.id,
        'definition_name',  v_def.name,
        'channel',          v_def.action_config ->> 'channel',
        'source_table',     TG_TABLE_NAME,
        'source_event',     TG_OP,
        'source_record_id', v_record_id,
        'triggered_at',     now()
      );

      -- 6. Wake the executor (event-worker LISTEN). Only a wake-up: the run above is the
      --    durable record, so a notify lost while nobody listens is caught up from the outbox.
      PERFORM pg_notify('ai_proactive_dispatch', v_payload::text);

    EXCEPTION WHEN OTHERS THEN
      -- One rule failing must never abort the business write or the sibling rules.
      -- Record it durably so a broken rule is discoverable (v_user_id may be null if
      -- the failure preceded resolution — audit_journal.user_id is nullable) and warn.
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'PROACTIVE_DISPATCH_FAILED', jsonb_build_object(
        'area', 'proactive', 'severity', 'warning',
        'definition_id', v_def.id, 'source_table', TG_TABLE_NAME, 'error', SQLERRM));
      RAISE WARNING 'proactive: rule % on % failed: %', v_def.name, TG_TABLE_NAME, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Trigger function: fires via trg_proactive_dispatch as the definer; never called
-- directly, so it is granted to service_role only (no client grant — matches
-- fn_queue_embedding_generation, and keeps it out of the SEC_DEF_NO_AUTH class).
REVOKE ALL ON FUNCTION fn_dispatch_proactive_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_dispatch_proactive_triggers() TO service_role;
