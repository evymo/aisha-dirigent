import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Graph-depth column-SoT RUNTIME test — proves, against a REAL cold-started DB
 * (throwaway pg17 via `npm run test:db`), that the seed lands the consolidated
 * shape: knowledge-graph traversal depth/per_seed live on the typed
 * context_profiles columns (the single SoT read by both compose_context and the
 * explainability panel), and the graph_context JSONB carries only presentation
 * config. Complements the static gate (graph-depth-column-sot.gate.test.ts).
 *
 * RAISE inside the DO block → non-zero psql exit → psqlMultiline throws → fail.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("Graph-depth column SoT");
});

describe("context_profiles graph-depth column SoT (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "seed tunes the typed columns and the JSONB carries no depth/per_seed",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_depth int;
  v_active int;
  r record;
BEGIN
  -- evidence_strict runs deep/deliberative retrieval → deeper than the default 2
  SELECT graph_depth INTO v_depth FROM public.context_profiles WHERE slug = 'evidence_strict';
  IF v_depth IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'evidence_strict graph_depth: expected 3, got %', v_depth;
  END IF;

  -- at least one profile actually got the graph layer (sanity)
  SELECT count(*) INTO v_active FROM public.context_profiles
    WHERE priority_order @> ARRAY['graph_context'];
  IF v_active = 0 THEN RAISE EXCEPTION 'no graph-active profiles were seeded'; END IF;

  -- every graph-active profile: per_seed unified onto the column (=8), and the
  -- JSONB graph_context carries only presentation config (enabled/max_edges) —
  -- never depth/per_seed (those would shadow the column).
  FOR r IN
    SELECT slug, graph_per_seed AS ps, layers->'graph_context' AS gc
    FROM public.context_profiles
    WHERE priority_order @> ARRAY['graph_context']
  LOOP
    IF r.ps IS DISTINCT FROM 8 THEN
      RAISE EXCEPTION '% graph_per_seed: expected 8, got %', r.slug, r.ps;
    END IF;
    IF r.gc ? 'depth' OR r.gc ? 'per_seed' THEN
      RAISE EXCEPTION '% graph_context JSONB still carries depth/per_seed: %', r.slug, r.gc;
    END IF;
    IF NOT (r.gc ? 'enabled') THEN
      RAISE EXCEPTION '% graph_context JSONB missing enabled: %', r.slug, r.gc;
    END IF;
  END LOOP;

  -- chat_lightweight stays lean: NO graph layer at all
  IF EXISTS (
    SELECT 1 FROM public.context_profiles
    WHERE slug = 'chat_lightweight' AND priority_order @> ARRAY['graph_context']
  ) THEN
    RAISE EXCEPTION 'chat_lightweight must stay lean (no graph layer)';
  END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
