/**
 * Fill a web-template's i18n.json with DeepL — and SURFACE the output for review.
 *
 * Template i18n.json shape (self-contained, consumed by export-web-seed):
 *   { "web.x.title": { "en": "...", "cs": "...", "de": "..." }, ... }
 *
 * EN is the source; CS is hand-authored. This fills the remaining target
 * locales (de/fr/ru/th) for keys that have EN but are missing the target, then
 * writes a CONTEXT-REVIEW report — DeepL has no app/domain/UI context, so its
 * output must be verified, not trusted blindly (same principle as
 * scripts/i18n/translate-missing.mjs).
 *
 * Usage:
 *   DEEPL_API_KEY=xxx node scripts/i18n/translate-template-i18n.mjs <template-dir> [--langs=de,fr,ru,th]
 *   e.g.  ... domains/templates/garden-blog
 *
 * @module
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DEEPL_URL = "https://api-free.deepl.com/v2/translate";
const DEEPL_LANG_MAP = { cs: "CS", de: "DE", fr: "FR", ru: "RU", th: "TH", it: "IT", es: "ES" };
const authKey = process.env.DEEPL_AUTH_KEY || process.env.DEEPL_API_KEY;

const dirArg = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);
const langsArg = process.argv.find((a) => a.startsWith("--langs="));
const TARGETS = langsArg ? langsArg.replace("--langs=", "").split(",").map((s) => s.trim()).filter(Boolean) : ["de", "fr", "ru", "th"];

if (!authKey) { console.error("❌ Missing DeepL key. Set DEEPL_AUTH_KEY or DEEPL_API_KEY."); process.exit(1); }
if (!dirArg) { console.error("❌ Usage: node scripts/i18n/translate-template-i18n.mjs <template-dir>"); process.exit(1); }

const i18nPath = join(dirArg, "i18n.json");
const data = JSON.parse(readFileSync(i18nPath, "utf8"));
const keys = Object.keys(data).filter((k) => !k.startsWith("_") && data[k] && typeof data[k] === "object");

/** Translate texts via DeepL (batched, retry on rate-limit). */
async function translateBatch(texts, targetLang) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    let retries = 0;
    while (true) {
      const params = new URLSearchParams();
      for (const t of batch) params.append("text", t);
      params.append("source_lang", "EN");
      params.append("target_lang", targetLang);
      params.append("preserve_formatting", "1");
      const resp = await fetch(DEEPL_URL, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `DeepL-Auth-Key ${authKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (resp.status === 429 || resp.status === 529) {
        if (++retries > 5) throw new Error("DeepL rate limit after 5 retries");
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** retries, 30000)));
        continue;
      }
      if (!resp.ok) throw new Error(`DeepL ${resp.status}: ${await resp.text()}`);
      const json = await resp.json();
      out.push(...json.translations.map((t) => t.text));
      break;
    }
  }
  return out;
}

const review = [];
let total = 0;

for (const lang of TARGETS) {
  if (!(lang in DEEPL_LANG_MAP)) { console.warn(`⚠️ skip unsupported '${lang}'`); continue; }
  const todo = keys.filter((k) => typeof data[k].en === "string" && !(lang in data[k]));
  if (todo.length === 0) { console.log(`✅ ${lang}: already complete`); continue; }
  const translated = await translateBatch(todo.map((k) => data[k].en), DEEPL_LANG_MAP[lang]);
  todo.forEach((k, i) => {
    data[k][lang] = translated[i];
    review.push({ key: k, lang, en: data[k].en, tr: translated[i] });
  });
  total += todo.length;
  console.log(`  ${lang}: +${todo.length} translated`);
}

writeFileSync(i18nPath, JSON.stringify(data, null, 2) + "\n");
console.log(`\n🌍 Total: ${total} values translated → ${i18nPath}`);

// ── CONTEXT-REVIEW OUTPUT ── never ship machine translation blind.
if (review.length > 0) {
  const byKey = {};
  for (const r of review) (byKey[r.key] ??= { en: r.en, langs: {} }).langs[r.lang] = r.tr;
  const md = [
    `# DeepL translation review — ${dirArg}`,
    "",
    "> Machine-translated by DeepL — **no app/domain/UI context**. Verify each",
    `> row and fix the wrong ones in \`${i18nPath}\`.`,
    "",
  ];
  for (const [k, v] of Object.entries(byKey)) {
    md.push(`### \`${k}\``, `- **en**: ${v.en}`);
    for (const [lang, tr] of Object.entries(v.langs)) md.push(`- ${lang}: ${tr}`);
    md.push("");
  }
  const reportDir = process.env.AISHA_REPORT_DIR || "/tmp/aisha-reports/i18n";
  let reportPath = "";
  try {
    mkdirSync(reportDir, { recursive: true });
    reportPath = join(reportDir, "template-translate-review.md");
    writeFileSync(reportPath, md.join("\n") + "\n");
  } catch (err) { console.warn(`could not write report: ${err.message}`); }
  console.log(`\n⚠️  ${review.length} machine translation(s) need CONTEXT REVIEW — DeepL has no domain context.`);
  if (reportPath) console.log(`   Full report: ${reportPath}`);
  for (const [k, v] of Object.entries(byKey)) {
    console.log(`\n  ${k}\n    en: ${v.en}`);
    for (const [lang, tr] of Object.entries(v.langs)) console.log(`    ${lang}: ${tr}`);
  }
}
