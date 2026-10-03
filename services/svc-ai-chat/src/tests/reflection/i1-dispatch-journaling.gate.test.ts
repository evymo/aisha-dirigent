/**
 * Gate — Invariant I1: "no dispatch without a journaled decision".
 *
 * Every LLM dispatch in svc-ai-chat must mint an `ai_decisions` row so AISHA's
 * authority is honored uniformly. This gate enforces that DYNAMICALLY and
 * CALL-GRANULARLY — no hard-coded roster, and per-dispatch (not per-file):
 *
 *   ANCHOR: exactly one name, `recordExecutionDecision`, the sole TS writer of
 *   the journal (mirrors the SQL SoT `fn_record_execution_decision`, "THE only
 *   writer of ai_decisions"). Everything else is DERIVED from the source tree:
 *
 *   1. "journaling modules" = files that actually INVOKE the root writer
 *      (discovered, not listed: decision.ts→dispatchDecision, dispatchJournal.ts
 *      →journalDispatch, workflowEngine.ts→journaledLlm/recordExecutionDecision).
 *   2. for each file: the journaling symbols available are those it IMPORTS from
 *      a journaling module (static or dynamic), plus the root itself if the file
 *      IS a journaling module.
 *   3. RULE (call-granular): count real `unifiedChat(` invocations (D) and real
 *      journaling-symbol invocations (J); require J >= D. So a SECOND or THIRD
 *      raw dispatch added to an already-journaling file is still caught — the
 *      file-level "mentions a primitive" loophole is closed.
 *
 * "Real invocation" excludes comments, the symbol's own definition, and bare
 * mentions in prose/types/strings — so a primitive named in a comment cannot
 * satisfy the rule either.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

import { describe, it, expect } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url)); // services/svc-ai-chat/src/

/** The single anchor: the sole TS writer of the ai_decisions journal. */
const JOURNAL_ROOT = 'recordExecutionDecision';

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Count real invocations of `ident(` — skipping comments and the definition. */
function realInvocationCount(content: string, ident: string): number {
  // `\\*?` also skips a GENERATOR definition (`function* unifiedChatStream(`), so the
  // streaming router's own def is never miscounted as a call when we widen D below.
  const defRe = new RegExp(`function\\s*\\*?\\s*${ident}\\b`);
  const callRe = new RegExp(`\\b${ident}\\s*\\(`);
  let n = 0;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
    if (defRe.test(line)) continue;
    if (callRe.test(line)) n++;
  }
  return n;
}

const moduleBase = (spec: string): string => basename(spec).replace(/\.(js|ts)$/, '');

/** Value symbols this file imports from a journaling module (static + dynamic). */
function journalingSymbolsImported(content: string, journalingModules: Set<string>): Set<string> {
  const syms = new Set<string>();
  const addNamed = (group: string, spec: string) => {
    if (!journalingModules.has(moduleBase(spec))) return;
    for (let name of group.split(',')) {
      name = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) syms.add(name);
    }
  };
  const named = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  const dynNamed = /\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(content)) !== null) addNamed(m[1], m[2]);
  while ((m = dynNamed.exec(content)) !== null) addNamed(m[1], m[2]);
  return syms;
}

describe('I1 gate — no unjournaled LLM dispatch (derived + call-granular)', () => {
  const files = collectSourceFiles(SRC_ROOT);
  const read = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

  // DERIVE journaling modules: files that invoke the single root writer.
  const journalingModules = new Set<string>();
  for (const f of files) {
    if (realInvocationCount(read.get(f)!, JOURNAL_ROOT) > 0) {
      journalingModules.add(moduleBase(f));
    }
  }

  it('discovers the journaling modules dynamically (derivation works, not hard-coded)', () => {
    expect(journalingModules.size).toBeGreaterThanOrEqual(2);
    expect(journalingModules.has('decision')).toBe(true);
    expect(journalingModules.has('dispatchJournal')).toBe(true);
  });

  it('every unifiedChat() dispatch is journaled — J >= D per file (call-granular)', () => {
    const violations: string[] = [];
    for (const f of files) {
      const content = read.get(f)!;
      // Count BOTH the buffered `unifiedChat(` and the streaming `unifiedChatStream(`
      // dispatches — the regex \bunifiedChat\s*\( does not match the Stream variant, so
      // the streaming chat path (v1-chat streamCompletion) was previously invisible (I1
      // false-green). They are disjoint counts; sum = total raw dispatches in the file.
      const dispatches =
        realInvocationCount(content, 'unifiedChat') + realInvocationCount(content, 'unifiedChatStream');
      if (dispatches === 0) continue;

      const symbols = journalingSymbolsImported(content, journalingModules);
      if (journalingModules.has(moduleBase(f))) symbols.add(JOURNAL_ROOT);
      let journals = 0;
      for (const s of symbols) journals += realInvocationCount(content, s);

      if (journals < dispatches) {
        violations.push(`${f.replace(SRC_ROOT, 'src/')} (dispatches=${dispatches}, journals=${journals})`);
      }
    }
    expect(
      violations,
      `Files with more unifiedChat() dispatches than journaling calls — each raw ` +
        `dispatch must be preceded by journalDispatch()/dispatchDecision()/journaledLlm():\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('has teeth: an extra raw dispatch in an already-journaling file is flagged', () => {
    // Simulate criticLoop.ts gaining a THIRD unifiedChat with only the existing
    // two journalDispatch calls — the per-file "mentions a primitive" loophole.
    const fixture = [
      `import { journalDispatch } from "./dispatchJournal.js";`,
      `await journalDispatch({ model });`,
      `const a = await unifiedChat(o1);`,
      `await journalDispatch({ model });`,
      `const b = await unifiedChat(o2);`,
      `const c = await unifiedChat(o3); // <-- unjournaled regression`,
    ].join('\n');
    const dispatches = realInvocationCount(fixture, 'unifiedChat');
    const symbols = journalingSymbolsImported(fixture, new Set(['dispatchJournal']));
    let journals = 0;
    for (const s of symbols) journals += realInvocationCount(fixture, s);
    expect(dispatches).toBe(3);
    expect(journals).toBe(2);
    expect(journals).toBeLessThan(dispatches); // → would be a violation
  });
});

