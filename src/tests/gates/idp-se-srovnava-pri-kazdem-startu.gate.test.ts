/**
 * Brána: poskytovatelé identity se srovnávají při KAŽDÉM startu (CLASS gate)
 *
 * TŘÍDA VADY: `--import-realm` se chytí jen na PRÁZDNÝ realm, takže šablona
 * realmu doletí ke konzumentovi jednou. Šablona veze oba sociální poskytovatele
 * (`apple`, `google`) VYPNUTÉ s odkazem `${OAUTH_*_CLIENT_ID/SECRET}` — zapnout
 * se mají podle prostředí. Když to udělá jen cesta, kterou spouští operátor
 * (cold start, `instance-rollout`, env-doktor), pak po obnově realmu stav
 * NEDOŽENE deklaraci a nikdo to nezměří.
 *
 * ⛔ NAMĚŘENO 2026-09-20 na jedné instanci forku: přihlašovací stránka nabízela
 * jen Apple. Google měl v Coolify env appky `keycloak` vyplněný clientId
 * i secret, v realmu ale `enabled=false` — od 17. 9., kdy se po ztrátě svazků
 * realm naimportoval ze šablony. Smír po startu tehdy srovnával POUZE klienty.
 * Apple byl zapnutý rukou, takže rozdíl nešlo poznat od „tak to má být".
 *
 * INVARIANT (tři půlky téže věty):
 *   1. smír po startu (`keycloak/reconcile-realm-clients.sh`) srovnává i
 *      `identity-provider/instances`, ne jen klienty;
 *   2. kontejner, který ten smír pouští, dostává pověření poskytovatelů
 *      z prostředí — jinak by srovnával proti prázdnu a poskytovatele VYPNUL;
 *   3. secret nejde do `kcadm` přes argv (`ps` v kontejneru by ho vydal) —
 *      jen stdinem (`-f -`).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SMIR = join(ROOT, "keycloak/reconcile-realm-clients.sh");
const COMPOSE = join(ROOT, "docker-compose.coolify-keycloak.yml");
const read = (p: string) => readFileSync(p, "utf8");
const bezKomentaru = (src: string) => src.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

describe("poskytovatelé identity se srovnávají při každém startu", () => {
  test("smír po startu sahá na identity-provider/instances, ne jen na klienty", () => {
    const src = read(SMIR);
    expect(
      /identity-provider\/instances/.test(src),
      "Smír po startu srovnává jen klienty.\n" +
        "Šablona veze poskytovatele vypnuté a zapínají se podle prostředí, takže po\n" +
        "obnově realmu (import se chytí jen na prázdný) zůstanou vypnutí navždy.\n" +
        "Náprava: srovnat je v témže skriptu, kterým projde každý start.",
    ).toBe(true);
    for (const alias of ["apple", "google"]) {
      expect(new RegExp(alias).test(src), `smír nezná poskytovatele ${alias}`).toBe(true);
    }
  });

  test("kontejner smíru dostává pověření poskytovatelů z prostředí", () => {
    const compose = read(COMPOSE);
    const idx = compose.indexOf("reconcile-realm-clients.sh");
    expect(idx, "služba se smírem v compose není").toBeGreaterThan(0);
    const blok = compose.slice(idx);
    const chybi = ["OAUTH_APPLE_CLIENT_ID", "OAUTH_APPLE_CLIENT_SECRET", "OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"]
      .filter((k) => !new RegExp(`${k}:`).test(blok));
    expect(
      chybi,
      "Smír pověření poskytovatelů nevidí — srovnával by proti prázdnu a živého\n" +
        "poskytovatele by VYPNUL (nebo by ho nikdy nezapnul).",
    ).toEqual([]);
  });

  test("secret poskytovatele nejde do kcadm přes argv", () => {
    const src = read(SMIR);
    expect(
      /-s\s+["']?config\.clientSecret=/.test(src),
      "Secret jde do kcadm jako argument — `ps` uvnitř kontejneru ho vydá komukoliv.\n" +
        "Náprava: poslat reprezentaci stdinem (`-f -`).",
    ).toBe(false);
    expect(
      /-f\s+-/.test(src),
      "Smír neposílá reprezentaci stdinem; secret by musel jít argv nebo souborem.",
    ).toBe(true);
  });

  /**
   * ⛔ NAMĚŘENO 2026-09-25 na dočasném Keycloaku 26.0.8 (verze z Dockerfile.keycloak):
   * `kcadm update … -f -` se `--file` ve výchozím stavu NESLUČUJE s GET („Merge is
   * automatically enabled unless --file is specified"). Částečný dokument smíru
   * `{"enabled","config":{clientId,clientSecret,defaultScope}}` pak jde jako celý PUT
   * a KC ho odmítne: „Invalid identity provider id [null]" — smír padal při KAŽDÉM
   * startu instance, která poskytovatele v realmu už má (e2e se skutečným skriptem).
   * S `-m` se sloučí do hloubky: klíče configu navíc přežijí (Apple teamId/keyId/p8Key,
   * Google guiOrder/prompt/hostedDomain), secret se zapíše (nalezen v H2). Negativní
   * kontrola `--no-merge`: PUT nahradí CELÝ config (klíče navíc zmizí).
   */
  test("update poskytovatele z dokumentu (-f -) slučuje s GET (-m), jinak ho KC odmítne", () => {
    const radky = bezKomentaru(read(SMIR)).split("\n")
      .filter((r) => /\bupdate\b/.test(r) && /identity-provider\/instances/.test(r) && /-f\s+-/.test(r));
    expect(radky.length, "smír nemá update poskytovatele z dokumentu — test by nic neměřil").toBeGreaterThan(0);
    const bezSlouceni = radky.filter((r) => !/\s(-m|--merge)\s/.test(r) || /--no-merge/.test(r));
    expect(
      bezSlouceni,
      "kcadm update se --file BEZ -m neslučuje: částečný dokument jde jako celý PUT.\n" +
        "Keycloak 26.0.8 ho odmítne („Invalid identity provider id [null]\"), s --no-merge\n" +
        "by PUT nahradil celý config (Apple by přišel o teamId/keyId/klíč). Náprava: `-m`.",
    ).toEqual([]);
  });
});

