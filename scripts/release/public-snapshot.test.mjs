import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { envWithoutGitLocation } from "../lib/git-worktree-health.mjs";
import {
  buildPublishedTree,
  checkPublishedTree,
  composeMessage,
  createOrphanCommit,
  excludedPaths,
  parseExcludes,
  patternToRegExp,
  resolveSourceTree,
  retainedRefs,
  snapshot,
} from "./public-snapshot.mjs";

/**
 * Environment for git in a THROWAWAY repository: no inherited git location (a hook in a linked worktree
 * exports GIT_DIR and git would then init/config/add/commit in the CALLER's repository — measured four
 * times in this repo, see the gate `git-v-testech-bez-prostredi`), no user/system config, no hooks, and
 * the identity supplied by variables so nothing is ever written with `git config`.
 */
const FIXTURE_ENV = {
  ...envWithoutGitLocation(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Snapshot Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Snapshot Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

// The tool itself runs git with the process environment (minus the git location). A clean CI container has
// no global identity, so `git commit-tree` would refuse; the identity therefore travels in the environment
// of this test file's worker — never through `git config`.
for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) process.env[k] = FIXTURE_ENV[k];

/** A throwaway repository with a clean tree, committed. Returns its root. */
function repoWith(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
  const g = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: FIXTURE_ENV });
  g("init", "-q", "-b", "main");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  return { root, g };
}

const CLEAN = {
  "README.md": "# demo\n",
  "src/a.ts": "export const a = 1;\n",
  ".github/dependabot.yml": "version: 2\n",
  ".github/workflows/ci.yml": "name: ci\n",
  "config/public-snapshot.exclude": "# reason\n.github/dependabot.yml\n",
  "services/x/src/pem.ts": 'const h = "-----BEGIN RSA PRIVATE KEY-----"; // header only, parses PEM\n',
  "docs/example.md": "contact: someone@gmail.com (documentation example)\n",
  "e2e/fixture.ts": "const mail = 'driver@gmail.com';\n",
  "infra/net.conf": "listen 10.0.0.1 and 192.168.2.44 and 203.0.113.9 and 198.18.0.5 and 1.2.3.4 and 172.32.0.0\n",
};

describe("exclusion patterns (gitignore-style)", () => {
  it("anchors patterns with a slash and matches slash-less patterns at any depth", () => {
    expect(patternToRegExp(".github/dependabot.yml").test(".github/dependabot.yml")).toBe(true);
    expect(patternToRegExp(".github/dependabot.yml").test("x/.github/dependabot.yml")).toBe(false);
    expect(patternToRegExp("*.lockb").test("deep/dir/bun.lockb")).toBe(true);
    expect(patternToRegExp("trash/").test("trash/legacy/file.ts")).toBe(true);
    expect(patternToRegExp("trash/").test("trashy/file.ts")).toBe(false);
    expect(patternToRegExp("**/00_prod_users*.sql").test("aisha/db/seed/demo/00_prod_users.sql")).toBe(true);
  });

  it("parses the exclude file: blank lines and comments are not patterns", () => {
    expect(parseExcludes("# c\n\n.github/dependabot.yml\n  \n")).toEqual([".github/dependabot.yml"]);
    expect(excludedPaths(["a", ".github/dependabot.yml"], [".github/dependabot.yml"])).toEqual([".github/dependabot.yml"]);
  });
});

