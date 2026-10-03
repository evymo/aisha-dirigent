-- Function: fn_ai_runs_default_story (BEFORE INSERT trigger on ai_runs)
--
-- Every run belongs to a story. Not "usually" — always. An internal run (a PR
-- gate, a rule-change notification, a fingerprint recalculation) is not an
-- exception to that rule; it belongs to the stack-default story, which is a
-- perfectly ordinary story whose own SoT says so: "Logic is identical to any
-- other story: same table, same lifecycle, same chat-driven UI. Only difference:
-- partner_id IS NULL and is_stack_default = true."
--
-- WHY A TRIGGER AND NOT NINE COALESCEs: ai_runs has NINE writers today
-- (create_ai_run, fn_create_workflow_run, fn_create_improvement_proposal,
-- fn_log_ai_trace_event, fn_notify_rule_change, fn_upsert_agent_live_session,
-- log_n8n_trace_event, recalculate_all_ruleset_fingerprints, route_task).
-- Patching each is nine places to forget and a tenth writer that never learns
-- the rule. A column DEFAULT would not do either: DEFAULT applies only when the
-- column is OMITTED, and most of these pass story_id explicitly as NULL.
-- BEFORE INSERT is the one seam every writer must pass through, and it runs
-- before the NOT NULL check — which is what makes the constraint enforceable
-- rather than aspirational.
--
-- CONSEQUENCE WORTH NAMING: with a story always present,
-- fn_authorize_task_spend(kind, story_id) stops receiving NULL, so internal runs
-- go through the same budget admission as everything else instead of slipping
-- past it. That is the point, not a side effect.

--
-- ⛔ NAMĚŘENO 2026-09-27: kotva VYHLEDÁVÁ, nevolá hlídanou RPC. Verze z 2026-07-26
-- volala `ensure_stack_default_story()` — SECURITY INVOKER s guardem „admin/staff
-- nebo service_role", který čte claims VOLAJÍCÍHO (SECURITY DEFINER tohohle
-- triggeru na tom nic nemění). Od 2026-08-04 (guardy totální, 578285d5d) tak každý
-- oprávněný zapisovatel pod běžnou identitou dostal „Unauthorized" — certifikovaný
-- partner v call-mode `route_task` (grant pro authenticated), agentní testy tržiště
-- padaly i na čistém mainu. Autorizaci ZÁPISU dělá zapisovatel (route_task a spol.),
-- kotva je systémový invariant, ne druhé autorizační místo.
-- Singleton zakládá seed (core/00_setup.sql, kanonická ensure_stack_default_story()
-- pod service_role), takže vyhledání vždy najde; chybí-li, je to vada nasazení —
-- nahlas, ne tiché zakládání pod cizí identitou.
-- JEDEN domov: dřívější zdvojený trigger trg_ai_runs_default_system_story (2026-06-22,
-- týž účel, jen vyhledání) je zrušen v heals.sql.
CREATE OR REPLACE FUNCTION public.fn_ai_runs_default_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.story_id IS NULL THEN
    SELECT ps.id INTO NEW.story_id
      FROM public.partner_stories ps
     WHERE ps.is_stack_default = true
     LIMIT 1;
    IF NEW.story_id IS NULL THEN
      RAISE EXCEPTION 'ai_runs: běh bez story a stack-default story chybí — seed core/00_setup.sql (ensure_stack_default_story) neproběhl'
        USING ERRCODE = '23502';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_ai_runs_default_story() IS
  'BEFORE INSERT on ai_runs: a run with no story is anchored to the stack-default story, so story_id can be NOT NULL and every run (internal ones included) passes the same spend admission.';

REVOKE ALL ON FUNCTION public.fn_ai_runs_default_story() FROM PUBLIC;
