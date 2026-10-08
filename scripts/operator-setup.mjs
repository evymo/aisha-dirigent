#!/usr/bin/env node
// =============================================================================
// operator-setup.mjs — local install/verify workbench for an AISHA instance
// =============================================================================
// One turnkey entrypoint for an operator standing up (or forking) an instance:
//
//   node scripts/operator-setup.mjs               interactive: prompt for the
//                                                 MISSING required inputs, write
//                                                 .env.local, then verify.
//   node scripts/operator-setup.mjs --check       non-interactive: report which
//                                                 required inputs are still
//                                                 missing (exit 1 if any).
//   node scripts/operator-setup.mjs --verify      run local preflight only
//                                                 (env-doctor; --deep also runs a
//                                                 throwaway-DB cold-start check).
//   node scripts/operator-setup.mjs --json        print the input schema as JSON
//                                                 (contract for the IDE add-on /
//                                                 a web workbench).
//   node scripts/operator-setup.mjs --print-env-example
//                                                 emit config/fork-instance-inputs.env.example
//
// Reads existing values from every source cold-start reads — process.env,
// .env-prod-backup (secrets home) and .env.local — so "present" reflects a REAL
// deploy, not just a local test. Writes secrets → .env-prod-backup and non-secret
// config → .env.local (both gitignored, mode 600); secrets are read masked and
// never echoed back or committed. Everything the stack generates/derives for
// itself is NOT asked here.
// =============================================================================
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import {
  OPERATOR_INPUTS,
  CATEGORIES,
  requiredInputs,
  byCategory,
  toJson,
  renderEnvExample,
} from "./lib/operator-inputs.mjs";
import { KOD_ENV_DOKTORA_WEB_NEVIM } from "./lib/domenovy-overlay.mjs";

const ROOT = process.cwd();
const ENV_LOCAL = join(ROOT, ".env.local");
const ENV_PROD_BACKUP = join(ROOT, ".env-prod-backup"); // secrets home — cold-start reads it
const ENV_MAIN = join(ROOT, ".env");
// Every file cold-start reads config from, so "present" reflects a REAL deploy
// and not just a local .env.local. Order = precedence low→high (process.env wins).
const ENV_SOURCES = [ENV_MAIN, ENV_PROD_BACKUP, ENV_LOCAL];
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

// ── env parsing ──────────────────────────────────────────────────────────────
function parseEnvFile(path) {
  const map = {};
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    val = val.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
    map[key] = val;
  }
  return map;
}

/** A key is "present" if a non-empty value exists in process.env or ANY env file
 *  cold-start reads (.env, .env-prod-backup, .env.local) — so the workbench
 *  reflects a REAL deploy, not just a local .env.local test setup. */
function knownValues() {
  const merged = {};
  for (const src of ENV_SOURCES) Object.assign(merged, parseEnvFile(src));
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== "") merged[k] = v;
  }
  return merged;
}

/** Env-var inputs only (file inputs are handled out of band). */
function envInput(i) {
  return !i.file;
}

function missingRequired(known) {
  return requiredInputs()
    .filter(envInput)
    .filter((i) => !known[i.key] || known[i.key] === "");
}

// ── prompts ──────────────────────────────────────────────────────────────────
function question(rl, prompt, { secret = false } = {}) {
  return new Promise((resolve) => {
    if (!secret) {
      rl.question(prompt, (a) => resolve(a));
      return;
    }
    // Masked: write the prompt, then swallow the echo of every typed
    // character so the secret never appears on screen (or in scrollback).
    const origWrite = rl.output.write.bind(rl.output);
    rl.question(prompt, (a) => {
      rl.output.write = origWrite;
      origWrite("\n");
      resolve(a);
    });
    rl.output.write = () => true; // prompt already printed by rl.question above
  });
}

