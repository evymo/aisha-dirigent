import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from "vitest";
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
  replacedHeads,
  resolveSourceTree,
  retainedRefs,
  snapshot,
} from "./public-snapshot.mjs";

// Every test here builds a real repository and greps a tree a dozen times. On a loaded machine (this one
// runs several sessions at once) a case takes 3–14 s, so the default 5 s limit measured the load, not the
// code: two cases "failed" by timing out. The limit says how long a HUNG git may hold the run.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// Every case here is synchronous (execFileSync). The worker acknowledges progress to the runner over an
// RPC with a 60 s limit and reads the reply only when its event loop turns — which back-to-back synchronous
// cases never let it do. Under load this file takes two minutes and the run ended "20 passed, 1 error:
// Timeout calling onTaskUpdate" (measured twice, 2026-10-03/04; at 40 s it never happened). One macrotask
// between cases lets the worker read its mail; the limit then measures a single case, not the whole file.
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

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

// Values that the checks (and the repository's own guards) must find are BUILT here, never written as
// literals: a literal token, address or key in this file would be a finding in the very tree it tests.
const mail = (local, domena) => [local, domena].join("@");
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), "s".repeat(43)].join(".");
const klic = (typ, radky, sirka) => [`-----BEGIN ${typ}PRIVATE KEY-----`, ...Array.from({ length: radky }, () => "Qk".repeat(sirka / 2)), `-----END ${typ}PRIVATE KEY-----`];
const VEREJNA_IP = [208, 67, 222, 222].join(".");
const DRUHA_IP = [208, 67, 220, 220].join(".");

