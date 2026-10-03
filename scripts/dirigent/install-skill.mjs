#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { ROOT } from "./config.mjs";

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const sourceDir = path.join(ROOT, "codex", "skills", "aisha-dirigent-autopilot");
const targetDir = path.join(codexHome, "skills", "aisha-dirigent-autopilot");

/**
 * Recursively list files in a directory as paths relative to `dir`, sorted.
 * Returns [] for a non-existent directory.
 */
function listFilesRel(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

/**
 * True when two directory trees have byte-identical file sets.
 */
function dirsIdentical(a, b) {
  const filesA = listFilesRel(a);
  const filesB = listFilesRel(b);
  if (filesA.length !== filesB.length) return false;
  for (let i = 0; i < filesA.length; i++) {
    if (filesA[i] !== filesB[i]) return false;
    const pathA = path.join(a, filesA[i]);
    const pathB = path.join(b, filesB[i]);
    if (statSync(pathA).size !== statSync(pathB).size) return false;
    if (!readFileSync(pathA).equals(readFileSync(pathB))) return false;
  }
  return true;
}

mkdirSync(path.dirname(targetDir), { recursive: true });

if (existsSync(targetDir)) {
  // Skip-if-identical: an unchanged reinstall never touches the target dir or
  // burns a backup slot.
  if (dirsIdentical(sourceDir, targetDir)) {
    process.stdout.write(`Skill already installed (identical) at ${targetDir}\n`);
    process.exit(0);
  }

  // Back up the existing target dir (timestamped) BEFORE the force-overwrite so
  // any user edits to the installed skill are recoverable. cpSync({force:true})
  // would otherwise silently clobber them.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${targetDir}.bak-${stamp}`;
  cpSync(targetDir, backupDir, { recursive: true });
  process.stdout.write(`Backed up existing skill to ${backupDir}\n`);
}

cpSync(sourceDir, targetDir, { recursive: true, force: true });

process.stdout.write(`Installed skill to ${targetDir}\n`);
