/**
 * Gate: workspace-aware-dockerfile-coverage
 *
 * Ensures every `npm ci --workspace=@aisha/X` or `npm install --workspace=@aisha/X`
 * reference in a Dockerfile (root or services subfolder Dockerfile) has the workspace
 * registered in the root package.json `workspaces` array.
 *
 * Why this matters:
 *   The workspace-aware Dockerfile pattern (PR #154 origin) uses `--workspace=`
 *   flag to install a single service plus its symlinked @aisha/* dependencies
 *   via npm workspaces. If the service isn't registered in root workspaces,
 *   npm fails with "No workspaces found" and the Docker build aborts on
 *   wave-N deploy.
 *
 * Canonical failure pattern (caught twice in cold-start 2026-05-20/22):
 *   1. PR #154 added gateway/Dockerfile with --workspace=@aisha/gateway
 *      → root package.json workspaces was empty → cold-start wave-2 fail
 *   2. PR #171 added Dockerfile.svc-aisha-kronos-shim with
 *      --workspace=@aisha/svc-aisha-kronos-shim
 *      → root workspaces missed services/svc-aisha-kronos-shim
 *      → cold-start wave-6 (aisha-integration) fail
 *
 * This gate fails the PR if a workspace-aware Dockerfile references a
 * workspace not declared in root package.json.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isTrackedService } from "./lib/tracked-services";

const ROOT = process.cwd();

/** Find all Dockerfiles (root + services/*) and read them */
function findDockerfiles(): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];

  // Root-level Dockerfile* files (Dockerfile, Dockerfile.svc-foo, etc.)
  for (const entry of fs.readdirSync(ROOT)) {
    if (!/^Dockerfile(\..+)?$/.test(entry)) continue;
    const full = path.join(ROOT, entry);
    if (!fs.statSync(full).isFile()) continue;
    out.push({ path: full, content: fs.readFileSync(full, "utf8") });
  }

  // services/*/Dockerfile* files
  const servicesDir = path.join(ROOT, "services");
  if (fs.existsSync(servicesDir)) {
    for (const svc of fs.readdirSync(servicesDir)) {
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(svc)) continue;
      const svcDir = path.join(servicesDir, svc);
      if (!fs.statSync(svcDir).isDirectory()) continue;
      for (const entry of fs.readdirSync(svcDir)) {
        if (!/^Dockerfile(\..+)?$/.test(entry)) continue;
        const full = path.join(svcDir, entry);
        out.push({ path: full, content: fs.readFileSync(full, "utf8") });
      }
    }
  }

  return out;
}

/** Extract @aisha/X package names referenced via `npm (ci|install) --workspace=...` */
function extractWorkspaceRefs(content: string): string[] {
  const refs: string[] = [];
  for (const m of content.matchAll(
    /npm\s+(?:ci|install)\s+[^\n]*--workspace[=\s](@aisha\/[a-z0-9_-]+)/g,
  )) {
    refs.push(m[1]);
  }
  return refs;
}

describe("workspace-aware Dockerfile coverage — package.json workspaces", () => {
  // Load root package.json workspaces
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  const rootWorkspaces = pkgJson.workspaces ?? [];

  // Resolve workspaces array → set of @aisha/* package names actually present
  const declaredPackageNames = new Set<string>();
  for (const wsPattern of rootWorkspaces) {
    // Expand `packages/*` to all subdirs
    if (wsPattern.endsWith("/*")) {
      const dir = path.join(ROOT, wsPattern.slice(0, -2));
      if (!fs.existsSync(dir)) continue;
      for (const sub of fs.readdirSync(dir)) {
        const pkgPath = path.join(dir, sub, "package.json");
        if (!fs.existsSync(pkgPath)) continue;
        try {
          const { name } = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
            name?: string;
          };
          if (name) declaredPackageNames.add(name);
        } catch {
          /* skip malformed */
        }
      }
    } else {
      // Single workspace path: services/gateway → @aisha/gateway
      const pkgPath = path.join(ROOT, wsPattern, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const { name } = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (name) declaredPackageNames.add(name);
      } catch {
        /* skip */
      }
    }
  }

  const dockerfiles = findDockerfiles();

  it("found at least one Dockerfile (sanity)", () => {
    expect(dockerfiles.length, "no Dockerfiles found at repo root or services/*").toBeGreaterThan(0);
  });

  it("every --workspace=@aisha/X reference is a declared root workspace", () => {
    const violations: string[] = [];

    for (const df of dockerfiles) {
      const refs = extractWorkspaceRefs(df.content);
      for (const ref of refs) {
        if (!declaredPackageNames.has(ref)) {
          const rel = path.relative(ROOT, df.path);
          violations.push(`${rel}: uses --workspace=${ref} but ${ref} is not in root package.json workspaces`);
        }
      }
    }

    expect(
      violations,
      `Workspace-aware Dockerfiles referencing unregistered workspaces:\n` +
        violations.map((v) => `  - ${v}`).join("\n") +
        `\n\nFix: add the service path to "workspaces" in root package.json, then run ` +
      `\`npm install\` to regenerate the lockfile with workspace entries.`,
    ).toHaveLength(0);
  });

  it("svc-ai-chat Dockerfile uses workspace sources instead of a Verdaccio-only install", () => {
    const dockerfile = fs.readFileSync(
      path.join(ROOT, "services/svc-ai-chat/Dockerfile"),
      "utf8",
    );

    expect(dockerfile).toMatch(/npm\s+ci\s+--workspace=@aisha\/svc-ai-chat\b/);
    expect(dockerfile).toContain("/app/packages/aitg");
    expect(dockerfile).toContain("/app/packages/security");
    expect(dockerfile).toContain("/app/packages/observability");
    expect(dockerfile).not.toMatch(/VERDACCIO_(URL|TOKEN)|\.npmrc/);
  });
});
