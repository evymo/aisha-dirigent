/**
 * The service input set: what the REPOSITORY declares, not what happens to sit on disk.
 *
 * WHY (false gate failure 2026-07-30):
 *   Gates enumerated services with `readdirSync('services')`. `services/svc-webdispecink`
 *   had been removed from the repo by df25a389 ("fleet vendors become plugins, not
 *   services", 2026-07-26), but a working tree still held its build leftovers —
 *   `dist/` + `node_modules/`, 220K, no `src/`, nothing tracked. The OWASP adoption gate
 *   read that leftover as a real service and failed all four of its checks, so
 *   `npm run test:gates` was red and the husky pre-push hook blocked EVERY push, on a
 *   branch that touched no service code at all. CI on a clean checkout was green, so the
 *   failure was invisible to everyone except the developer holding the leftover.
 *
 *   Same defect family as the `packages/potok` + `packages/local-ingest` submodule
 *   leftovers that falsely tripped silent-degradation on off-main branches (2026-07-16).
 *   A filesystem scan cannot tell "service" from "residue"; git can.
 *
 * This narrows the INPUT SET only. It does not relax a single check — a service the repo
 * really declares is held to exactly the same bar as before.
 */

import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../../scripts/lib/git-worktree-health.mjs";

/** Cached per root: every gate in a run asks, and each ask would otherwise fork git. */
const cache = new Map<string, ReadonlySet<string>>();

/**
 * Names of the service directories that git tracks under `services/`.
 *
 * Fails LOUD rather than degrading. Two tempting fallbacks are deliberately absent:
 *   - falling back to a filesystem scan would reintroduce the very bug this exists to fix;
 *   - returning an empty set would make `describe.each(services)` iterate nothing, so every
 *     service gate would pass vacuously — the worst outcome for a security gate, and
 *     indistinguishable from success.
 */
export function trackedServiceNames(root: string = process.cwd()): ReadonlySet<string> {
  const cached = cache.get(root);
  if (cached) return cached;

  let out: string;
  try {
    // -z: NUL-separated, so a path with a newline cannot forge an entry.
    out = execFileSync("git", ["ls-files", "-z", "--", "services/"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Bez git lokace v prostředí — jinak `root` není autorita.
      //
      // MĚŘENO 2026-08-05: každý git hook exportuje `GIT_DIR`. Se zděděným
      // prostředím `git ls-files` odpovídá za NĚJ a `cwd: root` se ignoruje,
      // takže helper tiše vrátí služby JINÉHO repozitáře. To je přesně ta
      // vada, kvůli které tenhle soubor existuje: špatný vstupní seznam
      // nechá `describe.each(services)` iterovat cizí (nebo prázdnou) množinu
      // a service brány projdou naprázdno — k nerozeznání od úspěchu.
      //
      // Selhat nahlas to neumí, protože cizí repozitář ODPOVĚDĚT dokáže.
      // Jediná obrana je se ho nezeptat.
      env: envWithoutGitLocation(),
    });
  } catch (err) {
    throw new Error(
      `tracked-services: 'git ls-files' failed in ${root}. The service input set cannot ` +
        `be derived, and guessing it from the filesystem is what this helper exists to ` +
        `prevent. Original error: ${(err as Error).message}`,
    );
  }

  const names = new Set<string>();
  for (const entry of out.split("\0")) {
    if (!entry) continue;
    const rest = entry.startsWith("services/") ? entry.slice("services/".length) : null;
    if (!rest) continue;
    // `services/<name>/...` for a normal service; a bare `services/<name>` when the
    // service is a submodule (git tracks the gitlink itself, with no children).
    const name = rest.split("/")[0];
    if (name) names.add(name);
  }

  if (names.size === 0) {
    throw new Error(
      `tracked-services: git tracks no paths under services/ in ${root}. Refusing to ` +
        `report an empty service set — a service gate over zero services passes ` +
        `vacuously, which reads exactly like success.`,
    );
  }

  cache.set(root, names);
  return names;
}

/**
 * Predicate form, for filtering an existing directory listing in place.
 *
 * Use this to narrow a `readdirSync('services')` result instead of replacing the whole
 * enumeration: each gate keeps its own additional conditions (has `src/`, has a
 * `package.json`, …) and only the phantom entries drop out.
 */
export function isTrackedService(name: string, root: string = process.cwd()): boolean {
  return trackedServiceNames(root).has(name);
}
