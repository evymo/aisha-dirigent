#!/usr/bin/env node
/**
 * seed-storage.mjs — Seeds Supabase storage buckets with default folder structure.
 *
 * Usage:
 *   node scripts/db/seed-storage.mjs
 *
 * Requires AISHA_POSTGREST_URL and AISHA_POSTGREST_SERVICE_KEY env vars.
 */

const FOLDER_MAPPING = {
  "archive-scans": ["documents", "reports", "exports"],
  avatars: ["profiles", "partners"],
  attachments: ["chat", "stories"],
};

const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL ?? "http://127.0.0.1:3001";
const SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error("AISHA_POSTGREST_SERVICE_KEY is required");
  process.exit(1);
}

async function seedFolders() {
  for (const [bucket, folders] of Object.entries(FOLDER_MAPPING)) {
    for (const folder of folders) {
      const placeholder = `${folder}/.gitkeep`;
      const url = `${AISHA_POSTGREST_URL}/storage/v1/object/${bucket}/${placeholder}`;

      const res = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        },
        body: "",
      });

      if (res.ok) {
        console.log(`✅ ${bucket}/${folder}`);
      } else {
        const text = await res.text();
        console.warn(`⚠️  ${bucket}/${folder}: ${res.status} ${text}`);
      }
    }
  }
}

seedFolders().catch((err) => {
  console.error("Seed storage failed:", err);
  process.exit(1);
});