const CLEAN = {
  "README.md": "# demo\n",
  "src/a.ts": "export const a = 1;\n",
  ".github/dependabot.yml": "version: 2\n",
  ".github/workflows/ci.yml": "name: ci\n",
  "config/public-snapshot.exclude": "# reason\n.github/dependabot.yml\n",
  "services/x/src/pem.ts": 'const h = "-----BEGIN RSA PRIVATE KEY-----"; // header only, parses PEM\n',
  "docs/example.md": "contact: someone@example.org (documentation example)\n",
  "e2e/fixture.ts": `const mail = '${mail("driver", "gmail.com")}';\n`,
  // look-alikes that are NOT findings
  "docs/versions.md": "Chrome/120.0.0.0 · lib 1.2.3.4.5 · OID 1.3.6.1.4.1 · image under /home/node/app/ · anon " + jwt({ role: "anon", iss: "x" }) + "\n",
  "package-lock.json": `{"resolved":"https://registry.example/${VEREJNA_IP}/x.tgz"}\n`,
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
    expect(Object.keys(checks.summary)).toEqual(expect.arrayContaining(["prod-users-seed", "submodule-pointer-not-public", "private-key-body", "service-role-jwt", "coolify-api-token", "provider-token", "home-directory-path", "freemail-address", "public-ipv4"]));
    // …and says what it did not measure: the lockfile above is excluded by NAME and counted
    expect(checks.unscanned.lockfiles).toBe(1);
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

describe("shapes the first version of the checks did not see (council review 2026-10-03)", () => {
  const najdi = (files) => {
    const repo = repoWith({ "README.md": "# x\n", ...files });
    try {
      const src = resolveSourceTree(repo.root, "HEAD");
      return checkPublishedTree(repo.root, src.tree);
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  };
  const tridy = (r) => [...new Set(r.findings.map((f) => f.check))].sort();

  it("a service_role JWT is recognised by its DECODED payload — role first or not", () => {
    const r = najdi({
      "a.env.txt": `KEY=${jwt({ role: "service_role", iss: "x", exp: 2240000000 })}\n`,
      "b.ts": `const k = "${jwt({ iss: "aisha", ref: "abc", role: "service_role", exp: 2240000000 })}";\n`,
      "c.ts": `const anon = "${jwt({ iss: "aisha", role: "anon" })}";\n`,
    });
    expect(r.findings.filter((f) => f.check === "service-role-jwt").map((f) => f.path).sort()).toEqual(["a.env.txt", "b.ts"]);
  });

  it("a private key body is seen at any line width, with CRLF, indented in YAML and on one JSON line", () => {
    // an encrypted PEM: RFC 1421 headers between the armour and the body — built, like every other input
    const [hlava, telo, pata] = klic("RSA ", 1, 64);
    const sifrovany = [hlava, "Proc-Type: 4,ENCRYPTED", "DEK-Info: AES-128-CBC,0123456789ABCDEF", "", telo, pata];
    const r = najdi({
      "openssh.txt": klic("OPENSSH ", 4, 70).join("\n") + "\n",
      "crlf.pem.txt": klic("RSA ", 3, 64).join("\r\n") + "\r\n",
      "wide.txt": klic("", 3, 76).join("\n") + "\n",
      "secret.yaml": "key: |\n" + klic("EC ", 2, 64).map((l) => "    " + l).join("\n") + "\n",
      "account.json": JSON.stringify({ private_key: klic("", 2, 64).join("\n") + "\n" }) + "\n",
      "encrypted.txt": sifrovany.join("\n") + "\n",
      // look-alikes: armour without a body (a parser's constants, a truncated example in documentation)
      "parser.ts": `const h = "${hlava}"; pem.replace(/${klic("", 0, 0)[0]}/, "");\n`,
      "doc.md": klic("EC ", 0, 0).map((l) => "    " + l).join("\n    ....\n") + "\n",
    });
    expect(r.findings.filter((f) => f.check === "private-key-body").map((f) => f.path).sort())
      .toEqual(["account.json", "crlf.pem.txt", "encrypted.txt", "openssh.txt", "secret.yaml", "wide.txt"]);
  });

  it("every address on a line is seen: at the end of a sentence, second in a list, leading a host name", () => {
    const r = najdi({
      "a.md": `The router is ${VEREJNA_IP}.\n`,
      "b.conf": `peers=${VEREJNA_IP},${DRUHA_IP}\n`,
      "c.md": `open http://${DRUHA_IP}.nip.io/ in a browser\n`,
      "d.lock": `pinned ${VEREJNA_IP}\n`, // not a lockfile by NAME — scanned
    });
    const ips = r.findings.filter((f) => f.check === "public-ipv4");
    expect(ips.filter((f) => f.path === "a.md").map((f) => f.value)).toEqual([VEREJNA_IP]);
    expect(ips.filter((f) => f.path === "b.conf").map((f) => f.value)).toEqual([VEREJNA_IP, DRUHA_IP]);
    expect(ips.filter((f) => f.path === "c.md").map((f) => f.value)).toEqual([DRUHA_IP]);
    expect(ips.filter((f) => f.path === "d.lock").length).toBe(1);
  });

  it("a personal home directory on Linux, a provider token and a bare SSH key file are findings", () => {
    const r = najdi({
      "runbook.md": "logs are in /home/alice/logs/ and the image runs under /home/node/app/\n",
      "ci.yml": `token: ${["gl", "dt-"].join("")}${"Ab1_".repeat(6)}\n`,
      "gh.txt": `${["gh", "p_"].join("")}${"a1B2".repeat(9)}\n`,
      "id_ed25519": "not really a key, but nobody ships a file with this name\n",
      "regex.mjs": `const re = /${mail("jan.novak", "gmail\\.com")}/;\n`,
    });
    expect(tridy(r)).toEqual(["freemail-address", "home-directory-path", "private-key-file", "provider-token"]);
    expect(r.findings.filter((f) => f.check === "home-directory-path").length).toBe(1); // /home/node is a container account
    expect(r.findings.filter((f) => f.check === "provider-token").map((f) => f.path).sort()).toEqual(["ci.yml", "gh.txt"]);
  });

  it("what was not scanned is counted, not silently skipped", () => {
    const repo = repoWith({ "README.md": "# x\n" });
    try {
      writeFileSync(path.join(repo.root, "blob.bin"), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02, 0x00]));
      writeFileSync(path.join(repo.root, "yarn.lock"), "# lock\n");
      repo.g("add", "-A"); repo.g("commit", "-q", "-m", "binary");
      const r = checkPublishedTree(repo.root, resolveSourceTree(repo.root, "HEAD").tree);
      expect(r.unscanned).toEqual({ binary: 1, lockfiles: 1 });
      const message = composeMessage({ label: "x", source: resolveSourceTree(repo.root, "HEAD"), published: { tree: "t", fileCount: 3, excluded: [], gitlinks: [] }, checks: r, trailers: [] });
      expect(message).toContain("Not scanned: 1 binary file(s), 1 lockfile(s)");
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
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
    const checks = checkPublishedTree(repo.root, built.tree, { publicGitlinks: built.gitlinks.map((g) => g.path) });
    expect(checks.findings.filter((f) => f.check === "submodule-pointer-not-public")).toEqual([]);
    const message = composeMessage({ label: "x", source: src, published: built, checks, trailers: [] });
    expect(message).toContain(`packages/sub ${UPSTREAM.slice(0, 12)} -> ${PUBLIC}`);
    // the source tree itself is untouched
    expect(repo.g("ls-tree", "HEAD", "packages/sub")).toContain(UPSTREAM);
  });

  it("a pointer that was NOT rewritten is a finding: nobody outside can resolve an upstream commit", () => {
    // Measured on the first preview 6: three pointers went out naming upstream commits, and the tool
    // said nothing because it only acted when --gitlink was given.
    const r = snapshot(repo.root, { source: "HEAD", label: "x", excludeFile: "config/public-snapshot.exclude" });
    expect(r.checks.ok).toBe(false);
    expect(r.checks.findings).toContainEqual({ check: "submodule-pointer-not-public", path: "packages/sub", value: UPSTREAM });
    expect(r.commit).toBeNull();
    const ok = snapshot(repo.root, { source: "HEAD", label: "x", excludeFile: "config/public-snapshot.exclude", gitlinks: { "packages/sub": PUBLIC } });
    expect(ok.checks.ok).toBe(true);
    expect(ok.commit).toMatch(/^[0-9a-f]{40}$/);
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

describe("a head that a push replaces stays with the remote", () => {
  let repo;
  let remote;
  let empty;
  const bare = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snapshot-remote-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", dir], { env: FIXTURE_ENV, stdio: ["pipe", "pipe", "pipe"] });
    return dir;
  };
  const inRemote = (...a) => execFileSync("git", a, { cwd: remote, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: FIXTURE_ENV }).trim();
  beforeAll(() => {
    repo = repoWith(CLEAN);
    remote = bare();
    empty = bare();
    repo.g("remote", "add", "staging", remote);
    repo.g("remote", "add", "fresh", empty);
    repo.g("push", "-q", "staging", "HEAD:refs/heads/main");
    repo.g("push", "-q", "staging", "HEAD:refs/heads/older-preview");
  });
  afterAll(() => {
    for (const dir of [repo.root, remote, empty]) rmSync(dir, { recursive: true, force: true });
  });

  it("the first push into a repository replaces nothing", () => {
    expect(replacedHeads(repo.root, "fresh")).toEqual([]);
    expect(snapshot(repo.root, { source: "HEAD", label: "x", push: "fresh", dryRun: true, excludeFile: "config/public-snapshot.exclude" }).replaced).toEqual([]);
  });

  it("names the head it is about to replace — and every branch it is about to delete", () => {
    const head = repo.g("rev-parse", "HEAD").trim();
    expect(replacedHeads(repo.root, "staging")).toEqual([{ commit: head, branch: "main" }]);
    expect(replacedHeads(repo.root, "staging", { pruneRemoteBranches: true }).map((h) => h.branch).sort()).toEqual(["main", "older-preview"]);
  });

  it("the plan and the real run report the same head, and the replaced commit is still readable by its id", () => {
    const before = repo.g("rev-parse", "HEAD").trim();
    const dry = snapshot(repo.root, { source: "HEAD", label: "x", push: "staging", dryRun: true, excludeFile: "config/public-snapshot.exclude" });
    const real = snapshot(repo.root, { source: "HEAD", label: "x", push: "staging", excludeFile: "config/public-snapshot.exclude" });
    expect(dry.replaced).toEqual([{ commit: before, branch: "main" }]);
    expect(real.replaced).toEqual(dry.replaced);
    expect(inRemote("rev-parse", "refs/heads/main")).toBe(real.commit);
    // no ref names it any more …
    expect(inRemote("for-each-ref", "--contains", before, "refs/heads/main")).toBe("");
    // … and the remote still hands it out to whoever knows the id
    expect(inRemote("cat-file", "-t", before)).toBe("commit");
  });
});

describe("checks see what they claim to see", () => {
  const PLANTED_PUBLIC_IP = VEREJNA_IP;
  const PLANTED = {
    ...CLEAN,
    "aisha/db/seed/demo/00_prod_users.sql": "insert into users values ('x');\n",
    ".env": "SECRET=1\n",
    ".env.coolify.example": "JWT_SECRET=<generate>\n",
    "scripts/find.mjs": "const token = '3|" + "k".repeat(44) + "';\n",
    "docs/path.md": "see /Users/someone/projects/x\n",
    "keys/leaked.txt": "-----BEGIN EC PRIVATE KEY-----\n" + "A".repeat(64) + "\n-----END EC PRIVATE KEY-----\n",
    "src/jwt.ts": `const t = '${jwt({ role: "service_role", iss: "x", exp: 2240000000 })}';\n`,
    "src/contact.ts": `const mail = '${mail("real.person", "seznam.cz")}';\n`,
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
