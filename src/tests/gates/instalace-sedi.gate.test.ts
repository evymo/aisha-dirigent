/**
 * Kontrola instalace před pre-push musí umět říct NE — a nesmí mlčet
 *
 * `scripts/lib/instalace-sedi.mjs` běží na začátku `.husky/pre-push`, aby
 * zastaralé nebo symlinkované node_modules zastavily push za zlomek sekundy,
 * ne po ~10 min pádem `Cannot find module` v cizím balíku (naměřeno 2026-09-24).
 * Každý stav, kdy instalaci NELZE ověřit, je nález — žádné „nevím, tak dál".
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { instalaceSedi } from "../../../scripts/lib/instalace-sedi.mjs";

const ROOT = process.cwd();
const docasne: string[] = [];
afterEach(() => { for (const d of docasne.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Balik = { version: string; optional?: boolean };

/** Worktree v malém: lockfile, skrytý lockfile a adresáře balíků na disku. */
function worktree(lock: Record<string, Balik>, opts: { skryty?: Record<string, Balik> | null; naDisku?: string[] } = {}) {
  const koren = mkdtempSync(path.join(os.tmpdir(), "instalace-sedi-"));
  docasne.push(koren);
  writeFileSync(path.join(koren, "package-lock.json"), JSON.stringify({ packages: { "": {}, ...lock } }));
  const skryty = opts.skryty === undefined ? lock : opts.skryty;
  const naDisku = opts.naDisku ?? Object.keys(skryty ?? {});
  mkdirSync(path.join(koren, "node_modules"), { recursive: true });
  for (const k of naDisku) mkdirSync(path.join(koren, k), { recursive: true });
  if (skryty) writeFileSync(path.join(koren, "node_modules/.package-lock.json"), JSON.stringify({ packages: skryty }));
  return koren;
}

const LOCK: Record<string, Balik> = {
  "node_modules/ajv": { version: "6.12.6" },
  "packages/acs-sdk/node_modules/ajv": { version: "8.17.1" },
};

describe("instalace-sedi — kontrola node_modules před pre-push", () => {
  it("kontrolní vzorek: čerstvá instalace projde", () => {
    expect(instalaceSedi(worktree(LOCK))).toEqual([]);
  });

  it("volitelný balík jiné platformy nechybí", () => {
    const koren = worktree({ ...LOCK, "node_modules/@esbuild/linux-x64": { version: "0.25.0", optional: true } }, { skryty: LOCK });
    expect(instalaceSedi(koren)).toEqual([]);
  });

  it("⭐ symlinkované node_modules = STOP", () => {
    const cil = worktree(LOCK);
    const koren = mkdtempSync(path.join(os.tmpdir(), "instalace-sedi-link-"));
    docasne.push(koren);
    writeFileSync(path.join(koren, "package-lock.json"), readFileSync(path.join(cil, "package-lock.json")));
    symlinkSync(path.join(cil, "node_modules"), path.join(koren, "node_modules"));
    expect(instalaceSedi(koren).join()).toMatch(/symlink/);
  });

  it("⭐ chybějící .package-lock.json = STOP, ne tiché projití", () => {
    expect(instalaceSedi(worktree(LOCK, { skryty: null })).join()).toMatch(/\.package-lock\.json chybí/);
  });

  it("chybějící node_modules = STOP", () => {
    const koren = worktree(LOCK);
    rmSync(path.join(koren, "node_modules"), { recursive: true });
    expect(instalaceSedi(koren).join()).toMatch(/node_modules chybí/);
  });

  it("jiná verze než v lockfilu = STOP", () => {
    const koren = worktree(LOCK, { skryty: { ...LOCK, "node_modules/ajv": { version: "6.0.0" } } });
    expect(instalaceSedi(koren).join()).toMatch(/node_modules\/ajv: nainstalováno 6\.0\.0, lockfile chce 6\.12\.6/);
  });

  it("⭐ balík z lockfilu v instalaci chybí = STOP (ajv/dist/2020 z 09-24)", () => {
    const koren = worktree(LOCK, { skryty: { "node_modules/ajv": LOCK["node_modules/ajv"] } });
    expect(instalaceSedi(koren).join()).toMatch(/chybí packages\/acs-sdk\/node_modules\/ajv@8\.17\.1/);
  });

  it("⭐ instalace balík eviduje, ale na disku není = STOP", () => {
    const koren = worktree(LOCK, { naDisku: ["node_modules/ajv"] });
    expect(instalaceSedi(koren).join()).toMatch(/eviduje packages\/acs-sdk\/node_modules\/ajv, ale na disku není/);
  });

  it("pre-push volá kontrolu PŘED stack-smoke a zastaví se na ní", () => {
    const hook = readFileSync(path.join(ROOT, ".husky/pre-push"), "utf8");
    const kontrola = hook.indexOf("scripts/lib/instalace-sedi.mjs");
    expect(kontrola, "pre-push musí volat scripts/lib/instalace-sedi.mjs").toBeGreaterThan(-1);
    expect(kontrola).toBeLessThan(hook.indexOf("npm run test:stack:ci"));
    expect(hook.slice(kontrola, kontrola + 200)).toMatch(/\|\|\s*exit 1/);
  });
});
