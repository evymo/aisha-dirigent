/**
 * Gate test: cold-start-dry-run-safety
 *
 * Locks the invariant that `bash scripts/aisha-cold-start.sh --dry-run`
 * NEVER performs destructive operations. Specifically:
 *
 *   - The destructive Coolify DELETE MUST be gated by `if [ "$DRY_RUN" = "1" ]`
 *     so dry-run only PRINTS what would be deleted and skips the actual
 *     DELETE requests to Coolify.
 *
 * Background: 2026-05-26 incident — `aisha-cold-start.sh --wipe --dry-run`
 * actually wiped 15/16 Coolify apps. The wipe code checked `$WIPE` but not
 * `$DRY_RUN`. This gate ensures the regression cannot sneak back in.
 *
 * Structure note (validate-before-destroy refactor): the destroy is no longer
 * inline in the Step 1 `if [ "$WIPE" = "1" ]` block. That block now only
 * AUTHORISES the wipe (sets WIPE_PENDING) and the actual DELETE lives in the
 * `wipe_orphan_apps()` function, invoked from Step 2c only after generate +
 * validate succeed. The DRY_RUN guard therefore lives inside wipe_orphan_apps:
 * it prints `[DRY RUN]` and `return`s BEFORE any `coolify_api DELETE`. This gate
 * asserts the same "dry-run never deletes" invariant against that structure.
 *
 * Run via: `npm run test:gates`
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/aisha-cold-start.sh');

describe('cold-start-dry-run-safety — destructive wipe must respect DRY_RUN flag', () => {
  const content = readFileSync(SCRIPT, 'utf8');

  it('script declares --dry-run flag and DRY_RUN variable', () => {
    expect(content, 'aisha-cold-start.sh must accept --dry-run').toMatch(/--dry-run\)/);
    expect(content, 'aisha-cold-start.sh must declare DRY_RUN variable').toMatch(/DRY_RUN=/);
  });

  it('wipe_orphan_apps guards DRY_RUN: prints [DRY RUN] and returns BEFORE any DELETE', () => {
    // The destroy lives in wipe_orphan_apps(); isolate its body (def → the
    // EXISTING_JSON= line that immediately follows the function).
    const fnStart = content.indexOf('wipe_orphan_apps() {');
    expect(fnStart, 'wipe_orphan_apps() function not found').toBeGreaterThan(-1);
    const after = content.indexOf('EXISTING_JSON=', fnStart);
    const fn = content.slice(fnStart, after > fnStart ? after : fnStart + 6000);

    const dryRunCheckIdx = fn.search(/if\s+\[\s+"\$DRY_RUN"\s+=\s+"1"\s+\]/);
    expect(dryRunCheckIdx, 'wipe_orphan_apps must check DRY_RUN before destructive DELETE').toBeGreaterThan(-1);

    // dry-run branch announces itself …
    expect(fn, 'dry-run branch must announce itself via `[DRY RUN]` log line').toMatch(/\[DRY RUN\]/);

    // … and RETURNS before any DELETE (the dry-run path performs no destroy).
    const dryReturnIdx = fn.indexOf('return 0', dryRunCheckIdx);
    const deleteIdx = fn.indexOf('coolify_api DELETE');
    expect(deleteIdx, 'wipe_orphan_apps must contain the destructive DELETE').toBeGreaterThan(-1);
    expect(dryReturnIdx, 'dry-run branch must `return 0`').toBeGreaterThan(-1);
    expect(
      dryReturnIdx,
      'the DRY_RUN branch must `return` BEFORE the DELETE — dry-run performs no destroy',
    ).toBeLessThan(deleteIdx);
    expect(
      deleteIdx,
      'coolify_api DELETE must come AFTER the DRY_RUN guard',
    ).toBeGreaterThan(dryRunCheckIdx);
  });

  it('Step 1 wipe authorization defers the destroy — no inline DELETE; only wipe_orphan_apps deletes', () => {
    // The Step 1 `if [ "$WIPE" = "1" ]` block must only AUTHORISE the wipe
    // (set WIPE_PENDING) and must NOT call coolify_api DELETE inline — the
    // destroy is deferred to Step 2c (after validate). This keeps the single
    // DELETE path behind the DRY_RUN guard verified above.
    // ⛔ KOTVA NA VLASTNOST, NE NA PRVNÍ VÝSKYT (naměřeno 2026-08-19).
    //
    // Dřív se kotvilo prostým `indexOf('if [ "$WIPE" = "1" ]')`. To fungovalo,
    // dokud byl ten řetězec v souboru jediný. Rewarmup (krok 2d) přidal DŘÍVĚJŠÍ
    // výskyt — guard proti kombinaci `--rewarmup` s `--wipe` — a brána od té
    // chvíle měřila úplně jinou oblast:
    //
    //     kotva na první výskyt (ř. 189)   → výřez 1360 řádků → DELETE: ANO
    //     skutečný wipe blok    (ř. 1483)  → výřez   66 řádků → DELETE: NE
    //
    // Nález byl falešný: `coolify_api DELETE` leželo o tisíc řádků dál, mimo
    // jakýkoli wipe blok. Brána tvrdila o kódu něco, co se týkalo cizího místa.
    //
    // Autorizační blok se pozná podle toho, CO DĚLÁ — nastavuje `WIPE_PENDING=1`.
    // Kotví se proto zpětně od něj; přidání dalšího `if [ "$WIPE" = "1" ]`
    // kamkoli jinam v souboru už měření neposune.
    const wipePendingAt = content.indexOf('WIPE_PENDING=1');
    expect(wipePendingAt, 'WIPE_PENDING=1 v souboru není — wipe blok nejde najít').toBeGreaterThan(-1);
    const wipeBlockStart = content.lastIndexOf('if [ "$WIPE" = "1" ]', wipePendingAt);
    expect(wipeBlockStart, 'wipe authorization block not found').toBeGreaterThan(-1);
    const step2 = content.indexOf('step "2. GENERATE FRESH SECRETS');
    const wipeBlock = content.slice(wipeBlockStart, step2 > wipeBlockStart ? step2 : wipeBlockStart + 4000);

    expect(wipeBlock, 'wipe block must authorise via WIPE_PENDING (deferred destroy)').toContain('WIPE_PENDING=1');
    expect(
      wipeBlock,
      'Step 1 wipe block must NOT delete inline (destroy is deferred to wipe_orphan_apps)',
    ).not.toMatch(/coolify_api DELETE/);

    // UPŘESNĚNO 2026-08-11. Dřív tu stálo „přesně jedno DELETE v celém skriptu".
    // To pravidlo měřilo POČET, ne nebezpečnost — a spadlo na úklidu warmup
    // aplikací, který nemaže žádná data (warmup nemá volumes, jen doběhne a
    // uvolní docker.sock). Nebezpečná není každá DELETE, ale ta, která PURGUJE
    // VOLUMES nájemníka.
    //
    // Chráněná vlastnost tedy je: destruktivní purge existuje PRÁVĚ JEDNA a
    // každé DELETE je za DRY_RUN strážcem.
    const purges = content.match(/coolify_api DELETE "\/applications\/\$\{uuid\}\$\{delete_qs\}"/g) || [];
    expect(purges.length, 'právě jedna DESTRUKTIVNÍ purge (delete_volumes) v orchestrátoru').toBe(1);

    // Úklid warmupu smí být druhou DELETE cestou, ale musí mít vlastní DRY_RUN
    // strážce — jinak by `--dry-run` mazal aplikace.
    const warmupIdx = content.indexOf('remove_warmup_apps() {');
    if (warmupIdx > -1) {
      const konec = content.indexOf('\n}', warmupIdx);
      const telo = content.slice(warmupIdx, konec > warmupIdx ? konec : warmupIdx + 4000);
      expect(telo, 'úklid warmupu musí respektovat DRY_RUN').toMatch(/DRY_RUN/);
      expect(
        telo.indexOf('DRY_RUN'),
        'DRY_RUN strážce musí předcházet DELETE, ne následovat po něm',
      ).toBeLessThan(telo.indexOf('coolify_api DELETE'));
    }
  });

  it('script supports composite `--wipe --dry-run` invocation order', () => {
    // Make sure both flags are independently parsed and either order works.
    expect(content).toMatch(/--wipe\)\s+WIPE=1/);
    expect(content).toMatch(/--dry-run\)\s+DRY_RUN=1/);
  });
});