describe("published tree", () => {
  let repo;
  beforeAll(() => { repo = repoWith(CLEAN); });
  afterAll(() => rmSync(repo.root, { recursive: true, force: true }));

  it("drops exactly the excluded paths and keeps everything else", () => {
    const src = resolveSourceTree(repo.root, "HEAD");
    const built = buildPublishedTree(repo.root, src.tree, [".github/dependabot.yml"]);
    const files = repo.g("ls-tree", "-r", "--name-only", built.tree).split("\n").filter(Boolean);
    expect(files).not.toContain(".github/dependabot.yml");
    expect(files).toContain(".github/workflows/ci.yml");
    expect(files).toContain("src/a.ts");
    expect(built.excluded).toEqual([".github/dependabot.yml"]);
    expect(built.fileCount).toBe(Object.keys(CLEAN).length - 1);
  });

  it("a clean tree passes every check — a PEM header without a body, private IPs and fixture mail are not findings", () => {
    const src = resolveSourceTree(repo.root, "HEAD");
    const checks = checkPublishedTree(repo.root, src.tree);
    expect(checks.findings).toEqual([]);
    expect(checks.ok).toBe(true);
    // the summary names every check even when it found nothing — a silent check is indistinguishable from a blind one
    expect(Object.keys(checks.summary)).toEqual(expect.arrayContaining(["prod-users-seed", "private-key-body", "service-role-jwt", "coolify-api-token", "home-directory-path", "freemail-address", "public-ipv4"]));
  });

  it("the orphan commit has no parent and its message names the source commit and the tree", () => {
    const src = resolveSourceTree(repo.root, "HEAD");
    const built = buildPublishedTree(repo.root, src.tree, []);
    const checks = checkPublishedTree(repo.root, built.tree);
    const message = composeMessage({ label: "public alpha preview 6", source: src, published: built, checks, trailers: ["Signed-off-by: T <t@example.test>"] });
    const commit = createOrphanCommit(repo.root, built.tree, message);
    const raw = repo.g("cat-file", "-p", commit);
    expect(raw).not.toMatch(/^parent /m);
    expect(raw).toContain(`tree ${built.tree}`);
    expect(raw).toContain(`Source: ${src.base}`);
    expect(raw).toContain("public alpha preview 6");
    expect(raw).toContain("Signed-off-by: T <t@example.test>");
  });

  it("worktree mode ships uncommitted files and records what differs from the base commit", () => {
    writeFileSync(path.join(repo.root, "docs/new.md"), "uncommitted\n");
    const src = resolveSourceTree(repo.root, "worktree");
    expect(src.dirty).toBe(true);
    expect(src.changed.some((l) => l.endsWith("docs/new.md"))).toBe(true);
    const files = repo.g("ls-tree", "-r", "--name-only", src.tree).split("\n");
    expect(files).toContain("docs/new.md");
    expect(repo.g("status", "--porcelain")).toContain("docs/new.md"); // the real index is untouched
    rmSync(path.join(repo.root, "docs/new.md"));
  });
});

describe("submodule pointers in the public tree", () => {
  const UPSTREAM = "a".repeat(40);
  const PUBLIC = "b".repeat(40);
  let repo;
  beforeAll(() => {
    repo = repoWith(CLEAN);
    repo.g("update-index", "--add", "--cacheinfo", `160000,${UPSTREAM},packages/sub`);
    repo.g("commit", "-q", "-m", "submodule pointer");
  });
  afterAll(() => rmSync(repo.root, { recursive: true, force: true }));

  it("point at the submodule's public snapshot commit, and the commit message says so", () => {
    const src = resolveSourceTree(repo.root, "HEAD");
    const built = buildPublishedTree(repo.root, src.tree, [], { "packages/sub": PUBLIC });
    expect(repo.g("ls-tree", built.tree, "packages/sub")).toContain(`160000 commit ${PUBLIC}`);
    expect(built.gitlinks).toEqual([{ path: "packages/sub", from: UPSTREAM, to: PUBLIC }]);
    const checks = checkPublishedTree(repo.root, built.tree);
    const message = composeMessage({ label: "x", source: src, published: built, checks, trailers: [] });
    expect(message).toContain(`packages/sub ${UPSTREAM.slice(0, 12)} -> ${PUBLIC}`);
    // the source tree itself is untouched
    expect(repo.g("ls-tree", "HEAD", "packages/sub")).toContain(UPSTREAM);
  });

  it("a path that is not a submodule pointer, or an abbreviated commit, is an error — never a silent no-op", () => {
    const src = resolveSourceTree(repo.root, "HEAD");
    expect(() => buildPublishedTree(repo.root, src.tree, [], { "README.md": PUBLIC })).toThrow(/not a submodule pointer/);
    expect(() => buildPublishedTree(repo.root, src.tree, [], { "packages/missing": PUBLIC })).toThrow(/not a submodule pointer/);
    expect(() => buildPublishedTree(repo.root, src.tree, [], { "packages/sub": "abc1234" })).toThrow(/full commit id/);
  });
});

