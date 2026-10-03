/**
 * Brána: cold-start nic tiše NEPŘESKAKUJE — co nejde, zapíše, doběhne, a přizná to.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (audit cesty `aisha-cold-start.sh --skip-create` nad guru,
 * 21 aplikací bez jediného kontejneru). Dvě opačné vady téže třídy:
 *   · ZASTAVENÍ, KTERÉ PŘESKOČÍ ZBYTEK: selhané nasazení MĚKKÉ aplikace vracelo
 *     z redeploye 1, fáze E skončila `exit 1` a sama napsala „Step 6 (n8n
 *     workflows) se PŘESKAKUJE". Model bez vah nebo extranet bez overlaye tak
 *     zrušily n8n, smoke test, embed kickstart, úklid warmupu i restart validaci.
 *   · TICHÉ PROJITÍ: aplikace chybějící v Coolify zmizela z vln beze slova,
 *     zapnutá opt-in lane se četla z `false` jako zapnuto, výsledek init kontejneru
 *     n8n nikdo nečetl, credentials se nezakládaly, `jq … || echo 0` četlo HTML jako
 *     „nic nezbývá", a konec běhu hlásil „Cold-start sequence complete".
 *
 * CO SE MĚŘÍ (bez podprocesů; chování knihoven měří jejich *.test.mjs):
 *   1. cold-start si nezapíná `set -e` (tichý konec na první nenule);
 *   2. od kroku 5c do souhrnu se nekončí kvůli nedokončenému kroku — jediná
 *      výjimka je konfigurační vada (manifest nenasazuje n8n);
 *   3. fáze E zapíše nedokončené a pokračuje; souhrn NEDOKONCENO vypíše, skončí
 *      nenulou a banner úspěchu je až za tím; závěr měří cold-start-verify;
 *      banner úspěchu je dosažitelný JEN tam, kde verify běžel (--dry-run
 *      a --skip-deploy končí vlastní pravdivou větou, kód 0);
 *   4. redeploy: měkkost je vlastnost APLIKACE (deploy i trigger), chybějící
 *      aplikace z manifestu se počítá, vypnutá lane se nenasazuje, POST bez
 *      `deployment_uuid` je selhání;
 *   5. „zapnuto?" má jeden domov (lib/provision-gate.mjs);
 *   6. n8n: credentials PŘED workflowy, verdikt přes audit, krok 6 ho čte;
 *   7. deploy-init: seznam aplikací fail-closed, stacky z manifestu, kód 3.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const bezKomentaru = (sh: string) =>
  sh
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

const COLD_START = cti("scripts/aisha-cold-start.sh");
const REDEPLOY = cti("scripts/aisha-redeploy.mjs");

/** Konce běhu (`exit 1`) mezi krokem 5c a souhrnem, kromě konfigurační výjimky. */
function zastaveniPoKroku5c(sh: string): string[] {
  const kod = bezKomentaru(sh);
  const od = kod.indexOf('step "5c.');
  const po = kod.indexOf('step "7. SUMMARY"');
  if (od < 0 || po < 0) return ["kroky 5c/7 nenalezeny — měřidlo přestalo sedět"];
  const radky = kod.slice(od, po).split("\n");
  const nalezy: string[] = [];
  radky.forEach((r, i) => {
    if (!/^\s*exit\s+1\b/.test(r)) return;
    const okoli = radky.slice(Math.max(0, i - 4), i).join("\n");
    if (/nenasazuje docker-compose\.coolify-n8n\.yml/.test(okoli)) return; // konfigurační vada, ne nedokončený krok
    nalezy.push(okoli.trim().split("\n").pop() ?? r);
  });
  return nalezy;
}

/**
 * Je banner úspěchu dosažitelný v běhu, který závěrečné ověření vynechal?
 *
 * ⛔ NAMĚŘENO 2026-09-13: `--dry-run` končil „Cold-start dokončen — … závěrečné ověření
 * prošlo", přestože cold-start-verify běží jen pod `if [ "$SKIP_DEPLOY" != "1" ] &&
 * [ "$DRY_RUN" != "1" ]`. Přepínače se neopisují do brány — čtou se z TÉ podmínky,
 * pod kterou se verify volá. Přibude-li další přepínač, který verify vynechá, brána
 * bude chtít i jeho vlastní konec. Vrací nálezy (prázdné = v pořádku).
 */
