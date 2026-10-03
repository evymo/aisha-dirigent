/**
 * Gate: the pre-wipe safety path must FAIL CLOSED.
 *
 * WHY THIS EXISTS — measured on 2026-07-18, hours before a production `--wipe`:
 *
 *  1. `vault/` in the private instance-data repo was EMPTY. The off-machine
 *     encrypted vault backup had never once been written — while every run
 *     reported success. Three independent causes, each returning 0:
 *       - `age` was not installed (and was not in the script's Prerequisites)
 *       - AISHA_VAULT_BACKUP_AGE_RECIPIENT unset → whole branch skipped with a warn
 *       - AISHA_INSTANCE_DATA_GIT_URL carries a `#main` fragment which git does not
 *         strip, so the clone could not have succeeded anyway (verified: the same
 *         URL clones fine once the fragment is removed)
 *     Even with a recipient configured, a failed `git push` set rc=1, printed a
 *     warning, and the function still `return 0` — the operator had opted into
 *     off-machine DR and silently got a local-only copy.
 *
 *  2. `backup_vault_before_wipe` had no `--dry-run` guard. Two `--wipe --dry-run`
 *     invocations each reverse-synced live secrets and wrote a real
 *     `.vault-backups/vault-*.tgz`. A "show me the plan" run was mutating state.
 *
 *  3. `placeholder-scan.mjs` caught every git failure and continued with
 *     "standards patterns only", then printed
 *     "✅ no deploy-breaking placeholder values" — green after losing half its
 *     detection. (Root cause of the failure itself: a PATH resolving
 *     /usr/local/bin/git 2.19, which predates extensions.worktreeConfig.)
 *
 * THE RULE. On the path between `--wipe` and the destroy, a guard that cannot do
 * its job must REFUSE, never warn-and-continue. This gate pins the specific
 * regressions above, structurally — it reads the shipped source, so a future edit
 * that reintroduces "warn and return 0" fails here.
 *
 * See also: feedback_no_fallbacks_fail_loud, feedback_gates_green_because_invisible.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const SCAN = join(ROOT, "scripts/lib/placeholder-scan.mjs");
const URL_LIB = join(ROOT, "scripts/lib/instance-data-url.sh");

const cold = existsSync(COLD_START) ? readFileSync(COLD_START, "utf-8") : "";
const scan = existsSync(SCAN) ? readFileSync(SCAN, "utf-8") : "";

/** Body of a shell function, from `name() {` to the next top-level `}`. */
function shellFn(src: string, name: string): string {
  const start = src.indexOf(`${name}() {`);
  if (start < 0) return "";
  const end = src.indexOf("\n}", start);
  return end < 0 ? src.slice(start) : src.slice(start, end + 2);
}

