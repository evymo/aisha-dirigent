/**
 * Instance boundary — no tool may act on another instance's inventory
 *
 * WHY (measured 2026-08-08 on a fork installation):
 *   coolify-drift-check.mjs hardcoded `coolify/manifests/aisha.manifest` and
 *   filtered live apps with `name.startsWith("aisha-")`. On any fork that means
 *   the whole reference inventory reads as MISSING, every real app is invisible,
 *   and the report ends with
 *
 *     Action: bash scripts/coolify-story-init.sh --manifest coolify/manifests/aisha.manifest
 *
 *   Following that line creates a FOREIGN instance's apps inside this one. The
 *   same checker is the only tool reporting SERVER_DRIFT (app on the wrong
 *   machine), so while it was blind to the fork a placement change — precisely
 *   what a mesh bring-up needs — could never surface.
 *
 * The boundary now lives in ONE place, lib/coolify-instance-scope.mjs, shared by
 * the .mjs tools and (via its CLI) by the shell — the same shape as
 * lib/coolify-project-scope.mjs. This gate pins that:
 *   1) the shared module exists and fails loud rather than guessing;
 *   2) tools resolve the instance through it instead of re-deriving it;
 *   3) no tool pins a manifest path or app-name prefix to a literal instance;
 *   4) coolify-story-init.sh refuses a story that is not this instance.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Jméno proměnné bere z rozcestníku, ne jako literál. Brána
// overlay-jde-jen-jednemi-dvermi hlídá, že o overlayi rozhoduje jediné místo, a
// skenuje SUROVÝ text — vypsané jméno by ji shodilo i uvnitř komentáře. Přes
// konstantu se navíc případné přejmenování propíše sem samo.
import { OVERLAY_ENV } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts/lib/coolify-instance-scope.mjs");
const STORY_INIT = join(ROOT, "scripts/coolify-story-init.sh");

/** Tools that resolve an instance / manifest and must delegate to the shared lib. */
const CONSUMERS = [
  "scripts/coolify-drift-check.mjs",
  "scripts/coolify-mesh-sync.mjs",
  "scripts/pki-bridge-deploy.mjs",
];

// ⛔ POZOR na `scripts/coolify-sync-envs.sh`. Do seznamu výš NEPATŘÍ, ačkoli se to
// nabízí: má VLASTNÍ, behaviorální bránu `coolify-sync-instance-scope.gate.test.ts`,
// která skript SPOUŠTÍ a pins jeho chování i hlášky — mimo jiné že instanci odvozuje
// ze svého $ENV_FILE a při rozporu odmítne vlastní formulací. Textové pravidlo „nesmí
// mít vlastní APP_NAME_PREFIX parser" je s tím v přímém rozporu. Naměřeno 2026-09-04:
// zápis sem shodil 4 testy té behaviorální brány. Chování je silnější kontrakt než
// text; kdo chce ten parser sjednotit, musí nejdřív přepsat ji.

