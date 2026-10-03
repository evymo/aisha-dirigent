/**
 * Static defense committer flow gate (Phase 10 of defense-in-depth)
 *
 * Verifies the WF_STATIC_DEFENSE_COMMITTER n8n workflow:
 *   - Triggered by operator/Aisha after publish_static_defense_rule succeeds
 *   - Fetches active rules from DB
 *   - Generates YAML inline (mirroring scripts/gen-static-defense.mjs)
 *   - Creates Forgejo branch + writes YAML + opens PR
 *   - Logs to audit_journal
 *
 * Why a gate: the n8n workflow could silently break (someone edits a node,
 * removes a step, changes endpoint). Without gate enforcement, the
 * autonomy loop would appear to publish rules but YAML would never reach
 * repo + CI would never detect drift between DB and committed YAML.
 *
 * Also enforces: YAML-generation logic in the workflow's Code node MUST
 * stay in sync with scripts/gen-static-defense.mjs renderSemgrepYaml(). If
 * they drift, the committer would produce different bytes than the
 * generator + CI gate would fail every commit. Tested below by checking
 * both implementations have the same SEMGREP_HEADER template + key logic
 * markers.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = resolve(ROOT, 'n8n/workflows/WF_STATIC_DEFENSE_COMMITTER.json');
const GENERATOR_SCRIPT = resolve(ROOT, 'scripts/gen-static-defense.mjs');

interface N8nWorkflow {
  name: string;
  nodes: Array<{ id: string; name: string; type: string; parameters?: Record<string, unknown> }>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

describe('Static defense committer flow gate (Phase 10)', () => {
  test('WF_STATIC_DEFENSE_COMMITTER workflow file exists', () => {
    expect(existsSync(WORKFLOW), `Missing workflow: ${WORKFLOW}`).toBe(true);
  });

  test('workflow JSON parses as well-formed n8n structure', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    expect(wf.name).toBe('WF_STATIC_DEFENSE_COMMITTER');
    expect(Array.isArray(wf.nodes)).toBe(true);
    expect(wf.nodes.length).toBeGreaterThanOrEqual(8);
    expect(wf.settings?.executionOrder).toBe('v1');
    expect(wf.settings?.callerPolicy).toBe('workflowsFromSameOwner');
  });

  test('workflow has required nodes for the autonomy loop', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const nodeNames = wf.nodes.map((n) => n.name);
    for (const required of [
      'Committer Webhook',
      'Validate Input',
      'Fetch Active Rules',
      'Generate YAML',
      'Create Forgejo Branch',
      'Write Regenerated YAML',
      'Create Pull Request',
      'Log Success',
      'Respond OK',
    ]) {
      expect(
        nodeNames,
        `Workflow must contain node "${required}" (full autonomy loop completeness)`,
      ).toContain(required);
    }
  });

  test('Fetch Active Rules calls aisha_get_active_static_defense_rules RPC', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const fetch = wf.nodes.find((n) => n.name === 'Fetch Active Rules');
    expect(fetch).toBeDefined();
    expect(fetch!.type).toBe('n8n-nodes-aisha.aishaRpc');
    expect((fetch!.parameters as { functionName?: string })?.functionName)
      .toBe('aisha_get_active_static_defense_rules');
    expect((fetch!.parameters as { authMode?: string })?.authMode).toBe('service_role');
  });

  test('Generate YAML node mirrors generator script logic', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const generate = wf.nodes.find((n) => n.name === 'Generate YAML');
    expect(generate).toBeDefined();
    const code = (generate!.parameters as { jsCode?: string })?.jsCode ?? '';

    // Must build the AUTO-GENERATED header verbatim (drift detection)
    expect(code).toContain('AUTO-GENERATED from public.aisha_static_defense_rules');
    expect(code).toContain('DO NOT EDIT MANUALLY');
    // Must process pattern-either + paths + severity (canonical shape)
    expect(code).toContain('pattern-either');
    expect(code).toContain('severity');
    expect(code).toContain('languages');
    // Must reference YAML output path used by Semgrep workflow
    expect(code).toContain('.semgrep/aisha-rules.yml');
  });

  test('YAML header in workflow matches the generator script header', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const generate = wf.nodes.find((n) => n.name === 'Generate YAML');
    const wfCode = (generate!.parameters as { jsCode?: string })?.jsCode ?? '';

    const scriptContent = readFileSync(GENERATOR_SCRIPT, 'utf-8');

    // Both must emit the same set of key header lines. We don't compare
    // byte-for-byte (n8n escaping diffs) but we compare the meaningful
    // anchors that must agree for output to be drift-free.
    const requiredAnchors = [
      'AISHA orchestrator',
      'AUTO-GENERATED',
      'DO NOT EDIT MANUALLY',
      'INSERT/UPDATE in aisha_static_defense_rules',
      'Rule severity convention',
      'ERROR',
      'WARNING',
      'INFO',
    ];
    for (const anchor of requiredAnchors) {
      expect(
        wfCode,
        `Generate YAML node must contain header anchor "${anchor}" (drift from generator script causes CI failures)`,
      ).toContain(anchor);
      expect(
        scriptContent,
        `Generator script must contain header anchor "${anchor}"`,
      ).toContain(anchor);
    }
  });

  test('Create Forgejo Branch posts to Forgejo API', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const branch = wf.nodes.find((n) => n.name === 'Create Forgejo Branch');
    expect(branch).toBeDefined();
    expect(branch!.type).toBe('n8n-nodes-base.httpRequest');
    const params = branch!.parameters as { method?: string; url?: string };
    expect(params.method).toBe('POST');
    expect(params.url).toMatch(/FORGEJO_API_URL/);
    expect(params.url).toMatch(/\/branches/);
  });

  test('Create Pull Request opens PR against main', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const pr = wf.nodes.find((n) => n.name === 'Create Pull Request');
    expect(pr).toBeDefined();
    const jsonBody = (pr!.parameters as { jsonBody?: string })?.jsonBody ?? '';
    expect(jsonBody).toContain('"base": "main"');
  });

  test('Log Success writes to audit_journal via log_integration_action', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const log = wf.nodes.find((n) => n.name === 'Log Success');
    expect(log).toBeDefined();
    expect((log!.parameters as { functionName?: string })?.functionName)
      .toBe('log_integration_action');
    // auditTrail option must be ON for this audit-critical call
    const options = (log!.parameters as { options?: { auditTrail?: boolean } })?.options;
    expect(options?.auditTrail).toBe(true);
  });

  test('webhook path is namespaced + matches discovery convention', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const trigger = wf.nodes.find((n) => n.name === 'Committer Webhook');
    expect(trigger).toBeDefined();
    expect((trigger!.parameters as { path?: string })?.path)
      .toBe('static-defense-committer');
  });

  test('every aishaRpc node has onError continueRegularOutput (n8n integrity)', () => {
    const wf = JSON.parse(readFileSync(WORKFLOW, 'utf-8')) as N8nWorkflow;
    const rpcNodes = wf.nodes.filter((n) => n.type.startsWith('n8n-nodes-aisha.'));
    expect(rpcNodes.length).toBeGreaterThanOrEqual(2);
    for (const node of rpcNodes) {
      const params = node.parameters as { onError?: string };
      expect(
        params.onError,
        `aishaRpc node "${node.name}" must have parameters.onError='continueRegularOutput'`,
      ).toBe('continueRegularOutput');
    }
  });
});
