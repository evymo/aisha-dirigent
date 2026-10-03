/**
 * Gate: AISHA Flowboard — hermetic packaging + cross-component single-source-of-truth.
 *
 * Static invariants (no DB / service / network) that keep the Flowboard slice
 * consistent across the whole stack:
 *   1. @aisha/flowboard-core is a publishable, hermetic-ready workspace package
 *      (private:false + publishConfig + build, main → ./dist like @aisha/security).
 *   2. Every service that imports @aisha/flowboard-core declares it as a dep
 *      (so `npm ci --include-workspace-root` resolves it from the git tree).
 *   3. The web `src/lib/flowboard/*` are thin re-export shims → one source of truth.
 *   4. The svc-ai-chat executor imports topoOrder + kindIcon from the package and
 *      defines NO local duplicate (the dedup must not silently regress).
 *
 * These mirror the spirit of aisha-packages-publish.gate: a package consumed via
 * a workspace dep must stay publishable + non-duplicated.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), "utf-8");
const pkg = (p: string): Record<string, unknown> => JSON.parse(read(p));

describe("gate: flowboard hermetic packaging", () => {
  const corePkg = pkg("packages/flowboard-core/package.json");

  it("@aisha/flowboard-core is publishable + hermetic-ready (matches @aisha/security shape)", () => {
    expect(corePkg.name).toBe("@aisha/flowboard-core");
    expect(corePkg.private).not.toBe(true);
    expect(corePkg.publishConfig).toBeTruthy();
    expect((corePkg.scripts as Record<string, string>)?.build).toBeTruthy();
    // hermetic runtime does `node dist/server.js` and resolves the package via main →
    // MUST be built JS, never a .ts source entry (Node cannot execute TypeScript).
    expect(corePkg.main).toBe("./dist/index.js");
    expect(corePkg.types).toBe("./dist/index.d.ts");
    expect(corePkg.files).toEqual(expect.arrayContaining(["dist", "src"]));
  });

  it("every service importing @aisha/flowboard-core declares the workspace dep", () => {
    const consumers = ["services/svc-ai-chat", "services/svc-mcp-knowledge"];
    for (const svc of consumers) {
      const usesIt = existsSync(join(ROOT, svc, "src"))
        && read(`${svc}/package.json`).includes("@aisha/flowboard-core");
      // if the service source imports it, the dep must be declared
      const importsIt = grepDir(join(ROOT, svc, "src"), "@aisha/flowboard-core");
      if (importsIt) expect(usesIt).toBe(true);
    }
  });

  it("web src/lib/flowboard/* are re-export shims (single source of truth)", () => {
    for (const f of ["index.ts", "graph.ts", "registry.ts", "provenance.ts", "compile/index.ts"]) {
      const body = read(`src/lib/flowboard/${f}`);
      expect(body).toContain('export * from "@aisha/flowboard-core"');
      expect(body).not.toMatch(/\bclass\b|\bfunction \w+\s*\(/); // no local implementation
    }
  });

  it("the svc executor reuses the package helpers and keeps NO duplicate topoOrder / icon map", () => {
    const exec = read("services/svc-ai-chat/src/lib/flowboardSandboxExecutor.ts");
    expect(exec).toMatch(/import \{[^}]*\btopoOrder\b[^}]*\bkindIcon\b[^}]*\} from ['"]@aisha\/flowboard-core['"]/);
    expect(exec).not.toMatch(/^\s*export function topoOrder\b/m); // re-exported, not redefined
    expect(exec).not.toMatch(/const KIND_ICON\b/); // icon map lives only in the package
  });
});

/** Minimal recursive substring search (avoids a glob dep in the gate). */
function grepDir(dir: string, needle: string): boolean {
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (grepDir(full, needle)) return true;
    } else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, "utf-8").includes(needle)) {
      return true;
    }
  }
  return false;
}
