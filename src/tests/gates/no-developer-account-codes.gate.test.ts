/**
 * No developer / account codes Gate
 *
 * Background:
 *   Apple Team IDs, App Store Connect key ids, personal account emails, and
 *   real `AuthKey_<id>.p8` filenames must never be
 *   committed — they belong in the environment (`${env:APPLE_TEAM_ID}`,
 *   `$APPLE_TEAM_ID`) or in gitignored `.env*` / `.p8` files. They leaked once
 *   into the mobile publishing kit + a VS Code task + a rebrand script; this
 *   gate (plus the matching `.husky/pre-commit` step) stops them coming back.
 *
 * The scan logic lives in scripts/verify-no-dev-codes.mjs (shared with the
 * pre-commit guard so the rules can't drift). This gate (a) asserts the tracked
 * tree is clean, and (b) unit-tests that the rules catch the leaked forms while
 * allowing env / placeholder / alias forms.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RULES, SELF_ALLOW, loadSentinels, scanFile, scanText, scanRepo } from "../../../scripts/verify-no-dev-codes.mjs";

const ROOT = process.cwd();
const GUARD = resolve(ROOT, "scripts/verify-no-dev-codes.mjs");

const email = (localPart: string, domain: string): string => `${localPart}@${domain}`;
// strukturální vrstva sama — soukromé sentinely tohohle stroje do tvrzení nepatří
const caught = (s: string): boolean => scanText(s, { sentinels: [] }).length > 0;

describe("no developer/account codes", () => {
  test("guard script exists", () => {
    expect(existsSync(GUARD), `expected guard at ${GUARD}`).toBe(true);
  });

  test("tracked tree is clean — no Apple Team ID / ASC key id / personal account email", () => {
    const offenders = scanRepo({ staged: false }) as string[];
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  test("detects the leaked / hardcoded forms — by SHAPE, naming nobody", () => {
    // osobní účet na doméně dodavatele: cokoli, co není role
    expect(caught(email("info", "evymo.com"))).toBe(true);
    expect(caught(email("jan.novak", "evymo.com"))).toBe(true);
    expect(caught(email("someone", "evymo.com"))).toBe(true);
    // osobní schránka u freemailu — i zapsaná uvnitř regulárního výrazu (escapovaná tečka);
    // přesně tak ji dřív nesl sám strážce a žádná kontrola freemailu ji neviděla
    expect(caught(email("jan.novak", "gmail.com"))).toBe(true);
    expect(caught(email("jan.novak", "gmail\\.com"))).toBe(true);
    expect(caught(email("nekdo", "seznam.cz"))).toBe(true);
    expect(caught('"DEVELOPMENT_TEAM=ABCDE12345",')).toBe(true);
    expect(caught("APPLE_TEAM_ID=ABCDE12345")).toBe(true); // any team id
    expect(caught("AuthKey_AB12CD34EF.p8")).toBe(true); // any key id
    expect(caught("cd /Users/alice/projects/foo")).toBe(true); // any machine home path
  });

  test("the guard and this test carry NO real identifier — exact values live outside the tree", () => {
    // ⛔ 2026-10-03: strážce nesl jako detekční řetězce skutečné Apple Team ID, id klíče App Store
    // Connect a osobní adresy — a šel do veřejného snímku. Seznam zakázaných hodnot ve veřejném
    // repu je sám únikem. Měří se VLASTNOST: žádné pravidlo ve stromu není doslovná hodnota.
    for (const rule of RULES as { name: string; re: RegExp }[]) {
      expect(rule.name, `pravidlo „${rule.name}“ se hlásí jako uniklý literál`).not.toMatch(/leaked literal/i);
      // doslovná hodnota = vzor bez jediné třídy znaků, kvantifikátoru nebo alternace
      const jenLiteral = /^\\b[A-Za-z0-9@._-]+\\b$/.test(rule.re.source);
      expect(jenLiteral, `pravidlo „${rule.name}“ je doslovná hodnota: ${rule.re.source}`).toBe(false);
    }
    const zdroj = readFileSync(GUARD, "utf8") + readFileSync(resolve(ROOT, "src/tests/gates/no-developer-account-codes.gate.test.ts"), "utf8");
    // tvar Apple Team ID / id klíče (10 znaků, velká písmena a číslice, aspoň jedna číslice a jedno písmeno)
    // smí být ve stromu jen jako zjevná fixtura
    const desitky = [...zdroj.matchAll(/\b(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/g)].map((m) => m[0]);
    expect([...new Set(desitky)].sort()).toEqual(["AB12CD34EF", "ABCDE12345", "QWERTY1234", "ZXCVBN5678"]);
  });

  test("the private exact layer catches a literal anywhere — and is OFF without sentinels", () => {
    const text = "docs: the team id is QWERTY1234 (see portal)";
    expect(scanText(text, { sentinels: [] }).length).toBe(0); // strukturálně to není nález
    const hits = scanText(text, { sentinels: ["QWERTY1234"] });
    expect(hits.length).toBe(1);
    expect(hits[0].rule).not.toContain("QWERTY1234"); // jméno pravidla hodnotu nevypisuje
    // sentinel je celé slovo: uvnitř delšího řetězce nehlásí
    expect(scanText("XQWERTY1234X", { sentinels: ["QWERTY1234"] }).length).toBe(0);
    // příliš krátký sentinel je chyba konfigurace, ne tichý šum
    expect(() => loadSentinels({ AISHA_DEV_CODE_SENTINELS: "abc" } as NodeJS.ProcessEnv, "/nonexistent")).toThrow(/kratší než 8/);
    expect(loadSentinels({ AISHA_DEV_CODE_SENTINELS: "QWERTY1234, ZXCVBN5678" } as NodeJS.ProcessEnv, "/nonexistent")).toEqual(["QWERTY1234", "ZXCVBN5678"]);
    expect(loadSentinels({} as NodeJS.ProcessEnv, "/nonexistent")).toEqual([]);
  });

  test("the guard reads ITSELF with the exact layer — its exemption covers the shapes only", () => {
    // Do 2026-10-03 strážce své dva soubory přeskakoval celé. Právě v nich skutečné hodnoty stály —
    // výjimka pro „soubory, které popisují tvary“ byla zároveň jediným místem, kam se nikdo nedíval.
    const shape = "APPLE_TEAM_ID=ABCDE12345";
    const literal = "the team id is QWERTY1234";
    for (const own of SELF_ALLOW as Set<string>) {
      expect(scanFile(own, shape, { sentinels: [] })).toEqual([]); // tvar ve vlastním souboru = fixtura
      const hits = scanFile(own, literal, { sentinels: ["QWERTY1234"] });
      expect(hits.map((h: { rule: string }) => h.rule), `${own} není čten přesnou vrstvou`).toEqual(["private dev-code sentinel #1"]);
    }
    // jinde platí obě vrstvy
    expect(scanFile("docs/anything.md", shape, { sentinels: [] }).length).toBeGreaterThan(0);
    expect(scanFile("docs/anything.md", literal, { sentinels: ["QWERTY1234"] }).length).toBe(1);
  });

  test("allows env / placeholder / alias / portable forms", () => {
    expect(caught("DEVELOPMENT_TEAM=${env:APPLE_TEAM_ID}")).toBe(false);
    expect(caught("APPLE_TEAM_ID=$APPLE_TEAM_ID")).toBe(false);
    expect(caught("teamID: process.env.APPLE_TEAM_ID")).toBe(false);
    expect(caught("AuthKey_XXXXXXXXXX.p8")).toBe(false);
    expect(caught("security@evymo.com")).toBe(false); // role alias, allowed
    expect(caught("noreply@evymo.com")).toBe(false); // role alias, allowed
    expect(caught("admin@evymo.com")).toBe(false); // functional service address
    expect(caught("legal@evymo.com")).toBe(false); // role alias for entity CLA contact, allowed
    expect(caught(email("privacy.officer", "example.org"))).toBe(false); // adresa mimo doménu dodavatele a mimo freemail
    expect(caught("sets APPLE_TEAM_ID + signing config — values never committed")).toBe(false);
    expect(caught('cd "$(git rev-parse --show-toplevel)"')).toBe(false); // portable repo root
    expect(caught("cd $HOME/projects/foo")).toBe(false);
    expect(caught("${workspaceFolder}/ios/App.xcworkspace")).toBe(false);
    expect(caught("/Users/Shared/config.json")).toBe(false); // shared dir, not a home
    expect(caught("/Users/dev/project/src/x.ts")).toBe(false); // placeholder username (test fixtures)
    expect(caught("/Users/demouser4/projects/foo")).toBe(false); // demo seed data
  });
});
