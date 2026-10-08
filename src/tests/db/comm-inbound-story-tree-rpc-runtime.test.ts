/**
 * Comm Inbound + Recursive Story Tree RPC Runtime
 *
 * Behavioral / functional coverage of the inbound-communication ingest + recursive
 * story-tree primitives built for the mail/comms system:
 *   - append_inbound_comm_entry_audited  (service_role) — inbound message → story entry,
 *                                          system provenance, idempotent by (channel, external_id)
 *   - promote_entry_to_story_audited      (authenticated/service_role) — an entry becomes the
 *                                          root of its own child story (the recursive tree)
 *
 * Runs against a real PostgreSQL that has the baseline applied (cold-start / throwaway).
 * Skips cleanly when no PostgreSQL is reachable (so the suite never fails for lack of a DB).
 * Every mutation runs inside a transaction that is ROLLED BACK — deterministic, no trace.
 *
 * Complements the offline contract gates (definer-rpc-security, audited-function-integrity)
 * which only parse SQL structure; here we assert the RPCs actually behave.
 *
 * psqlMultiline does NOT set ON_ERROR_STOP, so we set it in-band: any assertion RAISE then
 * aborts psql → psqlMultiline throws → the test fails. On success the ROLLBACK discards the
 * fixture. Point at the stack via AISHA_DB_HOST/PORT/USER/PASSWORD/NAME (see test-env-probe).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

// Od příjmu pošty (2026-10-06) má append devátý parametr p_event_id (e-mail jen po skenu).
const APPEND_SIG = "public.append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb,uuid)";
const PROMOTE_SIG = "public.promote_entry_to_story_audited(uuid,text,jsonb)";
const MOVE_SIG = "public.move_story_entry_audited(uuid,uuid)";
const AV_SIG = "public.record_comm_av_scan_audited(uuid,text,text,text,text,jsonb)";
const MERGE_SIG = "public.merge_stories_audited(uuid,uuid)";

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Comm Inbound + Story Tree RPC Runtime");
});

describe("comm-inbound + recursive story-tree RPC runtime (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "grants: anon blocked on both; service_role allowed; promote also authenticated",
    () => {
      const row = psqlQuery(`SELECT
        has_function_privilege('anon','${APPEND_SIG}','EXECUTE')          ,
        has_function_privilege('service_role','${APPEND_SIG}','EXECUTE')  ,
        has_function_privilege('anon','${PROMOTE_SIG}','EXECUTE')         ,
        has_function_privilege('authenticated','${PROMOTE_SIG}','EXECUTE'),
        has_function_privilege('service_role','${PROMOTE_SIG}','EXECUTE')`);
      const [appAnon, appSvc, promAnon, promAuth, promSvc] = row.split("|");
      expect(appAnon).toBe("f"); // inbound ingest is service-role only
      expect(appSvc).toBe("t");
      expect(promAnon).toBe("f");
      expect(promAuth).toBe("t"); // a partner/member may branch their own story
      expect(promSvc).toBe("t");
    },
  );

  it.skipIf(!dbAvailable)(
    "append ingests an inbound entry (system provenance) + dedups by external_id; promote branches a child story with link + graph edge (e-mail: posta-email-jen-po-skenu)",
    () => {
      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_orig  text := current_user;  -- connection role (superuser) to restore for assertions
  v_story uuid;
  v_res   jsonb;
  v_entry uuid;
  v_child uuid;
BEGIN
  -- fixture as the connection role (RLS bypassed)
  INSERT INTO public.partner_stories (title, status, origin)
  VALUES ('rpc-rt parent story', 'inbox', 'manual')
  RETURNING id INTO v_story;

  -- the system-ingest + promote paths run as service_role
  PERFORM set_config('role', 'service_role', true);

  v_res   := public.append_inbound_comm_entry_audited(
               v_story, 'chat', 'msg-rt-1', 'sender@example.test', 'Hello', 'Body text', NULL, '{}'::jsonb);
  v_entry := (v_res->>'entry_id')::uuid;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'append returned no entry_id'; END IF;
  IF (v_res->>'deduped')::boolean THEN RAISE EXCEPTION 'first ingest was unexpectedly deduped'; END IF;

  -- idempotency: the same provider message must dedup (no second entry)
  IF (public.append_inbound_comm_entry_audited(
        v_story, 'chat', 'msg-rt-1', 'sender@example.test', 'Hello', 'Body text', NULL, '{}'::jsonb)->>'deduped')::boolean
     IS NOT TRUE
    THEN RAISE EXCEPTION 'duplicate external_id was not deduped'; END IF;

  -- promote the inbound entry into its own child story (recursive tree)
  v_child := (public.promote_entry_to_story_audited(v_entry, 'branched matter', '{}'::jsonb)->>'child_story_id')::uuid;
  IF v_child IS NULL THEN RAISE EXCEPTION 'promote returned no child_story_id'; END IF;

  -- restore the connection role for assertions (avoids graph_* RLS read gating)
  PERFORM set_config('role', v_orig, true);

  IF (SELECT entry_type FROM public.story_entries WHERE id = v_entry) <> 'inbound_chat'
    THEN RAISE EXCEPTION 'inbound entry_type must be inbound_chat'; END IF;
  IF (SELECT metadata->>'external_id' FROM public.story_entries WHERE id = v_entry) <> 'msg-rt-1'
    THEN RAISE EXCEPTION 'external_id not persisted on the entry'; END IF;
  IF (SELECT metadata->>'channel' FROM public.story_entries WHERE id = v_entry) <> 'chat'
    THEN RAISE EXCEPTION 'channel not persisted on the entry'; END IF;
  IF (SELECT created_by FROM public.story_entries WHERE id = v_entry) IS NOT NULL
    THEN RAISE EXCEPTION 'inbound entry must have system provenance (created_by NULL)'; END IF;
  IF (SELECT count(*) FROM public.story_entries
        WHERE entry_type = 'inbound_chat' AND metadata->>'external_id' = 'msg-rt-1') <> 1
    THEN RAISE EXCEPTION 'dedup must leave exactly one entry'; END IF;

  IF (SELECT origin FROM public.partner_stories WHERE id = v_child) <> 'promoted_entry'
    THEN RAISE EXCEPTION 'child story origin must be promoted_entry'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.story_links
                 WHERE source_story_id = v_story AND target_story_id = v_child AND link_type = 'extends')
    THEN RAISE EXCEPTION 'parent-child extends story_link missing'; END IF;
  IF (SELECT metadata->>'promoted_to_story_id' FROM public.story_entries WHERE id = v_entry) <> v_child::text
    THEN RAISE EXCEPTION 'source entry was not stamped with promoted_to_story_id'; END IF;
  IF NOT EXISTS (
       SELECT 1
       FROM public.graph_edges e
       JOIN public.graph_nodes s ON s.id = e.source_node_id AND s.source_table = 'partner_stories' AND s.source_id = v_child
       JOIN public.graph_nodes t ON t.id = e.target_node_id AND t.source_table = 'partner_stories' AND t.source_id = v_story
       WHERE e.relationship = 'PART_OF')
    THEN RAISE EXCEPTION 'graph PART_OF (child->parent) edge missing'; END IF;

  RAISE NOTICE 'comm-inbound + story-tree runtime assertions passed';
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );

  it.skipIf(!dbAvailable)(
    "append_inbound_comm_entry_audited rejects a non-service-role caller (grant lockdown)",
    () => {
      // authenticated lacks EXECUTE on the ingest RPC → the call is rejected outright.
      expect(() =>
        psqlQuery(
          `SET ROLE authenticated; SELECT public.append_inbound_comm_entry_audited(` +
            `gen_random_uuid(),'chat','x','a@b.test','s','b',NULL,'{}'::jsonb)`,
        ),
      ).toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "move_story_entry_audited: anon blocked, authenticated/service_role allowed; re-homes the subtree to another story (changes ACL scope) + stamps provenance",
    () => {
      const g = psqlQuery(
        `SELECT has_function_privilege('anon','${MOVE_SIG}','EXECUTE') , ` +
          `has_function_privilege('authenticated','${MOVE_SIG}','EXECUTE') , ` +
          `has_function_privilege('service_role','${MOVE_SIG}','EXECUTE')`,
      );
      const [anon, auth, svc] = g.split("|");
      expect(anon).toBe("f");
      expect(auth).toBe("t");
      expect(svc).toBe("t");

      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_orig  text := current_user;
  v_a     uuid;
  v_b     uuid;
  v_root  uuid;
  v_child uuid;
  v_mv    jsonb;
BEGIN
  INSERT INTO public.partner_stories (title, status, origin) VALUES ('move source A', 'inbox', 'manual') RETURNING id INTO v_a;
  INSERT INTO public.partner_stories (title, status, origin) VALUES ('move target B', 'inbox', 'manual') RETURNING id INTO v_b;

  PERFORM set_config('role', 'service_role', true);
  v_root := (public.append_inbound_comm_entry_audited(v_a, 'chat', 'mv-1', 'a@b.test', 'S', 'Body', NULL, '{}'::jsonb)->>'entry_id')::uuid;
  PERFORM set_config('role', v_orig, true);

  -- a reply under the root, still in story A (the thread)
  INSERT INTO public.story_entries (story_id, parent_id, entry_type, content, created_by)
  VALUES (v_a, v_root, 'inbound_email', 'reply body', NULL) RETURNING id INTO v_child;

  PERFORM set_config('role', 'service_role', true);
  v_mv := public.move_story_entry_audited(v_root, v_b);
  PERFORM set_config('role', v_orig, true);

  IF (v_mv->>'moved_count')::int <> 2
    THEN RAISE EXCEPTION 'expected to move 2 entries (root + reply), got %', v_mv->>'moved_count'; END IF;
  IF (SELECT story_id FROM public.story_entries WHERE id = v_root) IS DISTINCT FROM v_b
    THEN RAISE EXCEPTION 'root entry not re-homed to target story'; END IF;
  IF (SELECT parent_id FROM public.story_entries WHERE id = v_root) IS NOT NULL
    THEN RAISE EXCEPTION 'moved root must have parent_id cleared (becomes top-level in target)'; END IF;
  IF (SELECT metadata->>'moved_from_story_id' FROM public.story_entries WHERE id = v_root) <> v_a::text
    THEN RAISE EXCEPTION 'root not stamped with moved_from_story_id'; END IF;
  IF (SELECT story_id FROM public.story_entries WHERE id = v_child) IS DISTINCT FROM v_b
    THEN RAISE EXCEPTION 'reply (subtree) did not follow the root to the target story'; END IF;
  IF (SELECT parent_id FROM public.story_entries WHERE id = v_child) IS DISTINCT FROM v_root
    THEN RAISE EXCEPTION 'reply must keep its in-subtree parent'; END IF;

  RAISE NOTICE 'move_story_entry_audited subtree + provenance assertions passed';
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );

  it.skipIf(!dbAvailable)(
    "record_comm_av_scan_audited: anon blocked, service_role allowed; clean advances, infected fail-closes (exhausted, never promoted)",
    () => {
      const g = psqlQuery(
        `SELECT has_function_privilege('anon','${AV_SIG}','EXECUTE') , ` +
          `has_function_privilege('service_role','${AV_SIG}','EXECUTE')`,
      );
      const [anon, svc] = g.split("|");
      expect(anon).toBe("f");
      expect(svc).toBe("t");

      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_orig  text := current_user;
  v_story uuid;
  v_e1    uuid;
  v_e2    uuid;
  v_r1    jsonb;
  v_r2    jsonb;
BEGIN
  INSERT INTO public.partner_stories (title, status, origin) VALUES ('av-rt parent', 'inbox', 'manual') RETURNING id INTO v_story;

  PERFORM set_config('role', 'service_role', true);

  v_e1 := (public.record_integration_event('email_inbound', 'av-evt-1', 'email.inbound', NULL, v_story, NULL, NULL, NULL)->>'event_id')::uuid;
  v_e2 := (public.record_integration_event('email_inbound', 'av-evt-2', 'email.inbound', NULL, v_story, NULL, NULL, NULL)->>'event_id')::uuid;

  -- clean → advances (not blocked)
  v_r1 := public.record_comm_av_scan_audited(v_e1, 'clean');
  IF (v_r1->>'blocked')::boolean THEN RAISE EXCEPTION 'clean must not be blocked'; END IF;

  -- infected → fail-closed terminal block
  v_r2 := public.record_comm_av_scan_audited(v_e2, 'infected', 'clamav', 'Eicar-Test-Signature');
  IF (v_r2->>'blocked')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'infected must be blocked'; END IF;

  PERFORM set_config('role', v_orig, true);

  IF (SELECT metadata->'av'->>'verdict' FROM public.integration_events WHERE id = v_e1) <> 'clean'
    THEN RAISE EXCEPTION 'clean verdict not recorded on the event'; END IF;
  IF (SELECT status FROM public.integration_events WHERE id = v_e1) = 'exhausted'
    THEN RAISE EXCEPTION 'clean item must NOT be exhausted'; END IF;

  IF (SELECT metadata->'av'->>'verdict' FROM public.integration_events WHERE id = v_e2) <> 'infected'
    THEN RAISE EXCEPTION 'infected verdict not recorded'; END IF;
  IF (SELECT status FROM public.integration_events WHERE id = v_e2) <> 'exhausted'
    THEN RAISE EXCEPTION 'infected item must be exhausted (terminal block)'; END IF;
  IF (SELECT metadata->'av'->>'signature' FROM public.integration_events WHERE id = v_e2) <> 'Eicar-Test-Signature'
    THEN RAISE EXCEPTION 'infected signature not recorded'; END IF;

  RAISE NOTICE 'record_comm_av_scan_audited assertions passed';
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );

  it.skipIf(!dbAvailable)(
    "merge_stories_audited: anon blocked, authenticated/service_role allowed; re-homes entries + unions participants, leaves source a 'merged' stub linked to target, re-scopes RAG content",
    () => {
      const g = psqlQuery(
        `SELECT has_function_privilege('anon','${MERGE_SIG}','EXECUTE') , ` +
          `has_function_privilege('authenticated','${MERGE_SIG}','EXECUTE') , ` +
          `has_function_privilege('service_role','${MERGE_SIG}','EXECUTE')`,
      );
      const [anon, auth, svc] = g.split("|");
      expect(anon).toBe("f");
      expect(auth).toBe("t");
      expect(svc).toBe("t");

      // RAG isolation + reminders follow the merge (re-scoped to the target).
      const def = psqlQuery(`SELECT pg_get_functiondef('${MERGE_SIG}'::regprocedure)`);
      expect(def).toContain("knowledge_items");
      expect(def).toContain("story_reminders");

      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_orig text := current_user;
  v_src  uuid;
  v_tgt  uuid;
  v_uid  uuid := gen_random_uuid();
  v_res  jsonb;
BEGIN
  INSERT INTO public.partner_stories (title, status, origin) VALUES ('merge source', 'inbox', 'manual') RETURNING id INTO v_src;
  INSERT INTO public.partner_stories (title, status, origin) VALUES ('merge target', 'inbox', 'manual') RETURNING id INTO v_tgt;
  INSERT INTO public.story_participants (story_id, user_id, role) VALUES (v_src, v_uid, 'partner');

  PERFORM set_config('role', 'service_role', true);
  PERFORM public.append_inbound_comm_entry_audited(v_src, 'chat', 'mg-1', 'a@b.test', 'S1', 'B1', NULL, '{}'::jsonb);
  PERFORM public.append_inbound_comm_entry_audited(v_src, 'chat', 'mg-2', 'a@b.test', 'S2', 'B2', NULL, '{}'::jsonb);
  v_res := public.merge_stories_audited(v_src, v_tgt);
  PERFORM set_config('role', v_orig, true);

  IF (v_res->>'merged_entries')::int <> 2
    THEN RAISE EXCEPTION 'expected 2 entries merged, got %', v_res->>'merged_entries'; END IF;
  IF (SELECT count(*) FROM public.story_entries WHERE story_id = v_src) <> 0
    THEN RAISE EXCEPTION 'source must have no entries after merge'; END IF;
  IF (SELECT count(*) FROM public.story_entries WHERE story_id = v_tgt AND metadata->>'merged_from_story_id' = v_src::text) <> 2
    THEN RAISE EXCEPTION 'entries not re-homed + stamped into target'; END IF;
  IF (SELECT status FROM public.partner_stories WHERE id = v_src) <> 'merged'
    THEN RAISE EXCEPTION 'source must be left as status=merged'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.story_links
                 WHERE source_story_id = v_src AND target_story_id = v_tgt
                   AND link_type = 'related_to' AND metadata->>'relation' = 'merged_into')
    THEN RAISE EXCEPTION 'merged_into link missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.story_participants
                 WHERE story_id = v_tgt AND user_id = v_uid AND role = 'partner')
    THEN RAISE EXCEPTION 'participant not unioned into target'; END IF;

  RAISE NOTICE 'merge_stories_audited assertions passed';
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );
});
