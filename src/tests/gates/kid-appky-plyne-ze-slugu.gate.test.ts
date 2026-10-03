/**
 * `kid` appky u dveří plyne ze `slug` jejího povrchu — v OBOU producentech.
 *
 * ⛔ NAMĚŘENO 2026-09-21 na appce řidiče: v logu vrátného bylo jen `ops-<instance>`,
 *    žádný slug. Nešlo o pád — dveře otevíraly, jen KOMU JINÉMU, takže z logu
 *    nešlo poznat, kdo ťukal.
 *
 *    Příčina nebyla v žádném ze dvou bloků `instance-env-derive.sh`; oba byly
 *    napsané správně. Bash `: "${X:=Y}"` přiřadí jen do PRÁZDNA, takže vyhrál
 *    PRVNÍ — instanční — a brandový se ke slovu nedostal. Vadné bylo POŘADÍ.
 *
 * ⭐ `kid` je SŮL odvození klíče (`deriveFromPassword(kód, kid)`), takže se
 *    MUSÍ shodovat mezi buildem a rosterem. Proto se tu měří OBA producenty:
 *    `knock-provision.mjs --app <slug>` (roster) i `instance-env-derive.sh` (build).
 *    Rozejdou-li se, zaťukání padne na `unknown-kid` — tedy MLČENÍM, k nerozeznání
 *    od zavřených dveří.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const PRAC = mkdtempSync(join(tmpdir(), "kid-slug-"));
afterAll(() => rmSync(PRAC, { recursive: true, force: true }));

const INSTANCE = [
  "SPA_KNOCK_PUBLIC_HOST=priklad.test",
  "SPA_KNOCK_PUBLIC_PORT=12345",
  "SPA_KNOCK_MOBILE_KID=ops-priklad",   // instanční operátor — NESMÍ vyhrát
  "SPA_KNOCK_MOBILE_SCOPE=ops",
  "PUBLIC_TLD=priklad.test",
].join("\n");

/** Build: odvození prostředí pro sestavení appky. */
function build(brand: Record<string, unknown>) {
  const env = join(PRAC, `e-${Math.random().toString(36).slice(2)}`);
  const ver = join(PRAC, `v-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(env, INSTANCE);
  writeFileSync(ver, JSON.stringify({ brand: { oauthClientId: "k", scheme: "t", ...brand } }));
  const out = execFileSync(
    "bash",
    ["-c", `set -a; AISHA_INSTANCE_ENV="$1" VERSION_FILE="$2"; . "$3"; env`, "_", env, ver,
      join(ROOT, "mobile-app/scripts/instance-env-derive.sh")],
    { encoding: "utf8", timeout: 30_000, cwd: join(ROOT, "mobile-app"), env: envWithoutGitLocation() },
  );
  return Object.fromEntries(out.split("\n").flatMap((r) => {
    const i = r.indexOf("=");
    return i > 0 ? [[r.slice(0, i), r.slice(i + 1)]] : [];
  })) as Record<string, string>;
}

/** Roster: co by knock-provision zapsal do instančního prostředí. */
function roster(slug: string, brand: Record<string, unknown>) {
  const overlay = join(PRAC, `o-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(overlay, "surfaces", slug), { recursive: true });
  writeFileSync(join(overlay, "surfaces", slug, "version.json"), JSON.stringify({ brand }));
  const env = join(PRAC, `pe-${Math.random().toString(36).slice(2)}`);
  writeFileSync(env, "PUBLIC_TLD=priklad.test\nAPP_NAME_PREFIX=priklad\nSPA_KNOCK_PUBLIC_PORT=12345\nEDGE_COMPOSE_PROFILES=knock\n");
  return execFileSync("node", [join(ROOT, "scripts/knock-provision.mjs"), "--app", slug, "--print"], {
    encoding: "utf8", timeout: 30_000, cwd: ROOT,
    env: { ...process.env, AISHA_INSTANCE_CONFIG_DIR: overlay, AISHA_INSTANCE_ENV: env, PUBLIC_TLD: "priklad.test",
           APP_NAME_PREFIX: "priklad", SPA_KNOCK_PUBLIC_PORT: "12345" },
  });
}

describe("kid appky plyne ze slugu povrchu — v obou producentech", () => {
  it("BUILD: brand.slug přebije instanční SPA_KNOCK_MOBILE_KID", () => {
    const e = build({ slug: "priklad-ridic", knock: { scope: "ops" } });
    expect(
      e.EXPO_PUBLIC_KNOCK_KID,
      "appka by se u dveří hlásila operátorskou identitou instance — z logu nepoznáš, KDO ťukal",
    ).toBe("priklad-ridic");
  });

  it("BUILD: výslovný brand.knock.kid má přednost (instance ho už má v rosteru)", () => {
    expect(build({ slug: "priklad-ridic", knock: { kid: "jine", scope: "ops" } }).EXPO_PUBLIC_KNOCK_KID).toBe("jine");
  });

  it("BUILD: scope se NEODVOZUJE ze slugu — říká CO SMÍ, ne KDO je", () => {
    expect(build({ slug: "priklad-ridic", knock: { scope: "drive" } }).EXPO_PUBLIC_KNOCK_SCOPE).toBe("drive");
  });

  it("BUILD: instance BEZ dveří se nasadí — odvozený host není deklarace", () => {
    // Regrese z 2026-09-21: kontrola úplnosti počítala mezi „něco tu je" i HOST,
    // který se odvodí z PUBLIC_TLD — a odmítla build instanci, co dveře NEMÁ.
    // Instance bez dveří = ani v prostředí, ani v brandu žádná knock hodnota.
    const env = join(PRAC, `bez-${Math.random().toString(36).slice(2)}`);
    const ver = join(PRAC, `bezv-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(env, "PUBLIC_TLD=priklad.test");
    writeFileSync(ver, JSON.stringify({ brand: { oauthClientId: "k", scheme: "t", slug: "priklad-ridic" } }));
    const out = execFileSync(
      "bash",
      ["-c", `set -a; AISHA_INSTANCE_ENV="$1" VERSION_FILE="$2"; . "$3"; env`, "_", env, ver,
        join(ROOT, "mobile-app/scripts/instance-env-derive.sh")],
      { encoding: "utf8", timeout: 30_000, cwd: join(ROOT, "mobile-app"), env: envWithoutGitLocation() },
    );
    expect(out, "build instance bez dveří se odmítl — odvozený host se počítá jako deklarace").toContain("EXPO_PUBLIC_PUBLIC_TLD=");
  });

  it("ROSTER: knock-provision --app odvodí TÝŽ kid a scope z téhož povrchu", () => {
    const out = roster("priklad-ridic", { slug: "priklad-ridic", knock: { scope: "drive" } });
    expect(out, "roster by zapsal jiný kid než build — zaťukání padne na unknown-kid").toContain("SPA_KNOCK_MOBILE_KID=priklad-ridic");
    expect(out).toContain("SPA_KNOCK_MOBILE_SCOPE=drive");
  });

  it("NEGATIVNÍ KONTROLA: povrch bez deklarace se NEHÁDÁ", () => {
    let selhalo = false;
    try { roster("priklad-ridic", { /* bez slug i knock */ }); } catch { selhalo = true; }
    expect(selhalo, "knock-provision si identitu appky domyslel místo odmítnutí").toBe(true);
  });
});
