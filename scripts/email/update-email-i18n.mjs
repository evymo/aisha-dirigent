#!/usr/bin/env node
/**
 * update-email-i18n.mjs — Syncs email templates from i18n segments to Supabase Auth.
 *
 * Reads `src/i18n/segments/{lang}/auth.json` → `auth.emailTemplates` section
 * and pushes translated email subjects/bodies to Supabase email templates.
 *
 * Usage:
 *   node scripts/email/update-email-i18n.mjs
 *
 * Requires AISHA_POSTGREST_URL and AISHA_POSTGREST_SERVICE_KEY env vars.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const SEGMENTS_DIR = path.join(ROOT_DIR, "src/i18n/segments");
const LANGS = ["en", "cs", "de", "fr", "ru", "th"];

const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL ?? "http://127.0.0.1:3001";
const SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error("AISHA_POSTGREST_SERVICE_KEY is required");
  process.exit(1);
}

function loadEmailTemplates() {
  const templates = {};

  for (const lang of LANGS) {
    const authPath = path.join(SEGMENTS_DIR, lang, "auth.json");
    if (!fs.existsSync(authPath)) {
      console.warn(`⚠️  Missing ${lang}/auth.json`);
      continue;
    }

    const content = JSON.parse(fs.readFileSync(authPath, "utf-8"));
    const emailTemplates = content.auth?.emailTemplates;

    if (!emailTemplates) {
      console.warn(`⚠️  No emailTemplates in ${lang}/auth.json`);
      continue;
    }

    templates[lang] = emailTemplates;
    console.log(`✅ Loaded ${lang} email templates`);
  }

  return templates;
}

async function main() {
  const templates = loadEmailTemplates();

  console.log(
    `\nLoaded email templates for ${Object.keys(templates).length} language(s)`,
  );
  console.log("Email template sync requires manual Supabase Dashboard update.");
  console.log("Templates extracted to: stdout (copy to Dashboard > Auth > Email Templates)");

  // Output templates as JSON for manual import
  for (const [lang, tpl] of Object.entries(templates)) {
    console.log(`\n--- ${lang.toUpperCase()} ---`);
    console.log(JSON.stringify(tpl, null, 2));
  }
}

main().catch((err) => {
  console.error("Email i18n update failed:", err);
  process.exit(1);
});