async function interactiveSetup(known) {
  const missing = missingRequired(known);
  if (missing.length === 0) {
    console.log("✅ All required operator inputs are present. Nothing to prompt.");
    return {};
  }
  if (!process.stdin.isTTY) {
    console.error(
      `✗ ${missing.length} required input(s) missing and no TTY to prompt: ` +
        missing.map((i) => i.key).join(", ") +
        "\n  Set them in .env-prod-backup (secrets) / .env.local (config) / the environment, or run interactively.",
    );
    process.exit(1);
  }
  console.log("\nAISHA instance setup — answer the MISSING required inputs (Ctrl-C to abort).\n");
  console.log("Everything else (all secrets + every domain the stack needs to run itself) is");
  console.log("generated or derived — you are only asked for what a fork must decide.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const collected = {};
  const groups = byCategory();
  for (const [cat, meta] of Object.entries(CATEGORIES)) {
    const catMissing = (groups[cat] || []).filter((i) => missing.includes(i));
    if (!catMissing.length) continue;
    console.log(`\n── ${meta}`);
    for (const i of catMissing) {
      const hint = i.example ? ` (e.g. ${i.secret ? "•••" : i.example})` : "";
      const ans = (await question(rl, `  ${i.label} [${i.key}]${hint}: `, { secret: i.secret })).trim();
      if (ans) collected[i.key] = ans;
    }
  }
  rl.close();
  return collected;
}

const SECRET_KEYS = new Set(OPERATOR_INPUTS.filter((i) => i.secret && !i.file).map((i) => i.key));

/** Persist collected inputs where cold-start expects them: secrets → the
 *  .env-prod-backup secrets home, non-secret config → .env.local. Both gitignored,
 *  mode 600. Only NEW keys are appended (never overwrites an existing value). */
function persistCollected(collected) {
  if (Object.keys(collected).length === 0) return;
  const targets = [
    { file: ENV_PROD_BACKUP, name: ".env-prod-backup", want: (k) => SECRET_KEYS.has(k),
      header: "# Operator secrets — gitignored. cold-start reads this. Written by operator-setup.mjs.\n" },
    { file: ENV_LOCAL, name: ".env.local", want: (k) => !SECRET_KEYS.has(k),
      header: "# Operator config — gitignored. Written by operator-setup.mjs.\n" },
  ];
  for (const t of targets) {
    const existingKeys = new Set(Object.keys(parseEnvFile(t.file)));
    const additions = Object.entries(collected)
      .filter(([k]) => t.want(k) && !existingKeys.has(k))
      .map(([k, v]) => `${k}=${v}`);
    if (additions.length === 0) continue;
    const existing = existsSync(t.file) ? readFileSync(t.file, "utf8").replace(/\s*$/, "\n") : "";
    writeFileSync(t.file, (existing ? "" : t.header) + existing + additions.join("\n") + "\n", { mode: 0o600 });
    console.log(`✅ Wrote ${additions.length} value(s) to ${t.name} (mode 600).`);
  }
}

// ── verify (local preflight) ─────────────────────────────────────────────────
function runVerify({ deep }) {
  console.log("\n── Local preflight ─────────────────────────────────────────");
  let ok = true;

  const doctor = join("scripts", "aisha-env-doctor.mjs");
  if (existsSync(join(ROOT, doctor))) {
    console.log("• env-doctor (contract completeness) …");
    const r = spawnSync(process.execPath, [doctor], { cwd: ROOT, stdio: "inherit" });
    // Kód KOD_ENV_DOKTORA_WEB_NEVIM = env-doktor kontrakt doplnil, jen WEB_FQDNS
    // (domény webu) nezná. Na instalaci před prvním cold-startem je to vždy —
    // klíč smí založit jen cold-start (výslovný požadavek na doménový overlay).
    // Přijímá se PRÁVĚ tenhle kód (jako src/tests/gates/_env-doktor-dokoncil.ts),
    // jiná nenula (2 = pád doktora) zůstává selháním ověření.
    if (r.status === KOD_ENV_DOKTORA_WEB_NEVIM) {
      console.log(
        "  ℹ env-doctor: WEB_FQDNS (domény webu) zatím neznám — založí ho první cold-start; " +
          "po cold-startu viz příčina ve výpisu výš.",
      );
    }
    ok = ok && (r.status === 0 || r.status === KOD_ENV_DOKTORA_WEB_NEVIM);
  } else {
    console.log("• env-doctor not found — skipping");
  }

  if (deep) {
    const tdb = join("scripts", "db", "with-throwaway-db.mjs");
    const applyCheck = join("scripts", "db", "verify-cold-start-apply.sh");
    if (existsSync(join(ROOT, tdb)) && existsSync(join(ROOT, applyCheck))) {
      console.log("• throwaway-DB cold-start apply (baseline + heals + FK + pgTAP) …");
      const r = spawnSync(process.execPath, [tdb, "bash", applyCheck], { cwd: ROOT, stdio: "inherit" });
      ok = ok && r.status === 0;
    } else {
      console.log("• throwaway-DB check unavailable — skipping (needs Docker + scripts/db/*)");
    }
  } else {
    console.log("• (pass --deep to also run the throwaway-DB cold-start apply check)");
  }

  console.log(ok ? "\n✅ Preflight passed." : "\n✗ Preflight reported problems — see output above.");
  return ok;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (has("--json")) {
    process.stdout.write(JSON.stringify(toJson(), null, 2) + "\n");
    return;
  }
  if (has("--print-env-example")) {
    process.stdout.write(renderEnvExample());
    return;
  }

  const known = knownValues();

  if (has("--check")) {
    const missing = missingRequired(known);
    if (missing.length === 0) {
      console.log("✅ All required operator inputs are present.");
      return;
    }
    console.error(`✗ ${missing.length} required input(s) missing:`);
    for (const i of missing) console.error(`   ${i.key} — ${i.label} (${i.description})`);
    process.exit(1);
  }

  if (has("--verify")) {
    process.exit(runVerify({ deep: has("--deep") }) ? 0 : 1);
  }

  // Default: interactive setup, then offer verify.
  const collected = await interactiveSetup(known);
  persistCollected(collected);
  if (!has("--no-verify")) runVerify({ deep: has("--deep") });
  console.log("\nNext steps:");
  console.log("  1. deploy         bash scripts/aisha-cold-start.sh");
  console.log("  2. verify (prod)  npm run cold-start:verify   (read-only probe of the live instance)");
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
