/**
 * Gate test (remediation INF-01): blue/green promote must perform a REAL
 * Traefik label swap — not a stub / placeholder.
 *
 * CONTRACT:
 *   1. scripts/blue-green-switch.mjs — the `traefik_swap` step (Step 7) must
 *      perform a real Coolify API label PATCH: it must reference a Coolify
 *      label field (`docker_labels` or `custom_labels`) AND issue an HTTP
 *      mutation (PATCH) against Coolify. The step must NOT be marked with the
 *      placeholder markers 'placeholder' / 'simplified'.
 *   2. n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json — no node may be named
 *      'Promote (stub)' (a stub promote node); the connections graph must not
 *      reference such a node either.
 *
 * KNOWN-RED at HEAD 569c5ffd:
 *   - blue-green-switch.mjs Step 7 emits a placeholder step() with detail
 *     "label swap (placeholder — implement Coolify docker_labels PATCH)".
 *   - WF has a node "Promote (stub)".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/**
 * Extract the traefik_swap step region from the switch script. We anchor on the
 * Step 7 comment / the traefik_swap step() call and take the surrounding window
 * up to the next step marker (Step 8 / commit), so assertions target the swap
 * logic, not the whole file.
 */
function extractTraefikSwapRegion(src: string): string {
  // Prefer the explicit Step 7 anchor.
  const step7 = src.search(/Step\s*7[^\n]*Traefik|log\.step\(\s*7/i);
  const start = step7 >= 0 ? step7 : src.indexOf('traefik_swap');
  if (start < 0) return '';
  // End at the next numbered step (Step 8) or commit step.
  const rest = src.slice(start);
  const endRel = rest.search(/Step\s*8|log\.step\(\s*8|commit_slot_switch/i);
  return endRel > 0 ? rest.slice(0, endRel) : rest;
}

describe('INF-01 — blue/green promote does a real Traefik label swap', () => {
  const scriptPath = path.join(ROOT, 'scripts/blue-green-switch.mjs');
  const src = readText(scriptPath);

  it('the switch script exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('the traefik_swap step is not a placeholder / simplified stub', () => {
    const region = extractTraefikSwapRegion(src);
    expect(region.length).toBeGreaterThan(0);
    expect(/placeholder/i.test(region)).toBe(false);
    expect(/simplified/i.test(region)).toBe(false);
  });

  it('the traefik_swap step issues a real Coolify docker_labels/custom_labels PATCH', () => {
    const region = extractTraefikSwapRegion(src);
    expect(region.length).toBeGreaterThan(0);
    // Must reference a Coolify label field...
    expect(/docker_labels|custom_labels/.test(region)).toBe(true);
    // ...and actually mutate it via an HTTP PATCH (Coolify API call).
    expect(/PATCH/.test(region)).toBe(true);
  });
});

describe('INF-01 — orchestrator workflow has no stub promote node', () => {
  const wfPath = path.join(ROOT, 'n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json');
  const raw = readText(wfPath);

  it('the workflow file exists and parses', () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('no node is named a stub promote (case-insensitive "stub" in a promote node)', () => {
    const wf = JSON.parse(raw) as { nodes?: Array<{ name?: string }> };
    const nodes = wf.nodes ?? [];
    const stubNodes = nodes
      .map((n) => n.name ?? '')
      .filter((name) => /stub/i.test(name) && /promote/i.test(name));
    expect(stubNodes, `stub promote node(s): ${stubNodes.join(', ')}`).toEqual([]);
  });

  it('the connections graph references no "(stub)" node', () => {
    // Guards against a stub node lingering only in the connections map.
    expect(/Promote \(stub\)/.test(raw)).toBe(false);
  });
});
