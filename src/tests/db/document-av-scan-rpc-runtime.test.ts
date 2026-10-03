/**
 * Document AV-Scan RPC Runtime
 *
 * Behavioral coverage of record_document_av_scan_audited — the byte/file-stage AV verdict
 * recorder for uploaded documents (member_health_documents), the upload-path sibling of
 * record_comm_av_scan_audited. Asserts the FAIL-CLOSED contract:
 *   clean    → quarantine_status='clear' + the durable (promoted) file_path is stamped
 *   infected → quarantine_status='quarantined' + signature stored
 *   error    → quarantine_status='flagged' (scan failure stays blocked)
 *   bad verdict → 22023; non-service-role caller → 42501
 *
 * Runs against a real PostgreSQL with the baseline applied (cold-start / throwaway). Skips
 * cleanly when no PostgreSQL is reachable. Every mutation runs inside a ROLLED-BACK
 * transaction. The fixture row is created under session_replication_role='replica' so the
 * synthetic user_id need not reference a seeded auth user (FK + triggers bypassed; CHECK
 * constraints — including the quarantine_status value set — remain enforced).
 *
 * psqlMultiline does NOT set ON_ERROR_STOP, so we set it in-band: any assertion RAISE aborts
 * psql → psqlMultiline throws → the test fails. On success the ROLLBACK discards the fixture.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const AV_DOC_SIG = "public.record_document_av_scan_audited(uuid,text,text,text,text,jsonb)";

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Document AV-Scan RPC Runtime");
});

describe("document AV-scan RPC runtime (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "grants: anon + authenticated blocked; service_role allowed (system worker only)",
    () => {
      const row = psqlQuery(`SELECT
        has_function_privilege('anon','${AV_DOC_SIG}','EXECUTE')          ,
        has_function_privilege('authenticated','${AV_DOC_SIG}','EXECUTE') ,
        has_function_privilege('service_role','${AV_DOC_SIG}','EXECUTE')`);
      const [anon, auth, svc] = row.split("|");
      expect(anon).toBe("f");
      expect(auth).toBe("f"); // the scanner is a system worker, never a member
      expect(svc).toBe("t");
    },
  );

  it.skipIf(!dbAvailable)(
    "fail-closed verdict transitions: clean→clear(+promote), infected→quarantined(+sig), error→flagged; bad verdict + non-service-role rejected",
    () => {
      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_doc  uuid;
  v_res  jsonb;
  v_q       text;
  v_path    text;
  v_sig     text;
  v_scanned timestamptz;
BEGIN
  -- Fixture: bypass FK-to-auth-user + triggers (CHECK constraints stay enforced).
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.member_health_documents
    (user_id, file_name, file_path, file_size, mime_type, category, processing_status, quarantine_status)
  VALUES
    (v_user, 'scan.pdf', v_user::text || '/orig.pdf', 100, 'application/pdf',
     'other'::health_document_category, 'pending'::document_processing_status, 'flagged')
  RETURNING id INTO v_doc;

  -- Act as the system scan worker.
  PERFORM set_config('role', 'service_role', true);

  -- 1) clean → clear, and the durable (promoted) path is stamped onto file_path.
  v_res := public.record_document_av_scan_audited(
             v_doc, 'clean', 'clamav', NULL, 'health-documents/' || v_user::text || '/orig.pdf');
  IF v_res->>'quarantine_status' <> 'clear' THEN
    RAISE EXCEPTION 'clean verdict returned %, expected clear', v_res->>'quarantine_status';
  END IF;
  IF (v_res->>'blocked')::boolean THEN RAISE EXCEPTION 'clean must not be blocked'; END IF;
  SELECT quarantine_status, file_path, av_signature, av_scanned_at INTO v_q, v_path, v_sig, v_scanned
    FROM public.member_health_documents WHERE id = v_doc;
  IF v_q <> 'clear' THEN RAISE EXCEPTION 'row quarantine_status % not clear', v_q; END IF;
  IF v_path NOT LIKE 'health-documents/%' THEN RAISE EXCEPTION 'durable path not stamped: %', v_path; END IF;
  IF v_sig IS NOT NULL THEN RAISE EXCEPTION 'clean must clear av_signature, got %', v_sig; END IF;
  IF v_scanned IS NULL THEN RAISE EXCEPTION 'av_scanned_at not stamped'; END IF;

  -- 2) infected → quarantined + signature retained.
  PERFORM public.record_document_av_scan_audited(v_doc, 'infected', 'clamav', 'Eicar-Test-Signature');
  SELECT quarantine_status, av_signature INTO v_q, v_sig
    FROM public.member_health_documents WHERE id = v_doc;
  IF v_q <> 'quarantined' THEN RAISE EXCEPTION 'infected verdict → %, expected quarantined', v_q; END IF;
  IF v_sig <> 'Eicar-Test-Signature' THEN RAISE EXCEPTION 'signature not stored: %', v_sig; END IF;

  -- 3) error → flagged (fail-closed: a scan failure must NOT pass).
  PERFORM public.record_document_av_scan_audited(v_doc, 'error', 'clamav');
  SELECT quarantine_status INTO v_q FROM public.member_health_documents WHERE id = v_doc;
  IF v_q <> 'flagged' THEN RAISE EXCEPTION 'error verdict → %, expected flagged', v_q; END IF;

  -- 4) invalid verdict rejected (22023).
  BEGIN
    PERFORM public.record_document_av_scan_audited(v_doc, 'maybe');
    RAISE EXCEPTION 'expected invalid-verdict rejection';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- 5) role guard: a non-service-role caller is denied (42501) before any mutation.
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.record_document_av_scan_audited(v_doc, 'clean');
    RAISE EXCEPTION 'expected service-role-only rejection';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  RAISE NOTICE 'record_document_av_scan_audited runtime OK';
END $$;
ROLLBACK;
`);
    },
  );
});