function bannerBezOvereni(souhrn: string): string[] {
  const iVerify = souhrn.indexOf("node scripts/cold-start-verify.mjs");
  const iBanner = souhrn.indexOf("Cold-start dokončen");
  if (iVerify < 0 || iBanner < 0) return ["volání cold-start-verify nebo banner úspěchu nenalezen — měřidlo přestalo sedět"];
  const straze = [...souhrn.slice(0, iVerify).matchAll(/^\s*if ((?:\[ "\$[A-Z_]+" != "1" \](?: && )?)+); then\s*$/gm)];
  const straz = straze[straze.length - 1];
  if (!straz) return ["cold-start-verify nemá nad sebou podmínku přepínačů — měřidlo přestalo sedět"];
  const prepinace = [...straz[1].matchAll(/\$([A-Z_]+)"/g)].map((m) => m[1]);
  const mezi = souhrn.slice(iVerify, iBanner);
  const nalezy: string[] = [];
  for (const p of prepinace) {
    const bloky = [...mezi.matchAll(new RegExp(`^if \\[ "\\$${p}" = "1" \\]; then\\n([\\s\\S]*?)^fi$`, "gm"))];
    const konci = bloky.some((b) => /^\s*exit 0\s*$/m.test(b[1]) && !/dokončen|prošlo/.test(b[1]));
    if (!konci) nalezy.push(`${p}: banner úspěchu je dosažitelný, ač cold-start-verify neběžel`);
  }
  return nalezy;
}

describe("cold-start nic nepřeskakuje (brána)", () => {
  test("1. žádné `set -e` — skript běží bez něj a zapnout ho znamená tichý konec", () => {
    expect(bezKomentaru(COLD_START)).not.toMatch(/^\s*set -e\s*$/m);
  });

  test("2. od kroku 5c se nekončí kvůli nedokončenému kroku", () => {
    expect(
      zastaveniPoKroku5c(COLD_START),
      "po kroku 5c stojí `exit 1` — přeskočí všechno, co je za ním (n8n, embed, úklid, restart validace).\n" +
        "Zapiš to přes `nedokonceno` a nech běh doběhnout; skončí nenulou v souhrnu.",
    ).toEqual([]);
  });

  test("2b. sonda jde rozsvítit — původní tvar kroku 6 by chytila", () => {
    const stary = [
      'step "5c. PROVISION SURFACES"',
      '  err "n8n not ready after 5 min — cold-start cannot verify workflows"',
      "  exit 1",
      'step "7. SUMMARY"',
    ].join("\n");
    expect(zastaveniPoKroku5c(stary)).toHaveLength(1);
  });

  test("3. fáze E zapíše a pokračuje; souhrn přizná NEDOKONCENO a měří konec", () => {
    const kod = bezKomentaru(COLD_START);
    const e = kod.slice(kod.indexOf("_phase_e_rc=0"), kod.indexOf("Phase F"));
    expect(e, "fáze E nechytá kód redeploye").toMatch(/\|\| _phase_e_rc=\$\?/);
    expect(e).toMatch(/nedokonceno "Fáze E/);
    expect(/\bexit\s+1\b/.test(e), "fáze E nesmí zastavit běh").toBe(false);

    const souhrn = kod.slice(kod.indexOf('step "7. SUMMARY"'));
    expect(souhrn).toMatch(/node scripts\/cold-start-verify\.mjs/);
    expect(souhrn.indexOf('"${#NEDOKONCENO[@]}" -gt 0')).toBeGreaterThan(-1);
    expect(souhrn.indexOf("exit 1")).toBeLessThan(souhrn.indexOf("Cold-start dokončen"));
    expect(kod, "starý banner úspěchu bez rozhodnutí se vrátil").not.toContain("Cold-start sequence complete.");
    expect(
      bannerBezOvereni(souhrn),
      "banner úspěchu tvrdí „závěrečné ověření prošlo“ — smí vyjít jen v běhu, kde cold-start-verify běžel.\n" +
        "Každý přepínač, který verify vynechává, musí před bannerem skončit vlastní pravdivou větou (exit 0).",
    ).toEqual([]);
  });

  test("3b. sonda banneru jde rozsvítit — souhrn do 2026-09-13 (dry-run hlásil úspěch) by chytila", () => {
    const stary = [
      'step "7. SUMMARY"',
      'if [ "$SKIP_DEPLOY" != "1" ] && [ "$DRY_RUN" != "1" ]; then',
      '  info "Závěrečné ověření: scripts/cold-start-verify.mjs (read-only)..."',
      '  if (cd "$REPO_ROOT" && node scripts/cold-start-verify.mjs </dev/null); then',
      '    ok "cold-start-verify: nasazený stav odpovídá manifestu instance"',
      "  fi",
      "fi",
      'if [ "${#NEDOKONCENO[@]}" -gt 0 ]; then',
      "  exit 1",
      "fi",
      'ok "Cold-start dokončen — všechny kroky proběhly a závěrečné ověření prošlo."',
    ].join("\n");
    expect(bannerBezOvereni(stary).sort()).toEqual([
      "DRY_RUN: banner úspěchu je dosažitelný, ač cold-start-verify neběžel",
      "SKIP_DEPLOY: banner úspěchu je dosažitelný, ač cold-start-verify neběžel",
    ]);
    // …a tvar, který „ukončí" jen JEDEN z přepínačů, taky neprojde.
    const pulka = stary.replace(
      'ok "Cold-start dokončen',
      'if [ "$DRY_RUN" = "1" ]; then\n  warn "DRY RUN — nic nenasazeno, nic neověřeno"\n  exit 0\nfi\nok "Cold-start dokončen',
    );
    expect(bannerBezOvereni(pulka)).toEqual(["SKIP_DEPLOY: banner úspěchu je dosažitelný, ač cold-start-verify neběžel"]);
  });

  test("4. redeploy: měkkost podle aplikace, chybějící a vypnuté aplikace, deployment_uuid", () => {
    expect(REDEPLOY).toMatch(/summary\.deploy_failed\.some\(\(f\) => !mekka\(f\.name\)\)/);
    expect(REDEPLOY).toMatch(/summary\.failed_trigger\.some\(\(n\) => !mekka\(n\)\)/);
    expect(REDEPLOY).toMatch(/\[\.\.\.CHYBI_V_COOLIFY\]\.some\(\(n\) => !mekka\(n\)\)/);
    expect(REDEPLOY, "přijaté stavy mimo bootstrap okno nesmí vracet nulu").toMatch(/summary\.prijate\.filter\(\(u\) => !ocekavaneVOkne\(u\)\)/);
    expect(REDEPLOY, "vypnutá lane se nenasazuje").toMatch(/apps\.has\(n\) && !vypnute\.has\(n\)/);
    expect(REDEPLOY).toMatch(/if \(!d\) return \{ ok: false, error: "POST \/deploy bez deployment_uuid/);
  });

  test("5. „zapnuto?\" má jeden domov — žádné vlastní vyhodnocení provision_when_env", () => {
    const derive = cti("scripts/lib/derive-domains.mjs");
    const appVars = cti("scripts/lib/coolify-app-vars.sh");
    const storyInit = cti("scripts/coolify-story-init.sh");
    const vlastni = (t: string) =>
      /(provision_when_env|public_when_env)[\s\S]{0,260}?\.some\(\(k\) =>[^)]*process\.env/.test(t) ||
      /provision_when_env\s*\/\/\s*empty[\s\S]{0,200}\$\{!v:-\}/.test(t) ||
      /s\.provision_when_env[\s\S]{0,200}armed/.test(t);
    for (const [jmeno, text] of [["derive-domains.mjs", derive], ["coolify-app-vars.sh", appVars], ["coolify-story-init.sh", storyInit]] as const) {
      expect(vlastni(text), `${jmeno} vyhodnocuje provision_when_env sám — patří do lib/provision-gate.mjs`).toBe(false);
    }
    expect(derive).toMatch(/from "\.\/provision-gate\.mjs"/);
    expect(appVars).toMatch(/provision-gate\.mjs" --neprovisionovane/);
    expect(storyInit).toMatch(/provision-gate\.mjs" --zapnuto "\$role"/);
    // negativní vzorek: tvar, který tu stál do 2026-09-13
    expect(vlastni('const gateVars = svc.provision_when_env ? [svc.provision_when_env] : [];\nif (gateVars.length && !gateVars.some((k) => process.env[k])) continue;')).toBe(true);
  });

  test("6. n8n: credentials před workflowy, verdikt přes audit, krok 6 ho čte", () => {
    // Měří se VOLÁNÍ (`node "${APP_DIR}/…"`), ne zmínka — hlavička souboru obě
    // jména jmenuje v prose a první verze téhle sondy měřila komentář.
    const entry = bezKomentaru(cti("scripts/n8n-deploy-entrypoint.sh"));
    const iCred = entry.indexOf('node "${APP_DIR}/scripts/n8n/provision-credentials.mjs"');
    const iWf = entry.indexOf('node "${APP_DIR}/scripts/deploy-workflows.mjs"');
    const iVerdikt = entry.indexOf('node "${APP_DIR}/scripts/n8n/bootstrap-verdikt.mjs"');
    expect(iWf, "init nenahrává workflowy").toBeGreaterThan(-1);
    expect(iCred, "init nezakládá credentials").toBeGreaterThan(-1);
    expect(iCred, "credentials musí vzniknout DŘÍV než workflowy (mapují se jménem)").toBeLessThan(iWf);
    expect(iVerdikt, "init nezapisuje verdikt").toBeGreaterThan(iWf);
    expect(cti("docker-compose.coolify-n8n.yml")).toMatch(/n8n-workflow-init:[\s\S]*?POSTGREST_SERVICE_TOKEN=/);
    expect(COLD_START).toMatch(/integration_service_logs\?[^"]*action=eq\.bootstrap[^"]*created_at=gte\.\$\{COLD_START_KROK5_T0\}/);
  });

  test("7. deploy-init: seznam aplikací fail-closed, stacky z manifestu, kód 3 a cold-start ho čte", () => {
    const di = cti("scripts/coolify-deploy-init.sh");
    expect(di, "výpadek seznamu aplikací se nesmí převléknout za prázdný projekt").not.toMatch(/coolify_list_apps[^\n]*\|\| echo '\[\]'/);
    expect(di).toMatch(/for _di_s in "\$\{APP_NAMES\[@\]\}"; do/);
    expect(di).toMatch(/DI_NEDOKONCENO\+=\("\$stack"\)/);
    expect(bezKomentaru(di)).toMatch(/exit 3/);
    expect(COLD_START).toMatch(/if \[ "\$_deploy_init_rc" = "3" \]; then\s*\n[\s\S]{0,200}nedokonceno "Krok 4/);
  });
});
