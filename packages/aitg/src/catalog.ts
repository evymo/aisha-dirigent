/**
 * Canonical AITG catalog (44 tests, 4 layers). Identical content to the SQL
 * seed in `aisha/db/migrations/20260516144654_aitg_baseline.sql` — the
 * `catalogParity` unit test asserts byte-for-byte equivalence so the two
 * never drift.
 *
 * Code paths that need test metadata (Aisha's MCP tool, the static gate
 * checking "every catalog entry has a probe", the discovery gate) should
 * import from here rather than reading the SQL.
 */

import type { AitgLayer } from './schemas.js';

export interface AitgTestMeta {
  testId: string;
  layer: AitgLayer;
  title: string;
  objective: string;
  remediationRef: string;
  lifecyclePhases: ReadonlyArray<
    'planning' | 'data_prep' | 'development' | 'validation' | 'operation'
  >;
  severityWeight: number;
}

export const AITG_CATALOG: ReadonlyArray<AitgTestMeta> = [
  // ── AI Application Layer (14) ──────────────────────────────────────────────
  { testId: 'AITG-APP-01', layer: 'app', title: 'Testing for Prompt Injection',
    objective: 'Verify the system rejects direct prompt-override attempts.',
    remediationRef: 'AITG-APP-01_Testing_for_Prompt_Injection.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-APP-02', layer: 'app', title: 'Testing for Indirect Prompt Injection',
    objective: 'Verify retrieved content cannot inject instructions into the model.',
    remediationRef: 'AITG-APP-02_Testing_for_Indirect_Prompt_Injection.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-APP-03', layer: 'app', title: 'Testing for Sensitive Data Leak',
    objective: 'Verify no system / training / context data leaks via canary tokens.',
    remediationRef: 'AITG-APP-03_Testing_for_Sensitive_Data_Leak.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 2.0 },
  { testId: 'AITG-APP-04', layer: 'app', title: 'Testing for Input Leakage',
    objective: 'Verify session boundary — user A inputs do not surface in user B context.',
    remediationRef: 'AITG-APP-04_Testing_for_Input_Leakage.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-APP-05', layer: 'app', title: 'Testing for Unsafe Outputs',
    objective: 'Verify output policy blocks unsafe content.',
    remediationRef: 'AITG-APP-05_Testing_for_Unsafe_Outputs.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-06', layer: 'app', title: 'Testing for Agentic Behavior Limits',
    objective: 'Verify tools / scopes / autonomous actions stay within their charter.',
    remediationRef: 'AITG-APP-06_Testing_for_Agentic_Behavior_Limits.md',
    lifecyclePhases: ['development', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-APP-07', layer: 'app', title: 'Testing for Prompt Disclosure',
    objective: 'Verify system prompt cannot be extracted from responses or bundle.',
    remediationRef: 'AITG-APP-07_Testing_for_Prompt_Disclosure.md',
    lifecyclePhases: ['development', 'validation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-08', layer: 'app', title: 'Testing for Embedding Manipulation',
    objective: 'Verify embedding endpoints resist adversarial vector inputs.',
    remediationRef: 'AITG-APP-08_Testing_for_Embedding_Manipulation.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-09', layer: 'app', title: 'Testing for Model Extraction',
    objective: 'Verify API rate-limits and structure-probing defenses.',
    remediationRef: 'AITG-APP-09_Testing_for_Model_Extraction.md',
    lifecyclePhases: ['operation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-10', layer: 'app', title: 'Testing for Content Bias',
    objective: 'Verify demographic-pair responses do not exhibit significant deltas.',
    remediationRef: 'AITG-APP-10_Testing_for_Content_Bias.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-11', layer: 'app', title: 'Testing for Hallucinations',
    objective: 'Verify factuality against golden examples.',
    remediationRef: 'AITG-APP-11_Testing_for_Hallucinations.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-12', layer: 'app', title: 'Testing for Toxic Output',
    objective: 'Verify toxicity classifier blocks harmful responses.',
    remediationRef: 'AITG-APP-12_Testing_for_Toxic_Output.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-APP-13', layer: 'app', title: 'Testing for Over-Reliance on AI',
    objective: 'Verify UX presents uncertainty / disclaimers / human-in-the-loop hooks.',
    remediationRef: 'AITG-APP-13_Testing_for_Over-Reliance.md',
    lifecyclePhases: ['development', 'validation'], severityWeight: 1.0 },
  { testId: 'AITG-APP-14', layer: 'app', title: 'Testing for Explainability and Interpretability',
    objective: 'Verify decisions surface a reason chain / provenance trail.',
    remediationRef: 'AITG-APP-14_Testing_for_Explainability.md',
    lifecyclePhases: ['development', 'validation'], severityWeight: 1.0 },

  // ── AI Model Layer (7) ─────────────────────────────────────────────────────
  { testId: 'AITG-MOD-01', layer: 'mod', title: 'Testing for Evasion Attacks',
    objective: 'Verify model resists adversarial perturbations.',
    remediationRef: 'AITG-MOD-01_Testing_for_Evasion_Attacks.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-MOD-02', layer: 'mod', title: 'Testing for Runtime Model Poisoning',
    objective: 'Verify model registry integrity (hash, signature, provenance).',
    remediationRef: 'AITG-MOD-02_Testing_for_Runtime_Model_Poisoning.md',
    lifecyclePhases: ['development', 'operation'], severityWeight: 2.0 },
  { testId: 'AITG-MOD-03', layer: 'mod', title: 'Testing for Poisoned Training Sets',
    objective: 'Verify training data lineage / signature.',
    remediationRef: 'AITG-MOD-03_Testing_for_Poisoned_Training_Sets.md',
    lifecyclePhases: ['data_prep'], severityWeight: 2.0 },
  { testId: 'AITG-MOD-04', layer: 'mod', title: 'Testing for Membership Inference',
    objective: 'Verify model does not expose training-set membership via response entropy.',
    remediationRef: 'AITG-MOD-04_Testing_for_Membership_Inference.md',
    lifecyclePhases: ['validation'], severityWeight: 1.0 },
  { testId: 'AITG-MOD-05', layer: 'mod', title: 'Testing for Inversion Attacks',
    objective: 'Verify gradient-style queries cannot reconstruct training samples.',
    remediationRef: 'AITG-MOD-05_Testing_for_Inversion_Attacks.md',
    lifecyclePhases: ['validation'], severityWeight: 1.0 },
  { testId: 'AITG-MOD-06', layer: 'mod', title: 'Testing for Robustness to New Data',
    objective: 'Verify performance does not regress on drift dataset.',
    remediationRef: 'AITG-MOD-06_Testing_for_Robustness.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 1.0 },
  { testId: 'AITG-MOD-07', layer: 'mod', title: 'Testing for Goal Alignment',
    objective: 'Verify system prompt matches agent charter / safety contract.',
    remediationRef: 'AITG-MOD-07_Testing_for_Goal_Alignment.md',
    lifecyclePhases: ['development', 'validation'], severityWeight: 1.5 },

  // ── AI Infrastructure Layer (6) ────────────────────────────────────────────
  { testId: 'AITG-INF-01', layer: 'inf', title: 'Testing for Supply Chain Tampering',
    objective: 'Verify integrity hashes, signed registry sources, no :latest tags.',
    remediationRef: 'AITG-INF-01_Testing_for_Supply_Chain.md',
    lifecyclePhases: ['development', 'operation'], severityWeight: 2.0 },
  { testId: 'AITG-INF-02', layer: 'inf', title: 'Testing for Resource Exhaustion',
    objective: 'Verify rate-limits + timeout defenses against DoS / Slowloris.',
    remediationRef: 'AITG-INF-02_Testing_for_Resource_Exhaustion.md',
    lifecyclePhases: ['operation'], severityWeight: 1.0 },
  { testId: 'AITG-INF-03', layer: 'inf', title: 'Testing for Plugin Boundary Violations',
    objective: 'Verify MCP plugin manifest matches actual tool registrations.',
    remediationRef: 'AITG-INF-03_Testing_for_Plugin_Boundary.md',
    lifecyclePhases: ['development', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-INF-04', layer: 'inf', title: 'Testing for Capability Misuse',
    objective: 'Verify no agent has tools beyond its declared scope.',
    remediationRef: 'AITG-INF-04_Testing_for_Capability_Misuse.md',
    lifecyclePhases: ['development', 'operation'], severityWeight: 1.5 },
  { testId: 'AITG-INF-05', layer: 'inf', title: 'Testing for Fine-tuning Poisoning',
    objective: 'Verify FT datasets are signed before training jobs.',
    remediationRef: 'AITG-INF-05_Testing_for_Fine_Tuning_Poisoning.md',
    lifecyclePhases: ['data_prep', 'development'], severityWeight: 2.0 },
  { testId: 'AITG-INF-06', layer: 'inf', title: 'Testing for Dev-Time Model Theft',
    objective: 'Verify no model weights / artifacts committed to repo.',
    remediationRef: 'AITG-INF-06_Testing_for_Dev_Time_Theft.md',
    lifecyclePhases: ['development'], severityWeight: 1.5 },

  // ── AI Data Layer (5) ──────────────────────────────────────────────────────
  { testId: 'AITG-DAT-01', layer: 'dat', title: 'Testing for Training Data Exposure',
    objective: 'Verify no training corpus accessible via public CDN / repo.',
    remediationRef: 'AITG-DAT-01_Testing_for_Training_Data_Exposure.md',
    lifecyclePhases: ['data_prep', 'operation'], severityWeight: 2.0 },
  { testId: 'AITG-DAT-02', layer: 'dat', title: 'Testing for Runtime Exfiltration',
    objective: 'Verify canary tokens never leave the server in response bodies.',
    remediationRef: 'AITG-DAT-02_Testing_for_Runtime_Exfiltration.md',
    lifecyclePhases: ['validation', 'operation'], severityWeight: 2.0 },
  { testId: 'AITG-DAT-03', layer: 'dat', title: 'Testing for Dataset Diversity & Coverage',
    objective: 'Verify RAG corpus declares language / source / demographic metadata.',
    remediationRef: 'AITG-DAT-03_Testing_for_Dataset_Diversity.md',
    lifecyclePhases: ['data_prep'], severityWeight: 1.0 },
  { testId: 'AITG-DAT-04', layer: 'dat', title: 'Testing for Harmful Content in Data',
    objective: 'Verify corpus passes offline toxicity scan before ingest.',
    remediationRef: 'AITG-DAT-04_Testing_for_Harmful_Content.md',
    lifecyclePhases: ['data_prep'], severityWeight: 1.5 },
  { testId: 'AITG-DAT-05', layer: 'dat', title: 'Testing for Data Minimization & Consent',
    objective: 'Verify consent ledger coverage for every sensitive data path.',
    remediationRef: 'AITG-DAT-05_Testing_for_Data_Minimization.md',
    lifecyclePhases: ['data_prep', 'operation'], severityWeight: 2.0 },
];

export const AITG_CATALOG_BY_ID: ReadonlyMap<string, AitgTestMeta> = new Map(
  AITG_CATALOG.map((t) => [t.testId, t]),
);

export function aitgGetMeta(testId: string): AitgTestMeta {
  const meta = AITG_CATALOG_BY_ID.get(testId);
  if (!meta) throw new Error(`AITG_UNKNOWN_TEST_ID: ${testId}`);
  return meta;
}

export function aitgListByLayer(layer: AitgLayer): ReadonlyArray<AitgTestMeta> {
  return AITG_CATALOG.filter((t) => t.layer === layer);
}
