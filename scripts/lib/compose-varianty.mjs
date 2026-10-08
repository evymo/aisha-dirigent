#!/usr/bin/env node
/**
 * compose-varianty.mjs — varianty compose podle slotu (`compose_gpu` v katalogu).
 *
 * Varianta NENÍ samostatná aplikace: nasazuje ji aplikace služby, která ji v katalogu nese,
 * když služba stojí na slotu s has_gpu (tenký stack forku na sdíleném GPU uzlu). Manifest
 * instance ji volí řádkem té služby (`app: <id>:<slot gpu>:<compose_gpu>`).
 *
 * JEDEN domov pro všechny, kdo procházejí compose soubory a z nepokrytých dělají aplikace nebo
 * sirotky: generátor manifestu (gen-instance-manifest.mjs), doktor (cold-start-doctor.sh,
 * sirotčí compose) a brány manifest-nezaklada-sirotky a stack-bez-deploy-ulohy. Kdyby si to
 * každý vyložil sám, vznikla by falešná aplikace `<x>-gpu` jen v části nástrojů.
 *
 * CLI: vypíše compose varianty, jeden na řádek (pro bash).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @returns {Map<string, string>} compose varianty → id služby, která ji nese */
export function variantyCompose(sluzby = JSON.parse(readFileSync(join(KOREN, "config/services.json"), "utf8")).services) {
  const out = new Map();
  for (const [id, s] of Object.entries(sluzby ?? {})) {
    if (typeof s?.compose_gpu === "string" && s.compose_gpu) out.set(s.compose_gpu, id);
  }
  return out;
}

if (isDirectRun(import.meta.url)) {
  for (const compose of variantyCompose().keys()) process.stdout.write(`${compose}\n`);
}
