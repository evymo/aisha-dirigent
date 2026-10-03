import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * REMEDIATION GATE — n8n executeCommand shell-injection.
 *
 * n8n's `n8n-nodes-base.executeCommand` runs its `command` string through a
 * shell. Any `{{ … }}` expression that concatenates a *data value* into that
 * string is a command-injection sink: a value carrying `;`, `$(…)`, backticks,
 * `|`, `&&`, spaces, newlines … executes arbitrary commands on the n8n host.
 *
 * This gate is a PATTERN net over every workflow, not a single-bug check:
 *
 *   R1 — No whole-command-from-data. A command whose entire text is a single
 *        data reference (e.g. `={{ $json.command }}`) is forbidden outright:
 *        there is no charset that makes an arbitrary data-built command safe.
 *
 *   R2 — Validated interpolation. If a command splices a data *value* into
 *        shell text (e.g. `docker restart {{ $json.service }}`), the workflow
 *        must sanitize its shell inputs — a code node containing a charset
 *        check (regex `.test(` / `.match(` / `.replace(/[^…]`) AND a `throw`.
 *        Values that only appear as ternary *conditions* (`$json.force ? '--x' : ''`)
 *        or pure string literals never reach the shell and are exempt.
 *
 * The coarseness of R2 (workflow-level sanitization, not per-field proof) is a
 * deliberate low-false-positive trade-off: it still fails any command-
 * interpolating workflow that does zero sanitization, which is the real risk.
 */

const WORKFLOW_DIRS = ['n8n/workflows', 'packages/n8n-nodes-aisha/workflows'];
const EXEC_TYPE = 'n8n-nodes-base.executeCommand';

/** Data-reference chain: $json.x, $('Node').first().json.y, $input…, $node…. */
const CHAIN =
  /(\$json|\$input|\$item|\$node|\$vars|\$parameter|\$\((?:'[^']*'|"[^"]*")\))((?:\??\.\w+|\(\)|\.first\(\)|\.last\(\)|\.all\(\)|\.item|\[[^\]]*\])*)/g;

/** Strip 'single' and "double" quoted string literals, leaving code structure. */
function stripStringLiterals(s: string): string {
  return s.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** Does `s` (an expression) contain any string literal at all? */
function hasStringLiteral(s: string): boolean {
  return /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/.test(s);
}

type Ref = { field: string; isGuard: boolean };

/** Classify each data reference inside one interpolation expression. */
function classifyRefs(expr: string): Ref[] {
  const bare = stripStringLiterals(expr);
  const refs: Ref[] = [];
  for (const m of bare.matchAll(CHAIN)) {
    const end = (m.index ?? 0) + m[0].length;
    const rest = bare.slice(end).replace(/^\s+/, '');
    const isGuard = rest.startsWith('?'); // ternary condition → value never reaches shell
    const chain = m[2] ?? '';
    const parts = chain.match(/\.\w+/g);
    const field = parts && parts.length ? parts[parts.length - 1].slice(1) : m[1];
    refs.push({ field, isGuard });
  }
  return refs;
}

/** Extract the inner text of every `{{ … }}` interpolation in a command. */
function interpolations(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1].trim());
  return out;
}

interface ExecNode {
  workflow: string;
  file: string;
  node: string;
  command: string;
  workflowCode: string;
}

function collectExecNodes(): ExecNode[] {
  const nodes: ExecNode[] = [];
  for (const dir of WORKFLOW_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const path = join(dir, f);
      let wf: { nodes?: Array<{ name?: string; type?: string; parameters?: Record<string, unknown> }> };
      try {
        wf = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        continue;
      }
      const list = wf.nodes ?? [];
      const workflowCode = list
        .map((n) => {
          const p = n.parameters ?? {};
          return String(p.jsCode ?? p.functionCode ?? '');
        })
        .join('\n');
      for (const n of list) {
        if (n.type !== EXEC_TYPE) continue;
        const command = String((n.parameters ?? {}).command ?? '');
        nodes.push({ workflow: f, file: path, node: n.name ?? '(unnamed)', command, workflowCode });
      }
    }
  }
  return nodes;
}

/** A workflow "sanitizes" iff some code node has a charset check AND a throw. */
function workflowSanitizes(code: string): boolean {
  const hasCharsetCheck = /\.test\(|\.match\(|\.replace\(\s*\/\[\^/.test(code);
  const hasThrow = /throw\s+new\s+Error/.test(code);
  return hasCharsetCheck && hasThrow;
}

describe('remediation: n8n executeCommand — no shell injection', () => {
  const execNodes = collectExecNodes();

  it('is not vacuous — finds executeCommand nodes that interpolate data', () => {
    const interpolating = execNodes.filter((n) => n.command.includes('{{'));
    expect(interpolating.length).toBeGreaterThan(0);
  });

  it('R1: no command is executed wholesale from a data value', () => {
    const violations: string[] = [];
    for (const n of execNodes) {
      const cmd = n.command.replace(/^=/, '').trim();
      const interps = interpolations(cmd);
      if (interps.length !== 1) continue;
      // Whole command is a single interpolation with shell text nowhere.
      const residue = cmd.replace(/\{\{[\s\S]*?\}\}/g, '').trim();
      if (residue.length > 0) continue; // literal shell text present outside {{ }}
      const expr = interps[0];
      if (hasStringLiteral(expr)) continue; // command text comes from a literal base
      const refs = classifyRefs(expr);
      const producesValue = refs.some((r) => !r.isGuard);
      if (producesValue) violations.push(`${n.workflow} :: "${n.node}" → command is entirely data: {{ ${expr} }}`);
    }
    expect(violations, `Whole-command-from-data (RCE sink):\n${violations.join('\n')}`).toEqual([]);
  });

  it('R2: workflows that splice a data value into a shell command must sanitize it', () => {
    const violations: string[] = [];
    for (const n of execNodes) {
      const cmd = n.command.replace(/^=/, '').trim();
      let hasValueInterpolation = false;
      for (const expr of interpolations(cmd)) {
        const refs = classifyRefs(expr);
        if (refs.some((r) => !r.isGuard)) hasValueInterpolation = true;
      }
      if (!hasValueInterpolation) continue; // pure-literal or ternary-guard-only → no data reaches shell
      if (!workflowSanitizes(n.workflowCode)) {
        violations.push(
          `${n.workflow} :: "${n.node}" interpolates a data value into the shell but the workflow has no charset-validation + throw`,
        );
      }
    }
    expect(violations, `Unvalidated shell interpolation:\n${violations.join('\n')}`).toEqual([]);
  });
});
