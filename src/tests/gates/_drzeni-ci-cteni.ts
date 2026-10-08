/**
 * Postroj: ČTENÍ deklarace držení CESTOU CI — skutečný `scripts/ci/drzene-z-overlaye.sh`
 * se skutečným domovem (`scripts/lib/nasazeni-drzene.mjs`) a podvrženým `git`
 * (klon = kopie připraveného souboru, nikdy síť).
 *
 * Sdílí ho brána nasazeni-drzene-aplikace (chování čtení v CI) a brána
 * drzeni-plati-mimo-ci (rozdílový test: cesta CI × cesta studeného startu nad týmž
 * overlayem). Jeden postroj, aby obě měřily TUTÉŽ cestu CI, ne dvě podobné.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();

/** Spustí skript čtení se SKUTEČNÝM modulem a podvrženým `git` (klon = kopie připraveného souboru). */
export function nactiDrzeniCestouCI(o: { repo?: string; tokeny?: [string, string]; klonSelze?: boolean; obsah?: unknown }) {
  const d = mkdtempSync(join(tmpdir(), "drzene-overlay-"));
  const bin = join(d, "bin");
  mkdirSync(bin);
  const zdroj = join(d, "zdroj.json");
  if (o.obsah !== undefined) writeFileSync(zdroj, typeof o.obsah === "string" ? o.obsah : JSON.stringify(o.obsah));
  writeFileSync(
    join(bin, "git"),
    [
      "#!/usr/bin/env bash",
      '[ "$1" = -C ] && { echo abc1234; exit 0; }',
      'for a in "$@"; do [ "$a" = clone ] && klon=1; done',
      '[ -n "$klon" ] || exit 99',
      // Chyba ve tvaru skutečného gitu — adresa i s pověřením, které se NESMÍ vypsat.
      '[ "$STUB_KLON" = selze ] && { echo "fatal: unable to access \'https://oauth2:TAJNY-TOKEN-1@repo.example.test/x/\': Could not resolve host: repo.example.test" >&2; exit 128; }',
      'cil="${@: -1}"; mkdir -p "$cil"; [ -f "$STUB_ZDROJ" ] && cp "$STUB_ZDROJ" "$cil/nasazeni-drzene.json"; exit 0',
    ].join("\n") + "\n",
  );
  chmodSync(join(bin, "git"), 0o755);
  const vystup = join(d, "output");
  const r = spawnSync("bash", ["scripts/ci/drzene-z-overlaye.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: vystup,
      OVERLAY_REPO: o.repo ?? "",
      OVERLAY_TOKEN_PRIMARY: o.tokeny?.[0] ?? "",
      OVERLAY_TOKEN_FALLBACK: o.tokeny?.[1] ?? "",
      STUB_KLON: o.klonSelze ? "selze" : "",
      STUB_ZDROJ: zdroj,
    },
    timeout: 60_000,
  });
  const out = existsSync(vystup) ? readFileSync(vystup, "utf8") : "";
  const drzene = /^drzene=(.*)$/m.exec(out)?.[1];
  return { rc: r.status, text: `${r.stdout}\n${r.stderr}`, drzene };
}