describe("Instance boundary — shared, dynamic, never a literal", () => {
  test("the shared module exists and refuses to guess the instance", () => {
    expect(existsSync(LIB), "scripts/lib/coolify-instance-scope.mjs must exist").toBe(true);
    const src = readFileSync(LIB, "utf-8");
    for (const fn of ["resolveInstancePrefix", "resolveManifestPath", "assertManifestMatchesInstance"]) {
      expect(src, `the shared module must export ${fn}`).toMatch(new RegExp(`export function ${fn}\\b`));
    }
    // Obě vlastnosti níž se MĚŘÍ, ne hledají v textu. Dřív tu stály dva pinnuté
    // řetězce (`refusing to act`, `cannot tell which`) — a text „seděl" i ve chvíli,
    // kdy modul znal jediný deklarační kanál ze čtyř a instance deklarovaná ve
    // vaultu pro něj neexistovala (naměřeno 2026-08-13). Chování to odhalí, text ne.
    // Úplná matice kanálů je v identita-ma-jeden-domov.gate.test.ts.
    const bezIdentity: NodeJS.ProcessEnv = {
      ...process.env,
      AISHA_IDENTITY_ROOT: mkdtempSync(join(tmpdir(), "scope-prazdno-")),
    };
    delete bezIdentity.APP_NAME_PREFIX;
    delete bezIdentity.AISHA_STORY;
    delete bezIdentity.ENV_FILE;
    delete bezIdentity.ENV_PROD_BACKUP;
    expect(
      () => execFileSync("node", [LIB, "--prefix"], { env: bezIdentity, stdio: "pipe" }),
      "an undeclared instance must be a refusal, not a default — on a shared Coolify it means writing into another tenant.",
    ).toThrow();

    const rozpor = mkdtempSync(join(tmpdir(), "scope-rozpor-"));
    writeFileSync(join(rozpor, ".env.local"), "APP_NAME_PREFIX=alfa\n");
    writeFileSync(join(rozpor, ".env.coolify"), "APP_NAME_PREFIX=beta\n");
    expect(
      () =>
        execFileSync("node", [LIB, "--prefix"], {
          env: { ...bezIdentity, AISHA_IDENTITY_ROOT: rozpor },
          stdio: "pipe",
        }),
      "two disagreeing sources must refuse rather than pick a winner.",
    ).toThrow();
  });

  test("a manifest belonging to another instance is refused", () => {
    const src = readFileSync(LIB, "utf-8");
    // The comparison itself, not merely the presence of a message.
    expect(
      src,
      "assertManifestMatchesInstance must compare the manifest's story against the resolved instance.",
    ).toMatch(/story\s*!==\s*instance/);
    expect(
      src,
      "the refusal must name the consequence so the operator sees why (foreign apps created here).",
    ).toMatch(/would create/);
  });

  test.each(CONSUMERS)("%s resolves the instance via the shared module", (rel) => {
    const path = join(ROOT, rel);
    expect(existsSync(path), `${rel} must exist`).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(
      src,
      `${rel} must import lib/coolify-instance-scope.mjs rather than re-deriving the instance.`,
    ).toMatch(/coolify-instance-scope\.mjs/);
    expect(
      src,
      `${rel} must not carry its own APP_NAME_PREFIX parser — that is the duplication this boundary replaces.`,
    ).not.toMatch(/\^APP_NAME_PREFIX=/);
  });

  test.each(CONSUMERS)("%s pins no literal instance manifest or app prefix", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf-8");
    // Strip comments: the incident is described in prose in several of these files.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(
      code,
      `${rel} must not hardcode a manifest path for one instance — resolve it via resolveManifestPath().`,
    ).not.toMatch(/manifests\/[a-z0-9-]+\.manifest/);
    expect(
      code,
      `${rel} must not filter live apps by a literal "<instance>-" prefix — derive it from the manifest story / instance.`,
    ).not.toMatch(/startsWith\(\s*["'`][a-z0-9-]+-["'`]\s*\)/);
  });

  test("coolify-story-init.sh refuses a story that is not this instance", () => {
    const src = readFileSync(STORY_INIT, "utf-8");
    expect(
      src,
      "story-init must resolve the instance through the shared CLI, not a literal or its own parser.",
    ).toMatch(/coolify-instance-scope\.mjs["']?\s+--prefix/);
    expect(
      src,
      "STORY_NAME becomes the app-name prefix, so it must be compared against the declared instance.",
    ).toMatch(/STORY_NAME"?\s*!=\s*"?\$\{?_instance_prefix/);
    expect(src, "a mismatch must abort, never warn-and-continue.").toMatch(
      /does not match this instance[\s\S]{0,400}?exit 1/,
    );
  });

  // An inventory is instance data by the same argument that moved the deployment
  // profile out of this repository (config/profiles/README.md). Before this, the
  // resolver looked only in the public tree, so an instance could satisfy the
  // boundary guard ONLY by publishing its inventory here — one rule bought at the
  // price of the other. Measured on a fork 2026-08-11: cold-start-doctor
  // failed with "instance '<fork>' has no coolify/manifests/<fork>.manifest".
  describe("an instance may keep its inventory in its own overlay", () => {
    const scopeLib = () => import(/* @vite-ignore */ join(ROOT, "scripts/lib/coolify-instance-scope.mjs"));

    /** Overlay laid out like the instance-data repo: manifests/<instance>.manifest */
    function overlayWithManifest(instance: string) {
      const dir = mkdtempSync(join(tmpdir(), "scope-overlay-"));
      const manifests = join(dir, "manifests");
      execFileSync("mkdir", ["-p", manifests]);
      writeFileSync(join(manifests, `${instance}.manifest`), `story: ${instance}\n`);
      return dir;
    }

    test("the overlay is consulted, and its manifest still has to be ours", async () => {
      const { resolveManifestPath, assertManifestMatchesInstance } = await scopeLib();
      const dir = overlayWithManifest("testfork");
      const prev = process.env[OVERLAY_ENV];
      process.env[OVERLAY_ENV] = dir;
      try {
        const found = resolveManifestPath({ prefix: "testfork" });
        expect(found, "an instance's own overlay must satisfy the boundary").toBe(
          join(dir, "manifests/testfork.manifest"),
        );
        // the guard is unchanged: WHERE it came from never decides WHOSE it is
        expect(() => assertManifestMatchesInstance(found, { prefix: "someone-else" })).toThrow(
          /refusing/,
        );
      } finally {
        if (prev === undefined) delete process.env[OVERLAY_ENV];
        else process.env[OVERLAY_ENV] = prev;
      }
    });

    test("with no manifest anywhere it still refuses — and names both channels", async () => {
      const { resolveManifestPath } = await scopeLib();
      const prev = process.env[OVERLAY_ENV];
      process.env[OVERLAY_ENV] = mkdtempSync(join(tmpdir(), "scope-empty-"));
      try {
        // a name no repo manifest can satisfy, so the throw is about absence, not luck
        expect(() => resolveManifestPath({ prefix: "instance-bez-manifestu" })).toThrow(
          /refusing to fall back[\s\S]*manifests\/instance-bez-manifestu\.manifest/,
        );
      } finally {
        if (prev === undefined) delete process.env[OVERLAY_ENV];
        else process.env[OVERLAY_ENV] = prev;
      }
    });
  });
});

/**
 * Rada v hlášce musí jít provést.
 *
 * ⛔ NÁLEZ 2026-09-23 (obhlídka forku): chybějící manifest ohlásil redeploy radou
 * „Or pass --manifest <path>". Redeploy ten přepínač nezná (odmítne ho jako
 * neznámý) a explicitní cestu bere z MANIFEST_FILE. Obsluha radu zkusila, narazila
 * a začala obcházet zrcadlem ze symlinků. Sdílená hláška volajícího nezná, a proto
 * jí ho volající musí říct (`explicitHint`).
 *
 * Třída, ne případ: univerzum jsou VŠICHNI volající ve stromu scripts/, ne seznam.
 * Kdo bere cestu z proměnné prostředí, musí v radě jmenovat právě tu proměnnou.
 */
describe("rada k chybějícímu manifestu jmenuje kanál, který volající opravdu čte", () => {
  const scopeLib = () => import(/* @vite-ignore */ join(ROOT, "scripts/lib/coolify-instance-scope.mjs"));

  test("hláška nese kanál, který volající předal — ne pevné --manifest", async () => {
    const { resolveManifestPath } = await scopeLib();
    const prev = process.env[OVERLAY_ENV];
    process.env[OVERLAY_ENV] = mkdtempSync(join(tmpdir(), "scope-hint-"));
    try {
      let zprava = "";
      try {
        resolveManifestPath({ prefix: "instance-bez-manifestu", explicitHint: "MANIFEST_FILE=<path>" });
      } catch (e) {
        zprava = (e as Error).message;
      }
      expect(zprava, "resolver měl odmítnout").toMatch(/refusing to fall back/);
      expect(zprava).toMatch(/Or pass MANIFEST_FILE=<path>\./);
      expect(zprava, "rada nesmí jmenovat přepínač, který volající nezná").not.toMatch(/--manifest/);
    } finally {
      if (prev === undefined) delete process.env[OVERLAY_ENV];
      else process.env[OVERLAY_ENV] = prev;
    }
  });

  test("každý volající, který bere cestu z prostředí, ji v radě jmenuje", () => {
    const soubory = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n")
      .filter((f) => /\.(mjs|js|ts)$/.test(f) && f !== "scripts/lib/coolify-instance-scope.mjs");
    const volani: string[] = [];
    const vady: string[] = [];
    for (const f of soubory) {
      const src = readFileSync(join(ROOT, f), "utf-8");
      for (const m of src.matchAll(/resolveManifestPath\(\{([^}]*)\}\)/g)) {
        volani.push(f);
        const zProstredi = m[1].match(/explicit:\s*process\.env\.([A-Z_][A-Z0-9_]*)/);
        if (!zProstredi) continue;
        const promenna = zProstredi[1];
        if (!new RegExp(`explicitHint:\\s*["'\`]${promenna}=`).test(m[1])) {
          vady.push(`${f}: cestu bere z ${promenna}, ale rada ji nejmenuje (explicitHint: "${promenna}=<path>")`);
        }
      }
    }
    // Univerzum nesmí být prázdné — jinak by brána prošla tím, že nic nenašla.
    expect(volani.length, "ve stromu scripts/ nebyl nalezen žádný volající resolveManifestPath").toBeGreaterThan(0);
    expect(volani, "redeploy je volající, na kterém nález vznikl — musí být v univerzu").toContain(
      "scripts/aisha-redeploy.mjs",
    );
    expect(vady).toEqual([]);
  });
});
