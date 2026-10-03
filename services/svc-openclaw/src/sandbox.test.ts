/**
 * Smoke tests for sandbox.ts — pure logic, no network.
 * Run via `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { sandboxWorkflow } from './sandbox.js';

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  level: 'info',
  child: () => noopLog,
  silent: () => {},
  isLevelEnabled: () => true,
  bindings: () => ({}),
  flush: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('sandboxWorkflow', () => {
  it('blocks workflow with no nodes array', async () => {
    const r = await sandboxWorkflow({ workflow: { name: 'empty' } }, noopLog);
    expect(r.ok).toBe(false);
    expect(r.warnings.find((w) => w.reason === 'no_nodes_array_in_workflow')).toBeDefined();
  });

  it('accepts workflow with valid nodes (advisory warnings only)', async () => {
    const r = await sandboxWorkflow(
      {
        workflow: {
          nodes: [
            { name: 'fetch', type: 'http', url: 'http://localhost:8080/api' },
            { name: 'process', type: 'rpc_call' },
          ],
        },
      },
      noopLog,
    );
    expect(r.ok).toBe(true);
    expect(r.step_count).toBe(2);
    expect(r.simulated_effects).toHaveLength(2);
  });

  it('flags side-effect node targeting prod domain without confirm', async () => {
    const r = await sandboxWorkflow(
      {
        workflow: {
          nodes: [
            {
              name: 'send-message',
              type: 'slack',
              endpoint: 'https://hooks.aisha.guru/slack/T123',
            },
          ],
        },
      },
      noopLog,
    );
    expect(r.ok).toBe(true); // advisory, not blocking
    expect(
      r.warnings.find((w) => w.reason.includes('side_effect_targets_prod_domain_without_confirm')),
    ).toBeDefined();
  });

  it('allows side-effect node when sandbox:true is set', async () => {
    const r = await sandboxWorkflow(
      {
        workflow: {
          nodes: [
            {
              name: 'send-message',
              type: 'slack',
              endpoint: 'https://hooks.aisha.guru/slack/T123',
              sandbox: true,
            },
          ],
        },
      },
      noopLog,
    );
    expect(
      r.warnings.find((w) => w.reason.includes('side_effect_targets_prod_domain_without_confirm')),
    ).toBeUndefined();
  });

  it('parses workflow when passed as JSON string', async () => {
    const r = await sandboxWorkflow(
      { workflow: JSON.stringify({ nodes: [{ name: 'n1', type: 'http' }] }) },
      noopLog,
    );
    expect(r.ok).toBe(true);
    expect(r.step_count).toBe(1);
  });

  it('blocks node count exceeding safety cap', async () => {
    const nodes = Array.from({ length: 101 }, (_, i) => ({ name: `n${i}`, type: 'http' }));
    const r = await sandboxWorkflow({ workflow: { nodes } }, noopLog);
    expect(r.ok).toBe(false);
    expect(r.warnings.find((w) => w.reason.includes('node_count_exceeds_safety_cap'))).toBeDefined();
  });

  it('flags missing node type as info warning', async () => {
    const r = await sandboxWorkflow({ workflow: { nodes: [{ name: 'untyped' }] } }, noopLog);
    expect(r.warnings.find((w) => w.reason === 'missing_node_type')).toBeDefined();
  });

  it('rejects unparseable JSON string', async () => {
    const r = await sandboxWorkflow({ workflow: '{not-json}' }, noopLog);
    expect(r.ok).toBe(false);
    expect(r.warnings.find((w) => w.reason === 'workflow_not_parseable_json')).toBeDefined();
  });
});
