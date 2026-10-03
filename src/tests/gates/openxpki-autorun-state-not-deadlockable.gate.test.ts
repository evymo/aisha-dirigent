/**
 * OpenXPKI autorun-state exactly-one-action gate (CLASS gate)
 *
 * THE RULE OpenXPKI ENFORCES: an `autorun: 1` state must have EXACTLY ONE
 * executable action at runtime. Both deviations throw and abort the workflow:
 *
 *   "State 'X' should be automatically executed but there are
 *    no actions available for execution."
 *   "State 'X' should be automatically executed but there are
 *    multiple actions available for execution. Actions are: …"
 *
 * WHY THIS GATE EXISTS — a mistake worth not repeating (2026-07-21):
 * chasing a "no actions available" deadlock in certificate_enroll/REVOKE_CERTS,
 * an UNCONDITIONAL action was appended as a "fail-safe escape", on the assumption
 * that OpenXPKI runs the FIRST action whose conditions hold. It does not. An
 * unconditional action is available in EVERY evaluation, so the moment any
 * conditional sibling also qualified, the state had two candidates and threw
 *   "multiple actions available … enroll_get_next_cert_to_revoke,
 *    enroll_cleanup_revocation_context"
 * — trading one abort for another, and breaking the path that had been working.
 *
 * So in a multi-action autorun state an unconditional action is not a safety net,
 * it is a guaranteed collision. Mutual exclusivity is the ONLY correct shape:
 * REVOKE_CERTS's four actions partition the space as
 *   empty | !empty·limit·!below | !empty·!limit | !empty·limit·below
 * exactly one of which can hold at a time.
 *
 * WHAT THIS GATE CHECKS (decidable, no heuristics): an `autorun: 1` state with
 * more than one action must not contain an unconditional one. It deliberately
 * does NOT try to prove exhaustiveness — that needs runtime condition semantics
 * (Condition::WFArray on an absent array, policy keys that default to 0). A gate
 * that guesses at those would cry wolf; this one only asserts what it can prove.
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CONFIG_ROOT = join(ROOT, "openxpki-config", "config.d");

function walkYaml(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkYaml(p, out);
    else if (entry.endsWith(".yaml") && p.includes("workflow/def/")) out.push(p);
  }
  return out;
}

type StateBlock = { name: string; actions: string[]; autorun: boolean };

/**
 * Line scanner rather than a YAML lib on purpose: these files carry OpenXPKI
 * connector shorthand (`_map_x: $context_key`) that strict parsers reject, and
 * the gate must keep working on exactly the text OpenXPKI itself reads.
 */
function parseStates(text: string): StateBlock[] {
  const states: StateBlock[] = [];
  let cur: StateBlock | null = null;
  let inActionList = false;

  for (const line of text.split("\n")) {
    const header = line.match(/^ {4}([A-Z][A-Z0-9_]*):\s*$/);
    if (header) {
      if (cur) states.push(cur);
      cur = { name: header[1], actions: [], autorun: false };
      inActionList = false;
      continue;
    }
    if (!cur) continue;
    if (line.trim() !== "" && /^ {0,3}\S/.test(line)) {
      states.push(cur);
      cur = null;
      inActionList = false;
      continue;
    }
    if (/^\s+autorun:\s*1\s*$/.test(line)) cur.autorun = true;
    if (/^\s+action:\s*$/.test(line)) { inActionList = true; continue; }
    if (inActionList) {
      const act = line.match(/^\s+-\s+(.*\S)\s*$/);
      if (act) cur.actions.push(act[1]);
      else if (line.trim() !== "" && !line.trim().startsWith("#")) inActionList = false;
    }
  }
  if (cur) states.push(cur);
  return states;
}

const files = walkYaml(CONFIG_ROOT);

describe("OpenXPKI autorun states resolve to exactly one action", () => {
  test("openxpki-config workflow definitions are present", () => {
    expect(
      files.length,
      `expected workflow def YAMLs under ${CONFIG_ROOT} — if the PKI config moved, re-point this gate rather than deleting it`,
    ).toBeGreaterThan(0);
  });

  test("no autorun state mixes an unconditional action with conditional siblings", () => {
    const violations: string[] = [];

    for (const file of files) {
      for (const st of parseStates(readFileSync(file, "utf-8"))) {
        if (!st.autorun || st.actions.length < 2) continue;
        const unconditional = st.actions.filter((a) => !a.includes("?"));
        if (unconditional.length === 0) continue;

        violations.push(
          `${file.replace(ROOT + "/", "")} :: state ${st.name} — autorun with ${st.actions.length} actions, ` +
            `${unconditional.length} of them unconditional (${unconditional.join(" | ")}). ` +
            `An unconditional action is available on EVERY evaluation, so as soon as a conditional sibling ` +
            `also qualifies OpenXPKI aborts with "multiple actions available for execution". ` +
            `Make the actions mutually exclusive instead.`,
        );
      }
    }

    expect(
      violations,
      'autorun states that will throw "multiple actions available" (see REVOKE_CERTS, 2026-07-21)',
    ).toEqual([]);
  });

  test("REVOKE_CERTS keeps its four mutually exclusive actions", () => {
    // Regression pin for the state this was learned on. The four guards partition
    // the space; adding a fifth unconditional one is what broke issuance.
    const enroll = files.filter((f) => f.endsWith("certificate_enroll.yaml"));
    expect(enroll.length, "certificate_enroll.yaml must exist").toBeGreaterThan(0);

    for (const file of enroll) {
      const revoke = parseStates(readFileSync(file, "utf-8")).find((s) => s.name === "REVOKE_CERTS");
      expect(revoke, `${file} must define REVOKE_CERTS`).toBeDefined();

      expect(
        revoke!.actions.filter((a) => !a.includes("?")),
        `${file} :: REVOKE_CERTS must not carry an unconditional action — it collides with the guarded paths`,
      ).toEqual([]);

      expect(
        revoke!.actions.length,
        `${file} :: REVOKE_CERTS should keep its four guarded transitions`,
      ).toBe(4);
    }
  });
});
