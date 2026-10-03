/**
 * Gate: PR6 — resolver-policy + decision-lens admin UI (#39 #40).
 *
 * Locks the GUI wiring of the operator-control + observability surface (the render itself is
 * confirmed live by the owner — the gates can't render):
 *   - useResolverGovernance calls the three RPCs (list/set policy + get decisions);
 *   - ResolverPolicyCard (the weights editor) is mounted in MissionControl;
 *   - DecisionLensCard (the why+cost drilldown) is mounted in AdminAiObservability.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const HOOK = read('src/hooks/useResolverGovernance.ts');
const CARD = read('src/components/admin/mission-control/ResolverPolicyCard.tsx');
const LENS = read('src/components/admin/mission-control/DecisionLensCard.tsx');
const MC = read('src/pages/admin/MissionControl.tsx');
const OBS = read('src/pages/admin/AdminAiObservability.tsx');

describe('#39 #40 — resolver-policy + decision-lens admin UI', () => {
  it('the hook calls the three audited/admin RPCs (the only write path is the audited RPC)', () => {
    expect(HOOK).toMatch(/aisha\.rpc\("list_ai_resolver_policies"\)/);
    expect(HOOK).toMatch(/aisha\.rpc\("set_ai_resolver_policy_audited"/);
    expect(HOOK).toMatch(/aisha\.rpc\("get_ai_decisions_admin"/);
    // zod-validated at runtime (the rpc client is name-permissive).
    expect(HOOK).toMatch(/ResolverPolicyArraySchema\.safeParse/);
    expect(HOOK).toMatch(/AiDecisionArraySchema\.safeParse/);
  });

  it('ResolverPolicyCard edits weights via the hook + fails loud on a missing global policy', () => {
    expect(CARD).toMatch(/useResolverPolicies/);
    expect(CARD).toMatch(/useSetResolverPolicy/);
    expect(CARD).toMatch(/scope_type === "global" && p\.task_kind === null/); // edits the global row
    expect(CARD).toMatch(/benchWeight|localBonus|costMatchWeight/);            // tunes the weights
    expect(CARD).toMatch(/the resolver will fail loud/i);                      // surfaces the fail-loud invariant
  });

  it('DecisionLensCard renders the candidate ranking + estimated-vs-actual cost', () => {
    expect(LENS).toMatch(/useAiDecisions/);
    expect(LENS).toMatch(/estimated_cost/);
    expect(LENS).toMatch(/actual_cost/);
    expect(LENS).toMatch(/candidates\.map/);  // the per-candidate ranking
    expect(LENS).toMatch(/c\.score|c\.reason/); // the score breakdown
  });

  it('both surfaces are mounted (control in MissionControl, observability in AdminAiObservability)', () => {
    expect(MC).toMatch(/import \{ ResolverPolicyCard \}/);
    expect(MC).toMatch(/<ResolverPolicyCard \/>/);
    expect(OBS).toMatch(/import \{ DecisionLensCard \}/);
    expect(OBS).toMatch(/<DecisionLensCard \/>/);
  });
});
