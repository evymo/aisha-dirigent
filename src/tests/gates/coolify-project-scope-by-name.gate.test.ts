/**
 * Gate: the tenant boundary keys off the project's NAME (its identity), not off a
 * materialised UUID (an operational handle).
 *
 * WHY THIS EXISTS (2026-07-21)
 * ---------------------------
 * A Coolify project UUID is assigned by the control plane at project creation. It
 * differs per control plane and changes if the project is deleted and recreated —
 * an operational fact, not a property of the instance. The instance's durable
 * identity is its NAME, declared as APP_NAME_PREFIX.
 *
 * Storing the UUID (in .env.coolify) and having the scope read that stored copy
 * created a split derivation: generate-coolify-context.mjs resolves the project by
 * NAME, while the scope resolver read the materialised value. A recreated project
 * would then leave a stale UUID pointing at a deleted project while a by-name
 * lookup would find the live one. resolveProjectUuidByName() closes that: the
 * boundary derives the UUID from the declared name, and a pinned UUID stays an
 * explicit override.
 */

import { describe, test, expect } from "vitest";
import {
  resolveProjectName,
  resolveProjectUuidByName,
  createProjectScope,
} from "../../../scripts/lib/coolify-project-scope.mjs";

/** A fake Coolify client: canned /projects list and per-uuid environment ids. */
function fakeCoolify(opts: {
  projects: Array<{ name: string; uuid: string }>;
  envIdsByUuid?: Record<string, number[]>;
  onProjects?: () => void;
}) {
  return async (path: string) => {
    if (path === "/projects") {
      opts.onProjects?.();
      return opts.projects;
    }
    const m = /^\/projects\/(.+)$/.exec(path);
    if (m) {
      const ids = opts.envIdsByUuid?.[m[1]] ?? [15];
      return { environments: ids.map((id) => ({ id })) };
    }
    return null;
  };
}

const PROJECTS = [
  { name: "tenant", uuid: "tenant-uuid-live" },
  { name: "aisha", uuid: "aisha-uuid" },
  { name: "another-tenant", uuid: "another-tenant-uuid" },
];

describe("project scope: identity is the name, uuid is derived", () => {
  test("resolveProjectName reads APP_NAME_PREFIX from the injected env", () => {
    expect(resolveProjectName({ APP_NAME_PREFIX: "tenant" } as NodeJS.ProcessEnv)).toBe("tenant");
    // AISHA_STORY is the older spelling and still honoured.
    expect(resolveProjectName({ AISHA_STORY: "tenant" } as NodeJS.ProcessEnv)).toBe("tenant");
    // Injected but empty → empty (no silent disk fallback for an injected env).
    expect(resolveProjectName({} as NodeJS.ProcessEnv)).toBe("");
  });

  test("resolveProjectUuidByName matches by name, case-insensitively", async () => {
    const c = fakeCoolify({ projects: PROJECTS });
    expect(await resolveProjectUuidByName(c, "tenant")).toBe("tenant-uuid-live");
    expect(await resolveProjectUuidByName(c, "TENANT")).toBe("tenant-uuid-live");
  });

  test("a name with no project resolves to empty, never a guess", async () => {
    const c = fakeCoolify({ projects: PROJECTS });
    expect(await resolveProjectUuidByName(c, "nosuchinstance")).toBe("");
    expect(await resolveProjectUuidByName(c, "")).toBe("");
  });

  test("two projects of one name is ambiguous → throws, never picks one", async () => {
    const c = fakeCoolify({
      projects: [...PROJECTS, { name: "tenant", uuid: "tenant-uuid-DUPLICATE" }],
    });
    await expect(resolveProjectUuidByName(c, "tenant")).rejects.toThrow(/refusing to guess/i);
  });

  /**
   * THE POINT. No UUID is pinned anywhere; only the name is declared. The scope
   * must still resolve — by looking the project up — so the stored UUID can be
   * dropped from the artifact entirely.
   */
  test("scope derives the project from the name when no UUID is pinned", async () => {
    const c = fakeCoolify({ projects: PROJECTS, envIdsByUuid: { "tenant-uuid-live": [15, 16] } });
    const scope = await createProjectScope(c, {
      env: { APP_NAME_PREFIX: "tenant" } as NodeJS.ProcessEnv,
    });
    expect(scope.projectUuid).toBe("tenant-uuid-live");
    expect(scope.inProject({ environment_id: 15 })).toBe(true);
    // An app in another tenant's environment is out of scope.
    expect(scope.inProject({ environment_id: 99 })).toBe(false);
  });

  /**
   * A pinned UUID is an explicit operator override and must win without a lookup,
   * so an operator can still target a project by uuid directly.
   */
  test("a pinned UUID wins and skips the name lookup", async () => {
    let listed = false;
    const c = fakeCoolify({
      projects: PROJECTS,
      envIdsByUuid: { "pinned-uuid": [7] },
      onProjects: () => {
        listed = true;
      },
    });
    const scope = await createProjectScope(c, {
      env: { COOLIFY_PROJECT_UUID: "pinned-uuid", APP_NAME_PREFIX: "tenant" } as NodeJS.ProcessEnv,
    });
    expect(scope.projectUuid).toBe("pinned-uuid");
    expect(listed, "a pinned uuid must not trigger a /projects lookup").toBe(false);
  });

  /**
   * Fail-closed: neither a pinned UUID nor a resolvable name means the run cannot
   * know which tenant it targets, and must refuse.
   */
  test("neither a pinned UUID nor a declared name → refuses to run", async () => {
    const c = fakeCoolify({ projects: PROJECTS });
    await expect(
      createProjectScope(c, { env: {} as NodeJS.ProcessEnv }),
    ).rejects.toThrow(/refusing to enumerate or mutate|APP_NAME_PREFIX/i);
  });
});