/**
 * CHYBA NÁSTROJE ≠ DATA. `idp_stav` smí vrátit „poskytovatel v realmu není" JEN na 404
 * (kcadm 26.0.8: „Resource not found for url: …", rc 1). Vypršený token, 5xx nebo síť by
 * se jinak tvářily jako chybějící poskytovatel — bez pověření tiché „přeskočen",
 * s pověřením pád na `create` se zavádějící hláškou. Texty chyb naměřené tamtéž.
 * Funkce se spouští PŘÍMO ze skriptu smíru proti falešnému kcadm.
 */
describe("stav poskytovatele: jen 404 znamená „není“", () => {
  const src = read(SMIR);
  const funkce = src.match(/^idp_stav\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];

  // Všechny scénáře v JEDNOM podprocesu (lehká dráha): falešný kcadm na scénář.
  const SCENARE: Record<string, { stdout: string; stderr: string; rc: number }> = {
    ok: { stdout: '{"alias":"google","config":{"clientId":"c"}}', stderr: "", rc: 0 },
    nf: { stdout: "", stderr: "Resource not found for url: http://kc/admin/realms/r/identity-provider/instances/google", rc: 1 },
    e401: { stdout: "", stderr: "Invalid user credentials [invalid_grant]", rc: 1 },
    e500: { stdout: "", stderr: "HTTP error - 500, Internal Server Error", rc: 1 },
    sit: { stdout: "", stderr: "Failed to send request - Connect to kc:8080 failed: Connection refused", rc: 1 },
  };
  const vysledky = (() => {
    const d = mkdtempSync(join(tmpdir(), "idp-stav-"));
    for (const [k, v] of Object.entries(SCENARE)) {
      const kcadm = join(d, `kcadm-${k}`);
      writeFileSync(kcadm, `#!/bin/sh\nprintf '%s' '${v.stdout}'\n[ -n '${v.stderr}' ] && printf '%s\\n' '${v.stderr}' >&2\nexit ${v.rc}\n`);
      chmodSync(kcadm, 0o755);
    }
    writeFileSync(join(d, "h.sh"), [
      'umri() { echo "[realm-sync] CHYBA: $*" >&2; exit 1; }',
      "REALM=r",
      funkce ?? "",
      `for k in ${Object.keys(SCENARE).join(" ")}; do`,
      `  KCADM="${d}/kcadm-$k"`,
      `  ( X="$(idp_stav google)" || exit 7; printf '%s' "$X" ) >"${d}/$k.out" 2>"${d}/$k.err"; echo $? >"${d}/$k.rc"`,
      "done",
    ].join("\n"));
    spawnSync("sh", [join(d, "h.sh")], { encoding: "utf8" });
    const r: Record<string, { status: number; stdout: string; stderr: string }> = {};
    for (const k of Object.keys(SCENARE)) {
      r[k] = { status: Number(read(join(d, `${k}.rc`)).trim()), stdout: read(join(d, `${k}.out`)), stderr: read(join(d, `${k}.err`)) };
    }
    return r;
  })();

  test("funkce ve skriptu je a volání chybu propaguje (umri v $(…) ukončí jen podshell)", () => {
    expect(funkce, "skript smíru nemá funkci idp_stav — test by nic neměřil").toBeTruthy();
    expect(/IDP_STAV="\$\(idp_stav "\$IDP_ALIAS"\)" \|\| (exit 1|umri)/.test(bezKomentaru(src))).toBe(true);
    expect(/identity-provider\/instances[^\n]*2>\/dev\/null \|\| true/.test(bezKomentaru(src)),
      "čtení poskytovatele polyká chybu (2>/dev/null || true) — chyba nástroje by vypadala jako data").toBe(false);
  });

  test("úspěch → reprezentace", () => {
    expect(vysledky.ok.status).toBe(0);
    expect(vysledky.ok.stdout).toContain('"clientId":"c"');
  });

  test("404 → prázdné (poskytovatel v realmu není), bez chyby", () => {
    expect(vysledky.nf.status).toBe(0);
    expect(vysledky.nf.stdout).toBe("");
  });

  test.each([
    ["vypršené/špatné přihlášení (401)", "e401"],
    ["chyba serveru (5xx)", "e500"],
    ["síť", "sit"],
  ])("%s → smír končí nenulově a řekne proč", (_popis, k) => {
    const r = vysledky[k];
    expect(r.status, "chyba nástroje prošla jako „poskytovatel není“").toBe(7);
    expect(r.stderr).toContain("ne 404");
    expect(r.stderr).toContain(SCENARE[k].stderr);
  });
});
