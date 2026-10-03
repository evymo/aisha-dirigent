import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Dynamic runtime selection UNDER AISHA's supervision — real-DB verification that
 * each executor (direct_llm / openclaw / hermes / cli) is chosen WHEN it should be,
 * that the choice is DERIVED from capability-availability (NOT a hardcoded map), and
 * that the dispatch is governed (fn_admit_clow composes a verdict). Operator's bar:
 * "OpenClaw i Hermes — musíme ověřit, že plní svůj účel kdy má, pod dohledem AISHy
 * (parametrizace), nic hardcoded."
 *
 * Runs in `npm run test:db` (real throwaway pg17, in CI). RAISE → test fails.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Runtime Selection + Supervision RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";
// fn_resolve_runtime / fn_admit_clow gate on the PG role GUC + jwt claims.
const SVC = `
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
`;

describe("dynamic runtime selection + supervision (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "derives the RIGHT runtime per task semantics (kdy má): chat→direct_llm, op→openclaw, eval+story→hermes, explicit→cli",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_needs jsonb; v_res jsonb; v_story uuid := gen_random_uuid();
BEGIN
  ${SVC}

  -- A. a plain chat task needs nothing side-effecting → direct_llm (the universal LLM executor)
  v_needs := public.derive_clow_needs(jsonb_build_object('type','chat','description','summarize the meeting notes'));
  IF (v_needs->>'has_capability_need')::boolean THEN RAISE EXCEPTION 'chat wrongly classified as capability-needing: %', v_needs; END IF;
  v_res := public.fn_resolve_runtime(v_needs || jsonb_build_object('purpose','chat'));
  IF v_res->>'runtime' <> 'direct_llm' THEN RAISE EXCEPTION 'chat should resolve direct_llm, got %', v_res; END IF;

  -- B. an operative task (write + web + tools) → openclaw (side-effecting, networked, tool-capable)
  v_needs := public.derive_clow_needs(jsonb_build_object('type','task','description','implement the feature and fetch the web API docs'));
  IF NOT (v_needs->>'needs_write')::boolean OR NOT (v_needs->>'needs_internet')::boolean THEN
    RAISE EXCEPTION 'op task mis-classified (write/internet not derived): %', v_needs; END IF;
  v_res := public.fn_resolve_runtime(v_needs || jsonb_build_object('purpose','op'));
  IF v_res->>'runtime' <> 'openclaw' THEN RAISE EXCEPTION 'op task should resolve openclaw, got %', v_res; END IF;

  -- C. a story-bound evaluation → hermes hint (the reflexive-learning rail). hermes ships
  --    disabled; ENABLING it makes it derivable — itself a parametrization proof.
  v_needs := public.derive_clow_needs(jsonb_build_object('type','evaluate','story_id',v_story::text,'description','evaluate the story outcome'));
  IF v_needs->>'runtime' <> 'hermes' THEN RAISE EXCEPTION 'story-eval should hint hermes, got %', v_needs; END IF;
  UPDATE public.ai_runtime_registry SET is_enabled = true WHERE slug = 'hermes';
  v_res := public.fn_resolve_runtime(v_needs || jsonb_build_object('purpose','eval'));
  IF v_res->>'runtime' <> 'hermes' THEN RAISE EXCEPTION 'enabled hermes should resolve for a story-eval, got %', v_res; END IF;

  -- D. an explicit cli slug → cli (the external CLI driver; derivable only WITH a slug)
  v_res := public.fn_resolve_runtime(jsonb_build_object('purpose','agent','runtime','cli','cli_slug','claude-cli','needs_write',true,'needs_internet',true,'needs_tools',true));
  IF v_res->>'runtime' <> 'cli' THEN RAISE EXCEPTION 'explicit cli slug should resolve cli, got %', v_res; END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "selection is DERIVED, not hardcoded: toggling a runtime's registry row changes the outcome",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_clow jsonb := jsonb_build_object('purpose','op','needs_write',true,'needs_internet',true,'needs_tools',true);
  v_res jsonb;
BEGIN
  ${SVC}

  -- baseline: the op clow resolves openclaw
  v_res := public.fn_resolve_runtime(v_clow);
  IF v_res->>'runtime' <> 'openclaw' THEN RAISE EXCEPTION 'baseline op should be openclaw, got %', v_res; END IF;

  -- DISABLE openclaw → the SAME clow must NOT resolve openclaw any more. If it still did,
  -- the selection would be a hardcoded map, not derived from the registry.
  UPDATE public.ai_runtime_registry SET is_enabled = false WHERE slug = 'openclaw';
  v_res := public.fn_resolve_runtime(v_clow);
  IF v_res->>'runtime' = 'openclaw' THEN
    RAISE EXCEPTION 'openclaw resolved while is_enabled=false — selection is HARDCODED, not capability-derived!';
  END IF;

  -- RE-ENABLE → openclaw returns. The outcome FOLLOWS the registry row = parametrized.
  UPDATE public.ai_runtime_registry SET is_enabled = true WHERE slug = 'openclaw';
  v_res := public.fn_resolve_runtime(v_clow);
  IF v_res->>'runtime' <> 'openclaw' THEN RAISE EXCEPTION 'openclaw not restored after re-enable, got %', v_res; END IF;

  -- CAPABILITY derivation: strip openclaw's can_write → a write-needing clow can no longer
  -- pick it (a need the runtime cannot satisfy is excluded — derived per-row, not listed).
  UPDATE public.ai_runtime_registry SET can_write = false WHERE slug = 'openclaw';
  v_res := public.fn_resolve_runtime(v_clow);
  IF v_res->>'runtime' = 'openclaw' THEN RAISE EXCEPTION 'openclaw chosen for a write task despite can_write=false — capability not derived'; END IF;
  UPDATE public.ai_runtime_registry SET can_write = true WHERE slug = 'openclaw';
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "every dispatch is UNDER SUPERVISION: fn_admit_clow composes a 4-axis verdict",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admit jsonb;
BEGIN
  ${SVC}

  -- the operative clow is admission-composed: spend + runtime-availability + capability + risk
  v_admit := public.fn_admit_clow(
    jsonb_build_object('purpose','op','runtime','openclaw','needs_write',true,'needs_internet',true,'needs_tools',true),
    '{}'::jsonb);
  IF v_admit->>'decision' IS NULL THEN RAISE EXCEPTION 'admission produced no verdict'; END IF;
  IF v_admit->'axis_results'->'runtime' IS NULL
     OR v_admit->'axis_results'->'capability' IS NULL
     OR v_admit->'axis_results'->'risk' IS NULL
     OR v_admit->'axis_results'->'spend' IS NULL THEN
    RAISE EXCEPTION 'admission did not compose all four governed axes: %', v_admit->'axis_results';
  END IF;
  -- runtime axis must reflect the registry (openclaw enabled+capable → allow on that axis)
  IF v_admit->'axis_results'->'runtime'->>'decision' <> 'allow' THEN
    RAISE EXCEPTION 'openclaw runtime axis not allow despite enabled+capable: %', v_admit->'axis_results'->'runtime';
  END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "cli is MULTI-TOOL: AISHA derives + spawns cli:codex-cli the same as cli:claude-cli (nothing tool-specific hardcoded)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE v_res jsonb; v_run uuid; v_slug text;
BEGIN
  ${SVC}

  -- SELECTABLE: AISHA derives cli for an explicit codex slug → slug=cli:codex-cli
  v_res := public.fn_resolve_runtime(jsonb_build_object('purpose','agent','runtime','cli','cli_slug','codex-cli','needs_write',true,'needs_internet',true,'needs_tools',true));
  IF v_res->>'runtime' <> 'cli' OR v_res->>'slug' <> 'cli:codex-cli' THEN
    RAISE EXCEPTION 'codex not derivable as cli:codex-cli, got %', v_res; END IF;

  -- SPAWNABLE: the SAME fn_spawn drives codex via p_cli_slug — the journal records
  -- cli_slug=codex-cli (admission gated cli:codex-cli, not claude-cli). The image
  -- (p_image=agent-codex) picks the agent; nothing tool-specific is hardcoded.
  v_run := public.fn_spawn_claude_cli_run('agent-codex:test','db-codex',jsonb_build_object('prompt','x'),'kata-dragonball',NULL,NULL,'codex-cli');
  SELECT d.cli_slug INTO v_slug FROM public.agent_runs r JOIN public.ai_decisions d ON d.id = r.decision_id WHERE r.id = v_run;
  IF v_slug <> 'codex-cli' THEN RAISE EXCEPTION 'codex spawn journaled wrong cli_slug (expected codex-cli): %', v_slug; END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});