describe("destroy: nedokončené mazání nesmí projít jako hotové", () => {
  // Táž rodina jako vault záloha výš, jen o krok dál: strážce, který svou práci
  // nedokáže udělat, musí ODMÍTNOUT. Tady tím strážcem je potvrzení destroy.
  //
  // NAMĚŘENO 2026-08-13 (riq): poll čekající na zmizení aplikací neměl lhůtu
  // (`while true`), takže se 185 kol točil nad jedinou aplikací, jejíž ZÁZNAM
  // Coolify nedokázal smazat — kontejnery byly dávno pryč. Řídicí rovina totiž
  // nedokončovala úlohy (tabulka logů nasazení přerostla strop paměti PHP, takže
  // padal i Coolifyho vlastní úklid zaseknutých úloh). Poll bez konce nemůže
  // nikdy dojít k závěru „tohle se samo nespraví".
  //
  // A druhá polovina: `wipe_orphan_apps` se volal NAPRÁZDNO — jeho návratový kód
  // nikdo nečetl, takže by běh pokračoval k vytváření aplikací nad zpola smazanou
  // platformou. Kód, který nikdo nekonzumuje, je totéž jako žádný.
  const fn = shellFn(cold, "wipe_orphan_apps");
  const TIMEOUTS = join(ROOT, "config/cold-start-timeouts.env");
  const timeouts = existsSync(TIMEOUTS) ? readFileSync(TIMEOUTS, "utf-8") : "";

  test("potvrzení destroy má lhůtu, ne nekonečné čekání", () => {
    expect(fn.length, "wipe_orphan_apps nenalezen").toBeGreaterThan(0);
    // Nestačí, že se jméno proměnné někde vyskytuje — první verze tohohle testu
    // hledala jen `_wipe_deadline` a mutace `if false; then` jí prošla. Pin musí
    // sedět na tom, co rozhoduje: POROVNÁNÍ lhůty s hodinami uvnitř smyčky.
    // Bez ukotvení na JEDEN řádek si regex s `/s` přeskočil přes newline a chytil
    // se `AISHA_WIPE_CONFIRM_TIMEOUT_S` až v chybové hlášce — mutace s pevně
    // zadaným deadlinem tak prošla. Vzdálenost mezi dvěma shodami je taky nález.
    // ⛔ TVAR ZMĚNĚN 2026-08-26, TVRZENÍ ZPŘÍSNĚNO. Do té doby se lhůta počítala
    // JEDNOU na začátku a měřila CELÉ mazání. Coolify ale maže SÉRIOVĚ
    // (`DeleteResourceJob`, 30 s–1 m 35 s na aplikaci), takže 33 aplikací trvá
    // ~25 minut a strop 300 s utnul frontu, která pracovala správně.
    // Nově se měří STÁNÍ: lhůta se RESETUJE při každém úbytku. Test proto
    // pinuje obojí — vznik lhůty z hodin i konfigurace, A její reset na pokrok.
    // Hodnota smí téct přes proměnnou, ale ta proměnná musí být z konfigurace.
    expect(
      fn,
      "konfigurovaná hodnota musí do lhůty vstoupit (jinak je to magické číslo)",
    ).toMatch(/^\s*local _stall_s="\$\{AISHA_WIPE_CONFIRM_TIMEOUT_S/m);
    expect(
      fn,
      "lhůta se musí spočítat z AKTUÁLNÍHO ČASU + té konfigurované hodnoty, ne z pevné",
    ).toMatch(/^\s*local _wipe_deadline=\$\(\(\s*_wipe_started\s*\+\s*_stall_s\s*\)\)/m);
    expect(
      fn,
      "_wipe_started musí být hodiny, ne konstanta",
    ).toMatch(/^\s*local _wipe_started=\$\(date \+%s\)/m);
    // Bez tohohle by „stání" byla jen přejmenovaná lhůta na celkový čas.
    expect(
      fn,
      "lhůta se MUSÍ resetovat, když zbývajících ubylo — jinak se měří hodiny, ne stání",
    ).toMatch(/_wipe_deadline=\$\(\(\s*\$\(date \+%s\)\s*\+\s*_stall_s\s*\)\)/);
    expect(
      fn,
      "…a reset se smí spustit JEN při skutečném úbytku",
    ).toMatch(/"\$remaining"\s*-lt\s*"\$_last_remaining"/);
    expect(
      fn,
      "…a ve smyčce se musí s hodinami POROVNÁVAT, jinak je to jen nepoužitá proměnná",
    ).toMatch(/\[\s*"\$\(date \+%s\)"\s*-ge\s*"\$_wipe_deadline"\s*\]/);
    expect(
      fn,
      "po vypršení lhůty se musí odmítnout, ne pokračovat",
    ).toMatch(/return 1/);
  });

  test("lhůta má domov v konfiguraci a ten domov je vyplněný", () => {
    // Deklarace, kterou nikdo neplní, je ozdoba — a hodnota bez domova je
    // magické číslo. Musí platit obojí.
    expect(
      timeouts,
      "AISHA_WIPE_CONFIRM_TIMEOUT_S musí být deklarován v config/cold-start-timeouts.env",
    ).toMatch(/^AISHA_WIPE_CONFIRM_TIMEOUT_S=\d+/m);
    expect(
      fn,
      "…a cold-start ho musí skutečně číst",
    ).toMatch(/AISHA_WIPE_CONFIRM_TIMEOUT_S/);
  });

  test("hláška po vypršení jmenuje PŘÍČINU, ne jen počet", () => {
    // „still present" poslalo operátora hledat aplikaci. Příčina ale leží
    // v řídicí rovině Coolify a musí být v hlášce, včetně toho, čím ji změřit.
    expect(fn).toMatch(/zůstává:/);
    expect(fn, "musí odlišit zmizelý kontejner od nezmizelého ZÁZNAMU").toMatch(/ZÁZNAM/);
    expect(fn, "a dát měřitelnou stopu k příčině").toMatch(/memory size/);
  });

  test("výsledek destroy se KONZUMUJE — nedokončené mazání zastaví běh", () => {
    expect(
      cold,
      "wipe_orphan_apps se nesmí volat naprázdno: nad zpola smazanou platformou se nesmí stavět",
    ).toMatch(/wipe_orphan_apps\s*\|\|\s*exit\s+1/);
  });
});

describe("pre-wipe safety: the vault backup fails closed", () => {
  const fn = shellFn(cold, "backup_vault_age_to_instance_data");

  test("backup_vault_age_to_instance_data exists", () => {
    expect(fn.length).toBeGreaterThan(0);
  });

  test("a dry run does not write snapshots or push", () => {
    const before = shellFn(cold, "backup_vault_before_wipe");
    expect(before).toMatch(/if\s+\[\s+"\$DRY_RUN"\s+=\s+"1"\s+\]/);
  });

  test("every off-machine failure REFUSES — no 'kept LOCAL' success path", () => {
    // The old code degraded to a local-only copy on: URL unset, clone failure and
    // push failure, returning 0 each time. None of those may return success again.
    expect(fn).not.toMatch(/kept LOCAL/i);
    const returnsZero = [...fn.matchAll(/return 0/g)].length;
    // Exactly one success exit: the very end, after the remote round-trip verified.
    expect(returnsZero, "the only `return 0` must be the fully-verified success path").toBe(1);
  });

  test("the encrypted snapshot is round-trip verified before the destroy", () => {
    // Encrypting proves nothing: `age -r` accepts any well-formed age1… string, so a
    // typo'd or rotated recipient produces ciphertext nobody can open.
    expect(fn).toMatch(/age\s+-d\s+-i/);
    expect(fn).toMatch(/AISHA_VAULT_BACKUP_AGE_KEY_FILE/);
  });

  test("the REMOTE copy is re-fetched and decrypted — a push is not proof", () => {
    const decrypts = [...fn.matchAll(/age\s+-d\s+-i/g)].length;
    expect(decrypts, "expect two round-trips: local ciphertext, then the re-fetched remote one")
      .toBeGreaterThanOrEqual(2);
  });

  test("the local snapshot is re-read and asserted non-trivial", () => {
    const before = shellFn(cold, "backup_vault_before_wipe");
    expect(before).toMatch(/tar\s+-tzf/);
    expect(before).toMatch(/\.env-prod-backup/);
    expect(before).toMatch(/\.env\.coolify/);
  });

  test("instance-data URL is parsed through the shared lib (the #ref fragment)", () => {
    expect(existsSync(URL_LIB)).toBe(true);
    expect(cold).toMatch(/lib\/instance-data-url\.sh/);
    // The raw `git clone "$AISHA_INSTANCE_DATA_GIT_URL"` form is what broke: git
    // splices the `#main` fragment into the request path.
    expect(fn).not.toMatch(/git clone[^\n]*AISHA_INSTANCE_DATA_GIT_URL/);
  });

  test("age is declared a prerequisite", () => {
    expect(cold.slice(0, 2000)).toMatch(/#\s+-\s+age\b/);
  });
});

describe("pre-wipe safety: the placeholder scan fails closed", () => {
  test("a broken git REFUSES instead of degrading to standards-only", () => {
    expect(scan).toMatch(/status:\s*"broken"/);
    expect(scan).toMatch(/throw new Error\([^)]*corpus unavailable/);
  });

  test("the legitimate degradation is still allowed, but loudly", () => {
    // No git binary at all, or a tree with no git metadata (tarball export), may
    // continue with standards patterns — that is not the same as git erroring.
    expect(scan).toMatch(/"no-git"/);
    expect(scan).toMatch(/"no-metadata"/);
    expect(scan).toMatch(/PARTIAL/);
  });

  test("the corpus is read relative to the repo, not the caller's cwd", () => {
    // Before: `existsSync(rel)` + `git ls-files` with no cwd — from another
    // directory the harvest silently yielded 0 tokens with no warning at all.
    expect(scan).toMatch(/const ROOT = resolve\(/);
    expect(scan).toMatch(/cwd:\s*ROOT/);
  });

  test("filler orgs are matched as domain LABELS, not bare words", () => {
    // `acme` is also the Let's Encrypt protocol (ACME_EMAIL, the letsencrypt acme
    // resolver, acme-staging-v02.api.letsencrypt.org). A bare \bacme\b would flag
    // live TLS config; the label form catches mesh.acme.internal and leaves the
    // protocol alone.
    expect(scan).toMatch(/\(\^\|\\\.\)\(acme\|/);
  });
});
