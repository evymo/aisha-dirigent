/**
 * Brána: první přihlášení přes vnější IdP NEPROPOJÍ existující účet bez ověření (CLASS gate)
 *
 * TŘÍDA VADY: tok prvního přihlášení (first broker login) rozhoduje, co se stane,
 * když Google/Apple vrátí e-mail, pod kterým už v realmu účet je. Krok, který
 * existujícího uživatele NASTAVÍ bez ověření (`idp-auto-link`,
 * `idp-detect-existing-broker-user`), předá účet každému, kdo u IdP získá identitu
 * s tou adresou — typicky správci e-mailové domény oběti.
 *
 * ⛔ NAMĚŘENO 2026-09-27 (Aisha Guru, čtení DB Keycloaku): `idp-auto-link` živý na
 * čtyřech měřených instancích se zapnutým Google/Apple.
 * Keycloak 26.0.8 `IdpAutoLinkAuthenticator` nastaví uživatele a hned `success()` —
 * na trustEmail ani na email_verified nehledí.
 *
 * INVARIANT (dvě půlky téže věty):
 *   1. ŠABLONA (každý JSON realmu ve stromu): žádný aktivní krok nepropojí bez
 *      ověření; po potvrzení propojení (`idp-confirm-link`) vždy následuje POVINNÝ
 *      důkaz vlastnictví (odkaz e-mailem nebo heslo účtu); založení nového
 *      uživatele má mezi alternativami ostře nejnižší prioritu (jinak nový
 *      uživatel narazí na propojení cizího účtu).
 *   2. ŽIVÝ REALM: šablona se do realmu dostane jen importem do PRÁZDNÉHO realmu.
 *      Běžící realm opravuje smír po startu (`keycloak/reconcile-realm-clients.sh`,
 *      blok `tok-prvniho-prihlaseni`). Tady: blok je a skript ho volá. CHOVÁNÍ
 *      smíru (proti modelu Keycloaku 26.0.8, včetně pádu v každém zapisujícím
 *      volání) měří `smir-prvniho-prihlaseni-dorovna-realm.gate.test.ts` —
 *      ~900 volání falešného kcadm, proto v těžké dráze.
 *
 * `trustEmail` tu záměrně NENÍ: propojení na něm po opravě nezávisí a vypnutí by
 * bez SMTP zamklo nové uživatele (důvod v docs/deploy/OAUTH_PROVIDERS.md).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kopie, nalezy, sablonaPredOpravou, TOK_EXISTUJICI, TOK_OVERENI, tokyZ, type Tok } from "./lib/prvni-prihlaseni";

const ROOT = process.cwd();
const SMIR = join(ROOT, "keycloak/reconcile-realm-clients.sh");
const SABLONA = join(ROOT, "keycloak/aisha-realm.json");
const read = (p: string) => readFileSync(p, "utf8");
const bezKomentaru = (src: string) => src.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

// ── 1. ŠABLONA ────────────────────────────────────────────────────────────────
describe("šablona realmu: první přihlášení nepropojí existující účet bez ověření", () => {
  // Univerzum: každý JSON s toky pod keycloak/ a v šabloně instančních dat —
  // ruční seznam by minul právě ten soubor, kterým by vada přišla.
  const soubory = ["keycloak", "docs/onboarding/instance-data-template/keycloak"]
    .filter((d) => existsSync(join(ROOT, d)))
    .flatMap((d) =>
      (readdirSync(join(ROOT, d), { recursive: true }) as string[])
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(ROOT, d, f)),
    )
    .filter((f) => /"authenticationFlows"/.test(read(f)));

  test("univerzum není prázdné a obsahuje šablonu realmu", () => {
    expect(soubory, "brána nenašla žádný realm s toky — nic by neměřila").toContain(SABLONA);
  });

  test.each(soubory.map((f) => [f.slice(ROOT.length + 1), f]))("%s", (_rel, f) => {
    expect(
      nalezy(tokyZ(JSON.parse(read(f)))),
      "Tok prvního přihlášení propojí existující účet bez důkazu vlastnictví, nebo nový\n" +
        "uživatel narazí na propojení cizího účtu. Náprava: potvrzení (idp-confirm-link)\n" +
        "+ POVINNÝ důkaz (idp-email-verification NEBO idp-username-password-form),\n" +
        "založení uživatele s ostře nejnižší prioritou. Viz docs/deploy/OAUTH_PROVIDERS.md.",
    ).toEqual([]);
  });

  test("tok ověření existujícího účtu v šabloně je a IdP ho používají", () => {
    const realm = JSON.parse(read(SABLONA)) as { authenticationFlows: Tok[]; identityProviders?: { alias: string; firstBrokerLoginFlowAlias?: string }[] };
    const aliasy = new Set(realm.authenticationFlows.map((t) => t.alias));
    expect(aliasy.has(TOK_EXISTUJICI) && aliasy.has(TOK_OVERENI), "tok existujícího účtu chybí — brána by měřila prázdno").toBe(true);
    for (const idp of realm.identityProviders ?? []) {
      if (idp.firstBrokerLoginFlowAlias) expect(aliasy.has(idp.firstBrokerLoginFlowAlias), `${idp.alias}: tok prvního přihlášení neexistuje`).toBe(true);
    }
  });

  // KLADNÁ KOTVA: analyzátor musí každou z vad POZNAT, jinak by zelená nic neznamenala.
  describe("analyzátor pozná každou vadu (kladná kotva)", () => {
    const toky = tokyZ(JSON.parse(read(SABLONA)));
    const uprav = (fn: (t: Tok[]) => void) => { const t = kopie(toky); fn(t); return nalezy(t); };
    const tok = (t: Tok[], a: string) => t.find((x) => x.alias === a)!;

    test("stav před opravou (idp-auto-link) — dnešní živé realmy", () => {
      expect(nalezy(sablonaPredOpravou(toky)).join("\n")).toMatch(/idp-auto-link \(ALTERNATIVE\) propojí existující účet BEZ ověření/);
    });
    test("idp-detect-existing-broker-user místo ověření", () => {
      expect(uprav((t) => { tok(t, TOK_EXISTUJICI).authenticationExecutions.push({ authenticator: "idp-detect-existing-broker-user", authenticatorFlow: false, requirement: "ALTERNATIVE", priority: 30 }); }).join("\n"))
        .toMatch(/idp-detect-existing-broker-user/);
    });
    test("potvrzení propojení bez důkazu", () => {
      expect(uprav((t) => { const o = tok(t, TOK_OVERENI); o.authenticationExecutions = o.authenticationExecutions.filter((k) => !k.authenticatorFlow); }).join("\n"))
        .toMatch(/chybí POVINNÝ důkaz/);
    });
    test("jedna z alternativ důkazu nic nedokazuje", () => {
      expect(uprav((t) => {
        const o = tok(t, TOK_OVERENI).authenticationExecutions.find((k) => k.authenticatorFlow)!;
        tok(t, o.flowAlias!).authenticationExecutions.push({ authenticator: "idp-review-profile", authenticatorFlow: false, requirement: "ALTERNATIVE", priority: 30 });
      }).join("\n")).toMatch(/chybí POVINNÝ důkaz/);
    });
    test("založení uživatele až za ověřením", () => {
      expect(uprav((t) => { tok(t, TOK_EXISTUJICI).authenticationExecutions.find((k) => k.authenticator === "idp-create-user-if-unique")!.priority = 30; }).join("\n"))
        .toMatch(/není mezi alternativami první/);
    });
    test("shodná priorita (pořadí určí náhoda)", () => {
      expect(uprav((t) => { for (const k of tok(t, TOK_EXISTUJICI).authenticationExecutions) k.priority = 0; }).join("\n"))
        .toMatch(/sdílí prioritu/);
    });
  });
});

// ── 2. SKRIPT SMÍRU: oprava se k běžícím realmům dostane ──────────────────────
describe("smír po startu nese opravu toku prvního přihlášení", () => {
  const src = read(SMIR);
  const blok = src.match(/^# >>> tok-prvniho-prihlaseni\n[\s\S]*?^# <<< tok-prvniho-prihlaseni$/m)?.[0];

  test("blok smíru ve skriptu je a skript ho volá před koncem", () => {
    expect(blok, "skript smíru nemá blok tok-prvniho-prihlaseni").toBeTruthy();
    const mimo = bezKomentaru(src.replace(blok ?? "", ""));
    const volani = mimo.search(/^srovnej_tok_prvniho_prihlaseni\s*$/m);
    expect(volani, "blok je definovaný, ale skript ho nevolá — běžící realmy by opravu nikdy neviděly").toBeGreaterThan(0);
    expect(volani).toBeLessThan(mimo.search(/^log "hotovo"/m));
  });

  test("skript nikde nepřidává krok, který propojí bez ověření", () => {
    expect(bezKomentaru(src)).not.toMatch(/(provider=|pridej_krok\s+\S+\s+)"?(idp-auto-link|idp-detect-existing-broker-user)/);
  });
});
