import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMA_REFS, getAllSchemas, getSchema } from './index.js';

function freshAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}

describe('contract registry', () => {
  it('loads every declared schema and refuses unknown refs', () => {
    expect(getAllSchemas().size).toBe(SCHEMA_REFS.length);
    // @ts-expect-error — unknown ref must be rejected, not coerced
    expect(() => getSchema('acs.nonsense@9.9')).toThrow(/unknown schema ref/);
  });

  it('every schema compiles under ajv strict mode (2020-12)', () => {
    const ajv = freshAjv();
    for (const ref of SCHEMA_REFS) {
      expect(() => ajv.compile(getSchema(ref)), ref).not.toThrow();
    }
  });

  it('envelope: accepts a canonical message and rejects control-plane noise', () => {
    const ajv = freshAjv();
    const validate = ajv.compile(getSchema('acs.envelope@1.0'));
    const good = {
      envelope: {
        message_id: '01JZX0000000000000000000AB',
        schema: 'acs.task.assign@1.0',
        intent_id: 'int_01JZX0000000000000000000AA',
        correlation_id: '01JZX0000000000000000000AC',
        causation_id: null,
        sender: 'svc-ai-chat.planner',
        recipient: 'svc-agent-runner',
        sent_at: '2026-07-08T12:00:00Z',
        signature: null,
        trust: { source_class: 'internal', derived: false, source_ref: null },
      },
      payload: {},
    };
    expect(validate(good), JSON.stringify(validate.errors)).toBe(true);

    // Unknown envelope field = reject, don't coerce (R4)
    const noisy = structuredClone(good) as unknown as { envelope: Record<string, unknown> };
    noisy.envelope.mood = 'confident';
    expect(validate(noisy)).toBe(false);

    // Missing intent anchor = no lineage = invalid (R3)
    const anchorless = structuredClone(good) as unknown as { envelope: Record<string, unknown> };
    delete anchorless.envelope.intent_id;
    expect(validate(anchorless)).toBe(false);

    // Prose in a control field = invalid (R2)
    const prose = structuredClone(good) as unknown as { envelope: Record<string, unknown> };
    prose.envelope.sender = 'the planner agent, feeling helpful';
    expect(validate(prose)).toBe(false);
  });

  it('task.result: status is a closed enum', () => {
    const ajv = freshAjv();
    const validate = ajv.compile(getSchema('acs.task.result@1.0'));
    const base = {
      status: 'completed',
      intent_ref: 'int_01JZX0000000000000000000AA',
      output_ref: { kind: 'document', id: 'doc-1' },
      metrics: { duration_ms: 10 },
    };
    expect(validate(base), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...base, status: 'done-ish, mostly' })).toBe(false);
  });

  it('effect.decision binds to the exact params hash', () => {
    const ajv = freshAjv();
    const validate = ajv.compile(getSchema('acs.effect.decision@1.0'));
    const ok = {
      effect_id: 'eff_01JZX0000000000000000000AB',
      decision: 'confirm',
      decided_by: 'constraint_check',
      params_sha256: 'a'.repeat(64),
    };
    expect(validate(ok), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...ok, params_sha256: 'not-a-hash' })).toBe(false);
  });

  it('workflow.graph: mirrors reflection graph shape and caps sizes', () => {
    const ajv = freshAjv();
    const validate = ajv.compile(getSchema('acs.workflow.graph@1.0'));
    const graph = {
      version: '1.0',
      nodes: [
        { id: 'planner', type: 'tot_planner', config: {} },
        { id: 'expand', type: 'tot_expand', config: { wave_width: 3 } },
      ],
      edges: [{ from: 'planner', to: 'expand', condition: 'tot_action=expand' }],
    };
    expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...graph, nodes: [] })).toBe(false);
  });
});
