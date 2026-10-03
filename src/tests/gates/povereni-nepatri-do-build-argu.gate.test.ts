/**
 * Pověření nepatří do build argu — a stráž musí mít KAŽDÝ Dockerfile, ne jen ten,
 * kde se na to zrovna přišlo.
 *
 * ⛔ NAMĚŘENO DVAKRÁT, SE STEJNÝM ZÁVĚREM:
 *   2026-08-15 — FORGEJO_TOKEN v `docker history` KONEČNÉHO obrazu svc-web-artifactu.
 *   2026-09-21 — táž vada u povrchu: `*_GIT_URL` s pověřením v URL se zapsalo do
 *                historie ČTYŘ obrazů (extranet ×2, pki-init ×2) ze 175 na hostiteli.
 *
 * Proč build arg a ne runtime env: Coolify `modify_dockerfiles_for_compose()`
 * vkládá `ARG <KEY>` za KAŽDÝ `FROM`, tedy i za běhový — deklarace se znovu zavede
 * a hodnota se zapíše do metadat. Obrana postavená na tvaru Dockerfilu (že ARG je
 * jen v build stage) NEOBSTOJÍ. Token patří výhradně do BuildKit secretu.
 *
 * Po prvním nálezu se stráž roznesla do tří souborů — a do čtvrtého, právě toho,
 * KDE VADA VZNIKLA, nedošla. Proto tahle brána: univerzum si HLEDÁ ve stromu,
 * nepíše se ručně, takže nový Dockerfile s `*_GIT_URL` neprojde bez stráže.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

/** Univerzum se HLEDÁ: každý sledovaný Dockerfile ve stromu. */
function dockerfily(): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter((f) => /(^|\/)Dockerfile(\.|$)/.test(f));
}

/** Bere soubor `*_GIT_URL` jako build arg? */
function argGitUrl(text: string): string[] {
  return [...text.matchAll(/^ARG\s+([A-Z0-9_]*GIT_URL)\b/gm)].map((m) => m[1]);
}

/** Má stráž, která odmítne autoritu s `@` (tj. pověření v URL)? */
function maStraz(text: string): boolean {
  // Nepočítáme komentáře — stráž v komentáři je tichá díra (naměřeno u detektoru politik).
  const kod = text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");
  return /case\s+"\$[A-Za-z_][A-Za-z0-9_]*"\s+in\s+\*@\*\)/.test(kod);
}

describe("pověření nepatří do build argu", () => {
  const univerzum = dockerfily().map((f) => ({ f, t: readFileSync(resolve(ROOT, f), "utf8") }));

  it("kontrolní vzorek: hledání univerza opravdu Dockerfily najde", () => {
    expect(univerzum.length, "git ls-files nevrátil žádný Dockerfile — měřidlo měří prázdno").toBeGreaterThan(5);
  });

  it("každý Dockerfile s ARG *_GIT_URL má stráž proti pověření v URL", () => {
    const bezStraze = univerzum
      .filter(({ t }) => argGitUrl(t).length > 0)
      .filter(({ t }) => !maStraz(t))
      .map(({ f, t }) => `${f} (ARG: ${argGitUrl(t).join(", ")})`);
    expect(
      bezStraze,
      "Build arg se zapisuje do `docker history` KONEČNÉHO obrazu (Coolify vkládá ARG za každý FROM). " +
        "Doplň stráž podle deploy/surface-host/Dockerfile:\n" +
        '  AUTORITA="${<KLIC>#https://}"; AUTORITA="${AUTORITA%%/*}"; \\\n' +
        '  case "$AUTORITA" in *@*) echo "FATAL: <KLIC> nese pověření v URL" >&2; exit 1 ;; esac; \\\n' +
        "Token patří do BuildKit secretu (--mount=type=secret,id=forgejo_token).",
    ).toEqual([]);
  });

  it("NEGATIVNÍ KONTROLA: měřidlo umí říct ne", () => {
    // Dockerfile s ARG *_GIT_URL a BEZ stráže musí projít jako nález.
    const zly = 'FROM alpine\nARG NECO_GIT_URL=\nRUN echo "$NECO_GIT_URL"\n';
    expect(argGitUrl(zly)).toEqual(["NECO_GIT_URL"]);
    expect(maStraz(zly), "zmutovaný vzorek prošel — brána by nic nechytila").toBe(false);
    // A stráž schovaná v KOMENTÁŘI se nesmí počítat.
    const vKomentari = `${zly}# case "$AUTORITA" in *@*) exit 1 ;; esac\n`;
    expect(maStraz(vKomentari), "stráž v komentáři je tichá díra, ne stráž").toBe(false);
  });
});
