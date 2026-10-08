// github-ci-secret.sh — CI secret na GitHubu přes `gh`, fail-closed bez repa/tokenu.
// Spouští se skutečný bash nad podstrčeným `gh`, který zapíše argv, prostředí a STDIN.
import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "github-ci-secret.sh");
// Bash absolutní cestou: PATH běhu nese JEN podstrčený adresář, aby se skutečné
// `gh` hostitele (třeba /usr/bin/gh) nikdy nezavolalo.
const BASH = execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();

function beh(env, { sGh = true, ghKod = 0 } = {}) {
  const bin = mkdtempSync(join(tmpdir(), "aisha-gh-"));
  const zaznam = join(bin, "zaznam");
  if (sGh) {
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\n{ echo "ARGS=$*"; echo "GH_TOKEN=\${GH_TOKEN:-}"; echo "GH_HOST=\${GH_HOST:-}"; echo "GH_ENTERPRISE_TOKEN=\${GH_ENTERPRISE_TOKEN:-}"; printf 'STDIN='; IFS= read -r l; printf '%s\\n' "$l"; } > "${zaznam}"\nexit ${ghKod}\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
  }
  const r = spawnSync(BASH, ["-c", `. "${LIB}"; github_ci_secret_set COOLIFY_TOKEN tajna-hodnota; echo "rc=$?"`], {
    encoding: "utf8",
    env: { PATH: bin, ...env },
  });
  const rc = Number(/rc=(\d+)/.exec(r.stdout)?.[1]);
  return { rc, zaznam: existsSync(zaznam) ? readFileSync(zaznam, "utf8") : null, vystup: `${r.stdout}${r.stderr}` };
}

describe("github_ci_secret_set", () => {
  it("⛔ bez GITHUB_REPOSITORY nic nevolá a vrátí 2 (nenakonfigurováno, žádné dosazené repo)", () => {
    const { rc, zaznam } = beh({ GITHUB_TOKEN: "t" });
    expect(rc).toBe(2);
    expect(zaznam).toBeNull();
  });

  it("⛔ bez GITHUB_TOKEN nic nevolá a vrátí 2", () => {
    const { rc, zaznam } = beh({ GITHUB_REPOSITORY: "acme/platform" });
    expect(rc).toBe(2);
    expect(zaznam).toBeNull();
  });

  it("bez gh CLI vrátí 3", () => {
    expect(beh({ GITHUB_REPOSITORY: "acme/platform", GITHUB_TOKEN: "t" }, { sGh: false }).rc).toBe(3);
  });

  it("github.com: hodnota jde STDINem, ne v argv; token přes GH_TOKEN", () => {
    const { rc, zaznam, vystup } = beh({ GITHUB_REPOSITORY: "acme/platform", GITHUB_TOKEN: "tok" });
    expect(rc).toBe(0);
    expect(zaznam).toContain("ARGS=secret set COOLIFY_TOKEN --repo acme/platform");
    expect(zaznam).toContain("GH_TOKEN=tok");
    expect(zaznam).toContain("STDIN=tajna-hodnota");
    expect(zaznam).not.toMatch(/ARGS=.*tajna-hodnota/);
    expect(vystup).not.toContain("tajna-hodnota");
  });

  it("GitHub Enterprise: host z GITHUB_API_URL → GH_HOST + --repo host/owner/repo", () => {
    const { rc, zaznam } = beh({
      GITHUB_API_URL: "https://git.example.com/api/v3/",
      GITHUB_REPOSITORY: "acme/platform",
      GITHUB_TOKEN: "tok",
    });
    expect(rc).toBe(0);
    expect(zaznam).toContain("ARGS=secret set COOLIFY_TOKEN --repo git.example.com/acme/platform");
    expect(zaznam).toContain("GH_HOST=git.example.com");
    expect(zaznam).toContain("GH_ENTERPRISE_TOKEN=tok");
  });

  it("⛔ GITHUB_API_URL bez https se odmítne (1) a gh se nevolá", () => {
    const { rc, zaznam } = beh({ GITHUB_API_URL: "http://git.example.com/api/v3", GITHUB_REPOSITORY: "a/b", GITHUB_TOKEN: "t" });
    expect(rc).toBe(1);
    expect(zaznam).toBeNull();
  });

  it("selhání gh se nepřikryje (1)", () => {
    expect(beh({ GITHUB_REPOSITORY: "acme/platform", GITHUB_TOKEN: "t" }, { ghKod: 1 }).rc).toBe(1);
  });
});
