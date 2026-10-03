/**
 * OpenXPKI workflow — one action name per branch, per state
 *
 * A state lists its outgoing branches as `action [action…] > NEXT ? conditions`.
 * The engine does NOT key those branches by their condition set — it keys them by
 * the branch's ACTION NAME. Workflow::State::_add_action_config (Workflow/State.pm
 * in the pki-server image) assigns straight into hashes:
 *
 *     $self->_next_state->{$action_name}  = ...
 *     $self->_conditions->{$action_name}  = [...]
 *     $self->_actions->{$action_name}     = $copied_config
 *
 * No merge, no warning. Two branches of one state that begin with the same action
 * name therefore collapse into one: the last definition read wins and the earlier
 * branch is gone. Disjoint conditions do not save you — the engine never reaches
 * them, because the branch that would have carried them no longer exists.
 *
 * This is not hypothetical. Adding a batch limit to certificate_enroll's
 * REVOKE_CERTS introduced two branches that reused the two existing action names.
 * The overwritten pair included `? global_is_tmp_queue_empty` — the only exit
 * taken once the revocation queue drains. Every enrolment that finished revoking
 * then found no runnable action and died:
 *
 *     State 'REVOKE_CERTS' should be automatically executed
 *     but there are no actions available for execution
 *
 * → proc_state=exception → RPC 500 → pki-bridge 502 → no certificate issued at
 * all. Twelve workflows wedged, zero ever reaching SUCCESS, and the mesh TLS
 * terminator fell back to a self-signed cert because its certificate never came.
 * The YAML was valid, the conditions were correct, and nothing warned.
 *
 * Run: npm run test:gates
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CONFIG_ROOT = join(ROOT, "openxpki-config");

/** Every workflow definition under openxpki-config, recursively. */
function workflowDefs(dir: string = CONFIG_ROOT): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full); // follows symlinks; realm dirs symlink to realm.tpl
    } catch {
      return [];
    }
    if (st.isDirectory()) return workflowDefs(full);
    return /\.yaml$/.test(entry) && /\/workflow\/def\//.test(full) ? [full] : [];
  });
}

/**
 * The action name a branch is keyed by: the first token, before the chain of
 * follow-up activities, the `>` target and the `?` conditions.
 */
function branchActionName(branch: string): string {
  return String(branch).trim().split(/\s+/)[0] ?? "";
}

const DEFS = workflowDefs();

describe("OpenXPKI workflow definitions", () => {
  test("workflow definitions are discovered at all (guard against an empty sweep)", () => {
    expect(DEFS.length, `no workflow defs found under ${CONFIG_ROOT}`).toBeGreaterThan(0);
  });

  test("no state reuses an action name across its branches", () => {
    const offenders: string[] = [];

    for (const file of DEFS) {
      let doc: { state?: Record<string, { action?: unknown }> };
      try {
        doc = yaml.load(readFileSync(file, "utf8")) as typeof doc;
      } catch (e) {
        offenders.push(`${relative(ROOT, file)}: unparseable — ${(e as Error).message}`);
        continue;
      }

      for (const [stateName, state] of Object.entries(doc?.state ?? {})) {
        const branches = state?.action;
        if (!Array.isArray(branches) || branches.length < 2) continue;

        const seen = new Map<string, number>();
        for (const branch of branches) {
          const name = branchActionName(String(branch));
          if (!name) continue;
          seen.set(name, (seen.get(name) ?? 0) + 1);
        }
        for (const [name, count] of seen) {
          if (count > 1) {
            offenders.push(
              `${relative(ROOT, file)} → state ${stateName}: action '${name}' starts ${count} branches ` +
                `— all but the last are silently discarded`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      "A state's branches are keyed by action name, so duplicates overwrite each other.\n" +
        "Give each branch its own action name (an identically-configured alias is fine — see\n" +
        "get_next_cert_to_revoke_capped in certificate_enroll.yaml), or merge the branches\n" +
        "into one with a LazyOR condition:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  test("every branch's actions are defined in the file's action map", () => {
    // A typo in a branch is the same class of silent failure: the state keeps a
    // branch that can never run. Cheap to check while we are already parsing.
    const offenders: string[] = [];

    for (const file of DEFS) {
      let doc: { state?: Record<string, { action?: unknown }>; action?: Record<string, unknown> };
      try {
        doc = yaml.load(readFileSync(file, "utf8")) as typeof doc;
      } catch {
        continue; // reported by the test above
      }
      const defined = new Set(Object.keys(doc?.action ?? {}));
      if (!defined.size) continue; // some defs only extend a template

      for (const [stateName, state] of Object.entries(doc?.state ?? {})) {
        for (const branch of Array.isArray(state?.action) ? state.action : []) {
          const chain = String(branch).split(">")[0].trim().split(/\s+/).filter(Boolean);
          for (const act of chain) {
            // `global_*` activities come from the shared config tree, not this file.
            if (act.startsWith("global_")) continue;
            if (!defined.has(act)) {
              offenders.push(`${relative(ROOT, file)} → state ${stateName}: action '${act}' is not defined`);
            }
          }
        }
      }
    }

    expect(offenders, `undefined actions referenced:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
