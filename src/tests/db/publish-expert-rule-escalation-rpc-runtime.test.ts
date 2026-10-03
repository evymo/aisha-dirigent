import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Regression test for the publish_expert_rule webhook-failure path.
 *
 * Previously, on any pg_net/webhook failure the EXCEPTION handler called
 * fn_aisha_kb_decision(p_decision := 'pending_review') — not a valid decision
 * (it validates approved|rejected|escalated), so the call RAISEd inside the
 * handler and aborted the whole publish: the rule's status='review' update AND
 * the moderation queue row were rolled back (failed closed, but silently — the
 * caller got an error and nothing was queued).
 *
 * The throwaway pg17 substrate has NO pg_net (infra/postgres/Dockerfile), so setting
 * a webhook URL makes net.http_post raise — exercising exactly that path. The fix
 * (mirror publish_agent: don't call fn_aisha_kb_decision in the catch) must leave
 * the rule at 'review' with a PENDING queue row, and the RPC must succeed.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("publish_expert_rule escalation runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

describe("publish_expert_rule webhook-failure escalation (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "webhook failure leaves the rule reviewable (no rollback, queue stays pending)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_partner record;
  v_rule_id uuid;
  v_res     jsonb;
  v_status  text;
  v_qstatus text;
BEGIN
  SELECT id, user_id INTO v_partner
    FROM public.partner_profiles
   WHERE certification_passed_at IS NOT NULL
   LIMIT 1;
  IF v_partner.id IS NULL THEN
    RAISE EXCEPTION 'fixture missing: no seeded certified partner';
  END IF;

  -- idempotent cleanup of prior runs
  DELETE FROM public.knowledge_moderation_queue
   WHERE resource_type = 'expert_rule'
     AND resource_id IN (SELECT id FROM public.expert_rules WHERE slug = 'zz-test-rule-escalation');
  DELETE FROM public.expert_rules WHERE slug = 'zz-test-rule-escalation';

  -- a draft rule owned by the certified partner
  v_rule_id := gen_random_uuid();
  INSERT INTO public.expert_rules (id, slug, title, body_markdown, author_partner_id, status)
  VALUES (v_rule_id, 'zz-test-rule-escalation', 'ZZ Escalation Rule',
          'body', v_partner.id, 'draft');

  -- act as the author; force the webhook branch (pg_net absent → net.http_post raises)
  PERFORM set_config('request.jwt.claim.sub', v_partner.user_id::text, true);
  PERFORM set_config('app.settings.n8n_webhook_base_url', 'http://aisha-n8n.invalid', true);

  -- BEFORE the fix this RAISEd (and rolled everything back); now it must succeed
  v_res := public.publish_expert_rule(v_rule_id);

  -- isolate: stop the kb-change trigger from firing the (now-fixed) webhook on
  -- the cleanup DELETE below — this test asserts publish_expert_rule, not the trigger
  PERFORM set_config('app.settings.n8n_webhook_base_url', '', true);

  IF v_res->>'status' <> 'pending_review' THEN
    RAISE EXCEPTION 'expected pending_review on webhook failure, got %', v_res->>'status';
  END IF;

  -- rule survived (not rolled back) and stays at 'review'
  SELECT status INTO v_status FROM public.expert_rules WHERE id = v_rule_id;
  IF v_status <> 'review' THEN
    RAISE EXCEPTION 'expected rule status review, got % (rolled back?)', COALESCE(v_status, '<missing>');
  END IF;

  -- queue row survived and stays PENDING (reviewable by review_moderation_item)
  SELECT status INTO v_qstatus
    FROM public.knowledge_moderation_queue
   WHERE resource_type = 'expert_rule' AND resource_id = v_rule_id
   ORDER BY created_at DESC LIMIT 1;
  IF v_qstatus IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'expected pending queue row, got % (rolled back?)', COALESCE(v_qstatus, '<missing>');
  END IF;

  -- cleanup
  DELETE FROM public.knowledge_moderation_queue
   WHERE resource_type = 'expert_rule' AND resource_id = v_rule_id;
  DELETE FROM public.expert_rules WHERE id = v_rule_id;
END $$;
`);

      expect(run).not.toThrow();
    },
  );
});
