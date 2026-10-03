import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nahradObsahAtomicky } from "./zapis-env-atomicky.mjs";

const ENV_ZAPIS_SH = resolve(dirname(fileURLToPath(import.meta.url)), "env-zapis.sh");

/** Tvar z 2026-09-15: hlavní trezor + worktree se symlinkem na něj. */
let koren;
let hlavni;
let worktree;
let odkaz;

beforeEach(() => {
  koren = mkdtempSync(join(tmpdir(), "zapis-env-"));
  hlavni = join(koren, "hlavni");
  worktree = join(koren, "wt");
  mkdirSync(hlavni);
  mkdirSync(worktree);
  writeFileSync(join(hlavni, ".env.coolify"), "MESH_PEER_IPS=\n", { mode: 0o600 });
  odkaz = join(worktree, ".env.coolify");
  symlinkSync(join(hlavni, ".env.coolify"), odkaz);
});

afterEach(() => rmSync(koren, { recursive: true, force: true }));

const zbyleDocasne = (adresar) => readdirSync(adresar).filter((f) => f.includes(".tmp"));

describe("nahradObsahAtomicky (Node) — symlink přežije", () => {
  it("zápis přes symlink: odkaz zůstane odkazem a nový obsah je v hlavním souboru", () => {
    const skutecna = nahradObsahAtomicky(odkaz, "MESH_PEER_IPS=100.112.9.70\n");
    expect(lstatSync(odkaz).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(hlavni, ".env.coolify"), "utf8")).toBe("MESH_PEER_IPS=100.112.9.70\n");
    expect(skutecna).toBe(realpathSync(join(hlavni, ".env.coolify")));
    expect(zbyleDocasne(hlavni)).toEqual([]);
    expect(zbyleDocasne(worktree)).toEqual([]);
  });

  it("sonda: holé renameSync na cestu symlinku by ho nahradilo (měříme skutečnou vadu)", () => {
    const tmp = `${odkaz}.tmp`;
    writeFileSync(tmp, "X=1\n");
    spawnSync(process.execPath, ["-e", `require("fs").renameSync(${JSON.stringify(tmp)}, ${JSON.stringify(odkaz)})`]);
    expect(lstatSync(odkaz).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(hlavni, ".env.coolify"), "utf8")).toBe("MESH_PEER_IPS=\n");
  });

  it("řetěz relativních symlinků se rozliší až ke skutečnému souboru", () => {
    const druhy = join(koren, "druhy-odkaz");
    symlinkSync("wt/.env.coolify", druhy);
    nahradObsahAtomicky(druhy, "A=2\n");
    expect(lstatSync(druhy).isSymbolicLink()).toBe(true);
    expect(lstatSync(odkaz).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(hlavni, ".env.coolify"), "utf8")).toBe("A=2\n");
  });

  it("neexistující cíl se prostě vytvoří", () => {
    const novy = join(koren, "novy.env");
    nahradObsahAtomicky(novy, "B=3\n", { mode: 0o600 });
    expect(readFileSync(novy, "utf8")).toBe("B=3\n");
    expect(statSync(novy).mode & 0o777).toBe(0o600);
  });
});

describe("env_zapis_atomicky (shell) — symlink přežije", () => {
  const spust = (skript) => spawnSync("bash", ["-c", `set -euo pipefail; source ${JSON.stringify(ENV_ZAPIS_SH)}; ${skript}`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });

  it("obsah z mktemp jinde → odkaz zůstane, hlavní soubor má nový obsah s právy 600, zdroj zmizí", () => {
    const zdroj = join(tmpdir(), `env-zdroj-${process.pid}-${Date.now()}`);
    writeFileSync(zdroj, "GATEWAY_TRUSTED_PROXIES=10.0.0.0/8\n");
    const r = spust(`env_zapis_atomicky ${JSON.stringify(zdroj)} ${JSON.stringify(odkaz)}`);
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(odkaz).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(hlavni, ".env.coolify"), "utf8")).toBe("GATEWAY_TRUSTED_PROXIES=10.0.0.0/8\n");
    expect(statSync(join(hlavni, ".env.coolify")).mode & 0o777).toBe(0o600);
    expect(() => statSync(zdroj)).toThrow();
    expect(zbyleDocasne(hlavni)).toEqual([]);
  });

  it("sonda: holé mv na cestu symlinku by ho nahradilo", () => {
    const zdroj = join(koren, "zdroj");
    writeFileSync(zdroj, "X=1\n");
    spawnSync("mv", [zdroj, odkaz]);
    expect(lstatSync(odkaz).isSymbolicLink()).toBe(false);
  });

  it("cyklus symlinků selže nahlas a nic nezapíše", () => {
    const a = join(koren, "a");
    const b = join(koren, "b");
    symlinkSync(b, a);
    symlinkSync(a, b);
    const zdroj = join(koren, "zdroj2");
    writeFileSync(zdroj, "X=1\n");
    const r = spust(`env_zapis_atomicky ${JSON.stringify(zdroj)} ${JSON.stringify(a)}`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cyklus/);
  });
});
