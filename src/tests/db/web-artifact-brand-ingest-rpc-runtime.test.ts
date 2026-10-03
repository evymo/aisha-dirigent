import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Brand-aware web-artifact ingest — RPC runtime tests (real DB).
 *
 * Exercises the multi-domain seed path that svc-web-artifact /seed-default drives
 * at boot as service_role (sub-less system runner, auth.uid() NULL):
 *   seed_branding_site (hostname-keyed, idempotent) → brand-scoped
 *   upsert_web_page_admin → host-aware get_web_page_by_slug → upsert_translations,
 *   then the full ingest chain ensure_stack_default_story → start → mark →
 *   complete → upsert → apply, publishing a brand-scoped page with canvas.
 *
 * Guards the systemic fix that made the page/version/translation layer
 * service_role-aware (upsert_web_page_admin, upsert_translations,
 * apply_web_artifact_to_page, create_web_page_version), and the create_web_page_version
 * "skip empty snapshot" fix that lets the FIRST seed of a fresh page succeed.
 *
 * Single ON_ERROR_STOP psql script wrapped in BEGIN/ROLLBACK → asserts via RAISE,
 * leaves no trace. A RAISE → non-zero psql exit → throws → the test fails.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("Brand-Aware Web-Artifact Ingest RPC Runtime");
});

describe("Brand-aware web-artifact ingest (service_role, local DB)", () => {
  it.skipIf(!dbAvailable)(
    "seeds two brand sites + publishes a brand-scoped page through the full ingest chain",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
-- FK prerequisite (seed already has these; harmless under ROLLBACK).
INSERT INTO public.supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
VALUES ('cs','Čeština','languages.cs.name',true,true,1), ('en','English','languages.en.name',true,false,2)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  id1 uuid; id2 uuid; id3 uuid;
  v_profiles int; v_maps int; v_pageid uuid; v_pageid2 uuid; v_resolved uuid; v_variant text;
  v_story uuid; v_job uuid; v_chain_page uuid;
BEGIN
  -- The boot path runs as the real DB role service_role, not as the migration
  -- superuser. Verify grants explicitly so PostgREST cannot fail before the
  -- SECURITY DEFINER/INVOKER auth branches run.
  IF NOT has_function_privilege('service_role', 'public.seed_branding_site(text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.upsert_web_page_admin(uuid,text,text,text,text,integer,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.upsert_translations(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_web_artifact_to_page(uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_web_page_version(uuid,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'service_role execute grants missing in brand-ingest chain';
  END IF;

  -- Idempotent (hostname-keyed) brand seed.
  id1 := public.seed_branding_site('corp.test.aisha.guru', 'corp', 'Evymo', '/');
  id2 := public.seed_branding_site('corp.test.aisha.guru', 'corp', 'Evymo', '/');
  IF id1 IS NULL OR id2 <> id1 THEN RAISE EXCEPTION 'seed_branding_site idempotency FAIL'; END IF;
  id3 := public.seed_branding_site('aisha.test.aisha.guru', 'aisha', 'AISHA', NULL);
  IF id3 = id1 THEN RAISE EXCEPTION 'distinct-brand FAIL'; END IF;

  SELECT count(*) INTO v_profiles FROM public.branding_profiles
    WHERE id IN (id1, id3) AND partner_id IS NULL AND status = 'published';
  IF v_profiles <> 2 THEN RAISE EXCEPTION 'expected 2 published platform brands, got %', v_profiles; END IF;
  SELECT count(*) INTO v_maps FROM public.branding_hostname_mapping
    WHERE hostname IN ('corp.test.aisha.guru', 'aisha.test.aisha.guru');
  IF v_maps <> 2 THEN RAISE EXCEPTION 'expected 2 hostname mappings, got %', v_maps; END IF;
  SELECT brand_variant INTO v_variant FROM public.branding_hostname_mapping WHERE hostname = 'corp.test.aisha.guru';
  IF v_variant <> 'corp' THEN RAISE EXCEPTION 'corp brand_variant wrong: %', v_variant; END IF;

  -- Brand-scoped page upsert + host-aware resolution.
  v_pageid := public.upsert_web_page_admin(
    p_slug := 'index', p_title_key := 'web.hero.title', p_description_key := 'web.hero.subtitle',
    p_status := 'published', p_branding_profile_id := id1);
  v_pageid2 := public.upsert_web_page_admin(
    p_slug := 'index', p_title_key := 'web.hero.title', p_description_key := 'web.hero.subtitle',
    p_status := 'published', p_branding_profile_id := id1);
  IF v_pageid2 IS DISTINCT FROM v_pageid THEN RAISE EXCEPTION 'brand page upsert idempotency FAIL'; END IF;
  SELECT id INTO v_resolved FROM public.get_web_page_by_slug('index', 'corp.test.aisha.guru');
  IF v_resolved IS DISTINCT FROM v_pageid THEN RAISE EXCEPTION 'host resolve FAIL: % vs %', v_resolved, v_pageid; END IF;

  -- Translations ingest.
  PERFORM public.upsert_translations(
    '[{"key":"web.hero.title","locale":"cs","value":"Pořiďte si Aishu. Je zdarma.","namespace":"web"},
      {"key":"web.hero.title","locale":"en","value":"Get Aisha. It''s free.","namespace":"web"}]'::jsonb);
  PERFORM 1 FROM public.translations WHERE namespace='web' AND key='web.hero.title' AND locale='cs';
  IF NOT FOUND THEN RAISE EXCEPTION 'translation not upserted'; END IF;

  -- Full service_role ingest chain → publish a brand page with canvas (the
  -- create_web_page_version empty-snapshot fix lets this fresh page apply).
  v_story := public.ensure_stack_default_story();
  v_job := public.start_web_artifact_ingest(
    p_story_id := v_story, p_kind := 'ingest_upload', p_source_type := 'default_seed',
    p_idempotency_key := 'verify-brand-ingest-corp', p_metadata := '{}'::jsonb);
  PERFORM public.mark_web_artifact_processing(v_job);
  PERFORM public.complete_web_artifact_ingest(
    p_job_id := v_job, p_canvas_data := '{"pages":[{"frames":[{"component":{}}]}]}'::jsonb,
    p_canvas_html := '<section data-i18n-key="web.hero.title">x</section>',
    p_canvas_css := 'section{}', p_extracted_tokens := NULL, p_metadata := '{}'::jsonb);
  v_chain_page := public.upsert_web_page_admin(
    p_slug := 'corp-chain', p_title_key := 'web.hero.title', p_status := 'published',
    p_branding_profile_id := id1);
  PERFORM public.apply_web_artifact_to_page(p_job_id := v_job, p_page_id := v_chain_page, p_publish := true);
  PERFORM 1 FROM public.web_pages
    WHERE id = v_chain_page AND canvas_data IS NOT NULL AND status = 'published' AND branding_profile_id = id1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ingest chain FAIL: brand page not published with canvas'; END IF;
END $$;
ROLLBACK;
`);
      expect(run).not.toThrow();
    },
  );
});
