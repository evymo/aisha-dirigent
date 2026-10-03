/**
 * Které deploy úlohy mohou nasadit změnu DB/bezpečnosti — a pustí je
 * governance-gate? Sdílené měřidlo bran cicd-governance a release-operations-sre.
 *
 * ⛔ 2026-09-17: univerzum se dřív hledalo jako „deploy úloha, jejíž `if` zmiňuje
 * `db_change`/`security_change`". Od chvíle, kdy o relevanci nasazení rozhoduje
 * jen detektor (`deploy_apps`), žádná úloha ty příznaky nezmiňuje — a DB změna se
 * přitom nasazuje dál: `aisha/db/**` detektor posílá na appky, které staví obraz
 * `migrate` (core, orchestration), a ty nasazují deploy-core a vlny
 * (deploy-koren/stacky). Univerzum je proto každá deploy úloha, která rozhoduje
 * podle `deploy_apps` NEBO podle DB/security příznaku.
 *
 * ⭐ „Pustí je governance-gate" se VYHODNOCUJE (lib/ci-vyraz), nehledá textem:
 * `!= 'failure'` i `== 'success' || == 'skipped'` jsou platné tvary a regex na
 * slovo „skipped" by jeden z nich označil za vadu.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { vyhodnotit, type Hodnota } from "./ci-vyraz";

type Uloha = { name?: string; if?: string; needs?: string[] | string };

export function nactiWorkflow(root: string): Record<string, Uloha> {
  return (yaml.load(readFileSync(join(root, ".forgejo/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Uloha> }).jobs;
}

function vsechnyAppky(root: string): string[] {
  const appky = readFileSync(join(root, "coolify/manifests/aisha.manifest"), "utf8")
    .split("\n")
    .map((r) => /^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i.exec(r)?.[1])
    .filter((x): x is string => Boolean(x));
  if (appky.length === 0) throw new Error("nasazeni-db-zmen: manifest nevydal ANI JEDNU appku — model deploy_apps by byl prázdný");
  return appky;
}

/** Deploy úlohy, které mohou nasadit změnu DB/bezpečnosti. */
export function ulohyNasazujiciDbZmeny(root: string): Array<{ jmeno: string; uloha: Uloha }> {
  return Object.entries(nactiWorkflow(root))
    .filter(([id]) => id.startsWith("deploy-"))
    .filter(([, u]) => /needs\.detect\.outputs\.(deploy_apps|db_change|security_change)\b/.test(String(u.if ?? "")))
    .map(([jmeno, uloha]) => ({ jmeno, uloha }));
}

export const zavisiNaGovernance = (u: Uloha): boolean =>
  (Array.isArray(u.needs) ? u.needs : [u.needs]).includes("governance-gate");

/** Spustí se úloha, když governance-gate skončila `vysledek` a vše ostatní ukazuje na nasazení? */
export function spustiSePriGovernance(root: string, u: Uloha, vysledek: "success" | "skipped" | "failure"): boolean {
  const vyraz = String(u.if ?? "");
  const svet: Record<string, Hodnota> = { "github.event_name": "push", "github.ref": "refs/heads/main" };
  for (const m of vyraz.matchAll(/needs\.([A-Za-z0-9_-]+)\.result/g)) svet[m[0]] = "success";
  for (const m of vyraz.matchAll(/needs\.detect\.outputs\.([A-Za-z0-9_]+)/g)) svet[m[0]] = "true";
  svet["needs.detect.outputs.already_verified"] = "false";
  svet["needs.detect.outputs.deploy_apps"] = `,${vsechnyAppky(root).join(",")},`;
  svet["needs.governance-gate.result"] = vysledek;
  return vyhodnotit(vyraz, svet);
}
