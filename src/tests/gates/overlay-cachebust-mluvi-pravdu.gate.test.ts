/**
 * Brána: refresh-overlay-cachebust.sh MLUVÍ PRAVDU — chování, ne text.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (CI běh 51874, riq main 3e0886282): deploy joby neměly
 * FORGEJO_TOKEN, `git ls-remote` soukromého overlay repa selhal, skript vypsal
 * warning — a skončil 0 (smyčka v rouře = podskořepina, neúspěch jen `continue`).
 * Souhrn deploy-and-verify z toho udělal „PROVEDENO" a core i extranet se
 * postavily z KEŠOVANÉHO overlaye.
 *
 * Skript se pouští proti zastrčenému `curl` (envy aplikace) a `git` (soukromé
 * repo: ls-remote projde JEN s tokenem v URL). Statické protějšky (token v každé
 * nasazující úloze, souhrn čte kód) jsou v overlay-clone-cachebust.gate.test.ts.
 * Heavy dráha: každý běh skriptu spouští bash + python3 několikrát (lanes.json).
 */
import { describe, it, expect } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

describe("refresh-overlay-cachebust.sh: kód odpovídá tomu, co se stalo", () => {
  // ── Chování skriptu proti zastrčenému světu ──────────────────────────────
  const OVERLAY_URL = "https://repo.example.invalid/org/instance-data.git";
  const SHA_HEAD = "b2e1b141caae0000000000000000000000000000";

  function spust(o: { envyJson: string | null; token: string }) {
    const tmp = spawnSync("mktemp", ["-d"], { encoding: "utf8" }).stdout.trim();
    const curl = `#!/usr/bin/env bash
# GET envů vrátí fixturu (nebo nic = nečitelné); PATCH/POST vrátí HTTP 200.
for a in "$@"; do case "$a" in PATCH|POST) printf 200; exit 0;; esac; done
[ -n "\${ENVY_JSON:-}" ] && printf '%s' "$ENVY_JSON"
exit 0
`;
    // Model CI (NAMĚŘENO 2026-09-25, běh 1528): workspace nese extraheader s tokenem
    // běhu → ls-remote BEZ \`-C <jiný adresář>\` selže, i když token v URL platí.
    // Soukromé repo pak projde JEN se správným tokenem v URL; chyba gitu nese URL
    // i s tokenem (jako skutečný git) — skript ji musí vypsat MASKOVANOU.
    const git = `#!/usr/bin/env bash
if [ "$1" = "-C" ]; then
  [ "$2" != "$PWD" ] || { echo "fatal: could not read Password (extraheader workspace)" >&2; exit 128; }
  shift 2
else
  echo "fatal: could not read Password: terminal prompts disabled (extraheader workspace)" >&2; exit 128
fi
[ "$1" = "ls-remote" ] || exit 1
case "$*" in *://spravny@*) printf '%s\\t%s\\n' "${SHA_HEAD}" HEAD; exit 0;; esac
u=""; for a in "$@"; do case "$a" in *://*) u="$a";; esac; done
echo "fatal: Authentication failed for '$u'" >&2; exit 128
`;
    writeFileSync(join(tmp, "curl"), curl, { mode: 0o755 });
    writeFileSync(join(tmp, "git"), git, { mode: 0o755 });
    const env: Record<string, string> = {
      PATH: `${tmp}:${process.env.PATH}`,
      COOLIFY_API_TOKEN: "t",
      COOLIFY_BASE_URL: "https://coolify.example.invalid",
      FORGEJO_TOKEN: o.token,
      ENVY_JSON: o.envyJson ?? "",
    };
    const r = spawnSync("bash", ["scripts/deploy/refresh-overlay-cachebust.sh", "uuid-x", "extranet"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      // Pod zátěží stroje (naměřeno 2026-09-24: load 50–250) skript s několika
      // spuštěními python3 přesáhl 30 s a test padl na TIMEOUTU, ne na chování.
      // Heavy dráha — čas tu není předmětem tvrzení, kód ano.
      timeout: 180_000,
    });
    rmSync(tmp, { recursive: true, force: true });
    return { rc: r.status, err: r.stderr, out: r.stdout };
  }

  const envy = (s: Record<string, string>) =>
    JSON.stringify(Object.entries(s).map(([key, value]) => ({ key, value, is_preview: false })));

  it("deklarovaný overlay BEZ tokenu → kód 3 (NEDOKÁZÁNO), ne 0", { timeout: 200_000 }, () => {
    const r = spust({ envyJson: envy({ SURFACE_OVERLAY_GIT_URL: OVERLAY_URL, SURFACE_OVERLAY_CACHEBUST: "stare" }), token: "" });
    expect({ rc: r.rc, rika: /NEDOKÁZÁNO/.test(r.err) }).toEqual({ rc: 3, rika: true });
  });

  it("deklarovaný overlay S tokenem → HEAD přečten, zapsán, kód 0", { timeout: 200_000 }, () => {
    // Projde JEN proto, že ls-remote běží mimo workspace (\`-C\`) — model extraheaderu.
    const r = spust({ envyJson: envy({ SURFACE_OVERLAY_GIT_URL: OVERLAY_URL, SURFACE_OVERLAY_CACHEBUST: "stare" }), token: "spravny" });
    expect({ rc: r.rc, zapsano: r.out.includes("zapsáno") }, r.err).toEqual({ rc: 0, zapsano: true });
  });

  it("neplatný token → kód 3 a důvod od gitu v logu, token MASKOVANÝ", { timeout: 200_000 }, () => {
    // Dřív `2>/dev/null` schoval příčinu a v CI se hádalo (běh 1528).
    const r = spust({ envyJson: envy({ SURFACE_OVERLAY_GIT_URL: OVERLAY_URL, SURFACE_OVERLAY_CACHEBUST: "stare" }), token: "zly-token-4242" });
    expect({
      rc: r.rc,
      duvod: /git: fatal: Authentication failed/.test(r.err),
      maskovano: r.err.includes("***"),
      neuniklo: !r.err.includes("zly-token-4242"),
    }).toEqual({ rc: 3, duvod: true, maskovano: true, neuniklo: true });
  });

  it("nedeklarovaný overlay → není co obnovovat, kód 0 (komunitní instalace)", { timeout: 200_000 }, () => {
    const r = spust({ envyJson: envy({ JINY_KLIC: "x" }), token: "" });
    expect(r.rc).toBe(0);
  });

  it("nečitelné envy aplikace → nevíme, jestli overlay je → kód 3, ne „není co obnovovat“", { timeout: 200_000 }, () => {
    const r = spust({ envyJson: null, token: "tok" });
    expect(r.rc).toBe(3);
  });

});