describe("a remote that keeps refs a forced push cannot remove", () => {
  let repo;
  let remote;
  beforeAll(() => {
    repo = repoWith(CLEAN);
    remote = mkdtempSync(path.join(os.tmpdir(), "snapshot-remote-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: FIXTURE_ENV, stdio: ["pipe", "pipe", "pipe"] });
    repo.g("remote", "add", "public", remote);
    repo.g("push", "-q", "public", "HEAD:refs/heads/main");
    // what a forge does for every pull request ever opened: a ref outside refs/heads/ that keeps old history
    repo.g("push", "-q", "public", "HEAD:refs/pull/1/head");
  });
  afterAll(() => {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it("is refused: nothing is committed and nothing is pushed", () => {
    const before = repo.g("ls-remote", "public", "refs/heads/main").split("\t")[0];
    const r = snapshot(repo.root, { source: "HEAD", label: "x", push: "public", excludeFile: "config/public-snapshot.exclude" });
    expect(retainedRefs(repo.root, "public")).toEqual(["refs/pull/1/head"]);
    expect(r.refused).toMatch(/refs\/pull\/1\/head/);
    expect(r.commit).toBeNull();
    expect(r.pushed).toBeNull();
    expect(repo.g("ls-remote", "public", "refs/heads/main").split("\t")[0]).toBe(before);
    // the dry-run must tell the same truth as the real run
    const dry = snapshot(repo.root, { source: "HEAD", label: "x", push: "public", dryRun: true, excludeFile: "config/public-snapshot.exclude" });
    expect(dry.refused).toMatch(/refs\/pull\/1\/head/);
  });

  it("with the explicit override it publishes ONE parentless commit and reports what the remote still keeps", () => {
    const r = snapshot(repo.root, { source: "HEAD", label: "x", push: "public", acceptRetainedRefs: true, excludeFile: "config/public-snapshot.exclude" });
    expect(r.refused).toBeNull();
    expect(r.retained).toEqual(["refs/pull/1/head"]);
    expect(repo.g("ls-remote", "public", "refs/heads/main").split("\t")[0]).toBe(r.commit);
    expect(repo.g("cat-file", "-p", r.commit)).not.toMatch(/^parent /m);
  });
});

describe("checks see what they claim to see", () => {
  const PLANTED_PUBLIC_IP = [208, 67, 222, 222].join(".");
  const PLANTED = {
    ...CLEAN,
    "aisha/db/seed/demo/00_prod_users.sql": "insert into users values ('x');\n",
    ".env": "SECRET=1\n",
    ".env.coolify.example": "JWT_SECRET=<generate>\n",
    "scripts/find.mjs": "const token = '3|" + "k".repeat(44) + "';\n",
    "docs/path.md": "see /Users/someone/projects/x\n",
    "keys/leaked.txt": "-----BEGIN EC PRIVATE KEY-----\n" + "A".repeat(64) + "\n-----END EC PRIVATE KEY-----\n",
    "src/jwt.ts": "const t = 'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoieCJ9.eyJhIjoxfQ." + "s".repeat(32) + "';\n",
    "src/contact.ts": "const mail = 'real.person@seznam.cz';\n",
    // assembled at runtime: a public resolver's address (not ours) that must never appear literally in the tree
    "infra/public.conf": `upstream ${PLANTED_PUBLIC_IP};\n`,
    "config/operators.json": "{}\n",
    "config/tenant.json": "{}\n",
  };
  let repo;
  beforeAll(() => { repo = repoWith(PLANTED); });
  afterAll(() => rmSync(repo.root, { recursive: true, force: true }));

  it("flags every planted class and refuses to commit", () => {
    const r = snapshot(repo.root, { source: "HEAD", label: "x", excludeFile: "config/public-snapshot.exclude" });
    expect(r.checks.ok).toBe(false);
    expect(r.commit).toBeNull();
    const ids = new Set(r.checks.findings.map((f) => f.check));
    for (const id of ["prod-users-seed", "real-env-file", "coolify-api-token", "home-directory-path", "private-key-body", "service-role-jwt", "freemail-address", "public-ipv4", "operator-roster", "tenant-sentinels"]) {
      expect(ids, `missing check ${id}`).toContain(id);
    }
    expect(r.checks.findings.find((f) => f.check === "real-env-file" && f.path === ".env.coolify.example")).toBeUndefined();
    expect(r.checks.findings.find((f) => f.check === "public-ipv4").value).toBe(PLANTED_PUBLIC_IP);
  });
});