/**
 * Sibling invariant (I1 for the EXECUTOR axis): the `unifiedChat`-counting gate above
 * only sees MODEL dispatch. But a runtime like openclaw/hermes dispatches through its own
 * surface (an HTTP agent-mesh call, a DB-side RPC) — never `unifiedChat` — so it was
 * invisible to that gate and could execute an admitted, side-effecting action with NO
 * ai_decisions row. This is the CLASS gate over the runtime-adapter FAMILY: every
 * RuntimeAdapter.execute() must mint a decision, derived (adapters are discovered, not
 * listed) and verified in both directions (a new un-journaling adapter fails; removing an
 * existing adapter's journaling fails).
 */
describe('I1 gate — every RuntimeAdapter.execute journals a decision (executor axis)', () => {
  // The journaling primitives — every one funnels to fn_record_execution_decision (the SQL
  // SoT "only writer of ai_decisions"): the TS writer + its wrappers, plus the server-side
  // RPCs that mint the row for out-of-process runtimes (cli). Named because adapters journal
  // through wrappers, not the root directly; the ADAPTERS themselves stay fully derived.
  const JOURNAL_ANCHORS = [
    'recordExecutionDecision', // the sole TS writer
    'journalDispatch', // model-dispatch wrapper → recordExecutionDecision
    'journalRuntimeDispatch', // runtime-dispatch wrapper → recordExecutionDecision
  ];
  const JOURNAL_RPCS = ['fn_record_execution_decision', 'fn_spawn_claude_cli_run'];
  const ADAPTER_DECL = /export const (\w+Adapter)\s*:\s*RuntimeAdapter\s*=/g;

  // DERIVE the adapter source files: every file under reflection/runtime/ that declares a
  // `: RuntimeAdapter` object literal (adapters.ts, workbench-adapter.ts, and any future one).
  const runtimeDir = join(SRC_ROOT, 'reflection', 'runtime');
  const adapterFiles = collectSourceFiles(runtimeDir).filter((f) =>
    /export const \w+Adapter\s*:\s*RuntimeAdapter\s*=/.test(readFileSync(f, 'utf8')),
  );

  /** A segment journals iff it really calls a journaling wrapper OR references a journaling RPC. */
  const segmentJournals = (seg: string): boolean =>
    JOURNAL_ANCHORS.some((a) => realInvocationCount(seg, a) > 0) ||
    JOURNAL_RPCS.some((rpcName) => seg.includes(`'${rpcName}'`) || seg.includes(`"${rpcName}"`));

  it('discovers the adapter files dynamically (derivation works, not hard-coded)', () => {
    expect(adapterFiles.length).toBeGreaterThanOrEqual(1);
    expect(adapterFiles.some((f) => basename(f) === 'adapters.ts')).toBe(true);
  });

  it('every RuntimeAdapter mints a decision before it dispatches — no un-audited executor', () => {
    const violations: string[] = [];
    let adapterCount = 0;
    for (const f of adapterFiles) {
      const content = readFileSync(f, 'utf8');
      const marks: Array<{ name: string; idx: number }> = [];
      const re = new RegExp(ADAPTER_DECL);
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) marks.push({ name: m[1], idx: m.index });
      for (let i = 0; i < marks.length; i++) {
        adapterCount++;
        const seg = content.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : content.length);
        if (!segmentJournals(seg)) violations.push(`${f.replace(SRC_ROOT, 'src/')} :: ${marks[i].name}`);
      }
    }
    expect(adapterCount).toBeGreaterThanOrEqual(4); // direct_llm, openclaw, hermes, cli (+ workbench)
    expect(
      violations,
      `RuntimeAdapter(s) whose execute() never mints an ai_decisions row — an admitted ` +
        `(allow-verdict) run would execute side-effecting work with NO decision journal. Add a ` +
        `recordExecutionDecision/journalDispatch/journalRuntimeDispatch call (or an fn_*_run RPC ` +
        `that journals server-side) BEFORE the dispatch:\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('has teeth: a new adapter with no journaling call is flagged', () => {
    const fixture = [
      `export const fooAdapter: RuntimeAdapter = {`,
      `  runtime: 'foo',`,
      `  isAvailable: () => true,`,
      `  async execute(work) {`,
      `    const r = await postToFoo(work); // dispatch with NO journal <-- regression`,
      `    return { runtime: 'foo', ok: true, output: '', detail: {} };`,
      `  },`,
      `};`,
    ].join('\n');
    expect(segmentJournals(fixture)).toBe(false); // → would be a violation
    // and the same adapter WITH a journal passes:
    expect(segmentJournals(fixture.replace('const r =', 'await journalRuntimeDispatch("foo", work); const r ='))).toBe(true);
  });
});
