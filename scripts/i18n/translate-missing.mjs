#!/usr/bin/env node
/**
 * Translate missing i18n segment keys via DeepL API.
 *
 * Usage:
 *   DEEPL_AUTH_KEY=xxx node scripts/i18n/translate-missing.mjs
 *   DEEPL_API_KEY=xxx node scripts/i18n/translate-missing.mjs
 *
 * Only translates keys that exist in EN but are missing in target languages.
 * Never overwrites existing translations.
 *
 * @module
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const SEGMENTS_DIR = "src/i18n/segments";
const CANONICAL = "en";
const DEFAULT_TARGETS = ["cs", "de", "fr", "ru", "th"];
const DEEPL_LANG_MAP = { cs: "CS", de: "DE", fr: "FR", ru: "RU", th: "TH" };
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";

// --retranslate-identical: also translate keys where target value == EN value (untranslated copies)
const RETRANSLATE_IDENTICAL = process.argv.includes("--retranslate-identical");
const LANGS_ARG = process.argv.find((arg) => arg.startsWith("--langs="));
const SEGMENTS_ARG = process.argv.find((arg) => arg.startsWith("--segments="));
const TARGETS = LANGS_ARG
  ? LANGS_ARG
      .replace("--langs=", "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  : DEFAULT_TARGETS;
const SEGMENT_FILTER = SEGMENTS_ARG
  ? SEGMENTS_ARG
      .replace("--segments=", "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  : null;

const authKey =
  process.env.DEEPL_AUTH_KEY ||
  process.env.DEEPL_API_KEY;
if (!authKey) {
  console.error(
    "❌ Missing DeepL key. Set DEEPL_AUTH_KEY or DEEPL_API_KEY. Usage: DEEPL_AUTH_KEY=xxx npm run i18n:segments:translate-missing"
  );
  process.exit(1);
}

/** Flatten nested object to dot-notation keys. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Set a value in nested object by dot-notation key. */
function setNested(obj, dotKey, value) {
  const parts = dotKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in cur) || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Decide whether a (dotted-)key + value pair is "translatable user-facing
 * text" or a system identifier that must NEVER be translated. The script
 * has historically translated URL slugs, JSON IDs, and CSS selectors as
 * if they were user copy — which breaks routing and lookups at runtime.
 *
 * Conservative rule (false positives = leave key as-is, false negatives
 * = letting non-translatable text through to DeepL):
 *
 *   1. Last path segment of dotted key matches a known identifier name:
 *      `slug`, `slugify`, `id`, `key`, `route`, `path`, `href`, `class`,
 *      `className`, `selector`, `name` when the value is identifier-shaped.
 *      Caveat: `name` is heavily used in user-facing JSON too, so we only
 *      skip when the VALUE also looks like an identifier (no whitespace,
 *      lower-kebab / lower-camel).
 *
 *   2. Value is a slug shape — at least one hyphen, no whitespace, length
 *      < 60. Catches `1947-contribution-pipelines-i`, `aisha-rules`,
 *      `default-seed`. (Lengths > 60 are usually sentences with hyphens
 *      around em-dashes, not slugs.)
 *
 *   3. Value looks like a UUID / hash / token. Rare in i18n but cheap to
 *      check.
 */
const IDENTIFIER_KEY_NAMES = new Set([
  "slug",
  "slugify",
  "id",
  "key",
  "route",
  "path",
  "href",
  "class",
  "className",
  "selector",
]);

const NAME_LIKE_KEYS = new Set(["name"]); // skip only when VALUE is identifier-shaped

function lastSegment(dotKey) {
  const idx = dotKey.lastIndexOf(".");
  return idx < 0 ? dotKey : dotKey.slice(idx + 1);
}

function looksLikeIdentifier(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (value.length > 60) return false;
  // Forbidden characters that indicate prose, not identifier
  if (/\s/.test(value)) return false;
  // Slug pattern: at least one hyphen, alphanumeric + hyphen/underscore only
  if (/^[a-zA-Z0-9_-]+$/.test(value) && /-/.test(value)) return true;
  // UUID-ish (8-4-4-4-12 hex)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  return false;
}

// A value that is a literal JSON/code example (e.g. form-field placeholders that
// show the expected JSON shape: `jsonPlaceholder`, `dataPayloadPlaceholder`,
// `styleJsonPlaceholder`) is NOT prose. Translating it reformats/garbles the
// example (DeepL re-spaces `{"a":1}` → `{"a": 1}` and can localise the JSON keys).
// Treat any JSON-parseable object/array value as code → copy verbatim.
function looksLikeJsonValue(value) {
  if (typeof value !== "string") return false;
  const t = value.trim();
  const wrapped =
    (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  if (!wrapped) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function isNonTranslatable(dotKey, value) {
  const last = lastSegment(dotKey);
  if (IDENTIFIER_KEY_NAMES.has(last)) return true;
  // Literal JSON/code examples are never prose — copy verbatim.
  if (looksLikeJsonValue(value)) return true;
  if (NAME_LIKE_KEYS.has(last) && looksLikeIdentifier(value)) return true;
  // Catch any path where the LAST segment ends with `Id`, `Slug`, `Key`,
  // `Route`, `Path`, `Class`, `Href` (camelCase identifier-style names).
  // But ONLY when the VALUE also looks identifier-shaped — otherwise a
  // user-facing label like `missingId: "Missing story id in the URL …"`
  // would be wrongly skipped just because its key name ends in `Id`.
  if (
    /(?:Id|Slug|Key|Route|Path|Class|Href)$/.test(last) &&
    looksLikeIdentifier(value)
  ) {
    return true;
  }
  // Catch values that look like identifiers regardless of key (defence in
  // depth — DeepL has shipped translations like `"Slug" → "Schnecke"` even
  // when the i18n key NAME was a UI label).
  if (looksLikeIdentifier(value)) return true;
  return false;
}

/**
 * Protect i18next interpolation placeholders (`{{name}}`, `{{count}}`, …)
 * from DeepL translation. Without this, DeepL translates the identifier
 * inside `{{ }}` (`{{name}}` → `{{Name}}` in DE, `{{count}}` → `{{Zahl}}`),
 * which breaks runtime substitution because the app code passes the
 * original English identifier as the variable name. The placeholder is a
 * technical identifier, not user text.
 *
 * Strategy: replace each placeholder with a numeric sentinel token
 * (`__PH_0__`, `__PH_1__`, …) that DeepL won't translate (alphanumeric +
 * underscore reads as a code identifier). After translation, map sentinels
 * back to the original placeholders. The numeric index avoids identifier
 * shadowing if the same placeholder appears twice in one string.
 */
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;
function wrapPlaceholders(text) {
  const captured = [];
  const wrapped = text.replace(PLACEHOLDER_RE, (_, inner) => {
    const idx = captured.length;
    captured.push(inner);
    return `__PH_${idx}__`;
  });
  return { wrapped, captured };
}
function unwrapPlaceholders(text, captured) {
  return text.replace(/__PH_(\d+)__/g, (_, idx) => {
    const inner = captured[Number(idx)];
    return inner === undefined ? `__PH_${idx}__` : `{{${inner}}}`;
  });
}

/** Translate texts via DeepL with retry and rate-limit handling. */
async function translateBatch(texts, targetLang) {
  if (targetLang === "EN") return texts; // fallback for unsupported langs

  const batches = [];
  for (let i = 0; i < texts.length; i += 50) {
    batches.push(texts.slice(i, i + 50));
  }

  const results = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    let retries = 0;
    const maxRetries = 5;

    // Wrap placeholders BEFORE sending; remember the captured identifiers
    // per text so we can map sentinel → `{{ident}}` on the way back.
    const wrappedBatch = batch.map((t) => wrapPlaceholders(t));

    while (true) {
      const params = new URLSearchParams();
      for (const w of wrappedBatch) params.append("text", w.wrapped);
      params.append("source_lang", "EN");
      params.append("target_lang", targetLang);
      params.append("preserve_formatting", "1");

      const resp = await fetch(DEEPL_URL, {
          signal: AbortSignal.timeout(30000),
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${authKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (resp.status === 429 || resp.status === 529) {
        retries++;
        if (retries > maxRetries) {
          throw new Error(`DeepL API rate limit after ${maxRetries} retries`);
        }
        const wait = Math.min(2000 * Math.pow(2, retries), 30000);
        console.log(`    ⏳ Rate limited, waiting ${(wait / 1000).toFixed(0)}s (retry ${retries}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`DeepL API error ${resp.status}: ${body}`);
      }

      const data = await resp.json();
      results.push(
        ...data.translations.map((t, idx) =>
          unwrapPlaceholders(t.text, wrappedBatch[idx].captured),
        ),
      );

      // Small delay between batches to avoid rate limiting
      if (bi < batches.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
      break;
    }
  }
  return results;
}

async function main() {
  const segmentFiles = readdirSync(join(SEGMENTS_DIR, CANONICAL)).filter((f) => f.endsWith(".json"));
  const segmentsToProcess = SEGMENT_FILTER ? segmentFiles.filter((f) => SEGMENT_FILTER.includes(f)) : segmentFiles;
  let totalTranslated = 0;
  // Every machine translation we apply, captured for human CONTEXT REVIEW:
  // DeepL has no app/domain/UI context, so its output must be verified, not
  // trusted blindly. Surfaced as a report + console table at the end.
  const review = [];

  for (const lang of TARGETS) {
    if (!(lang in DEEPL_LANG_MAP)) {
      console.warn(`⚠️ Skipping unsupported language '${lang}'`);
      continue;
    }
    const deeplLang = DEEPL_LANG_MAP[lang];
    let langTranslated = 0;

    for (const segFile of segmentsToProcess) {
      const enPath = join(SEGMENTS_DIR, CANONICAL, segFile);
      const langPath = join(SEGMENTS_DIR, lang, segFile);

      const enData = JSON.parse(readFileSync(enPath, "utf8"));
      let langData;
      try {
        langData = JSON.parse(readFileSync(langPath, "utf8"));
      } catch (err) {
        // Missing target-language file is normal on first translation pass —
        // treat as empty so all EN keys get queued for translation.
        console.warn(`[translate-missing] no existing translations at ${langPath} (will translate from scratch):`, err.message);
        langData = {};
      }

      const enFlat = flatten(enData);
      const langFlat = flatten(langData);

      // Find missing keys + optionally keys identical to EN (untranslated copies)
      const missingKeys = Object.keys(enFlat).filter((k) => !(k in langFlat));
      const identicalKeys = RETRANSLATE_IDENTICAL
        ? Object.keys(enFlat).filter(
            (k) =>
              k in langFlat &&
              typeof enFlat[k] === "string" &&
              langFlat[k] === enFlat[k] &&
              lang !== "en"
          )
        : [];
      // Keys explicitly flagged as untranslated with a "[TODO DEEPL]" marker are
      // ALWAYS (re)translated from EN, independent of --retranslate-identical —
      // the marker is a standing request the tool must honour, not skip.
      const todoKeys = Object.keys(enFlat).filter(
        (k) =>
          k in langFlat &&
          typeof langFlat[k] === "string" &&
          langFlat[k].includes("[TODO DEEPL]") &&
          typeof enFlat[k] === "string" &&
          lang !== "en"
      );
      const allCandidates = [...new Set([...missingKeys, ...identicalKeys, ...todoKeys])];

      // Split into "must be translated" and "identifier — copy EN verbatim".
      // Identifiers (slugs, IDs, route segments, etc.) get the EN value
      // copied through unchanged so the JSON structure stays complete but
      // routing / lookup keys remain identical across locales.
      const translatableKeys = [];
      const identifierKeys = [];
      for (const k of allCandidates) {
        if (isNonTranslatable(k, enFlat[k])) {
          identifierKeys.push(k);
        } else {
          translatableKeys.push(k);
        }
      }
      if (translatableKeys.length === 0 && identifierKeys.length === 0) continue;

      // Copy identifiers verbatim (no DeepL call — saves quota + prevents
      // `"slug" → "Schnecke"` style breakage).
      for (const k of identifierKeys) {
        setNested(langData, k, enFlat[k]);
      }

      const textsToTranslate = translatableKeys
        .map((k) => enFlat[k])
        .filter((v) => typeof v === "string");
      const stringKeys = translatableKeys.filter((k) => typeof enFlat[k] === "string");

      if (stringKeys.length === 0) {
        // No translatable strings — just copy non-string values as identifiers
        for (const k of translatableKeys) {
          setNested(langData, k, enFlat[k]);
        }
      } else {
        // Translate user-facing strings
        const translated = await translateBatch(textsToTranslate, deeplLang);
        for (let i = 0; i < stringKeys.length; i++) {
          setNested(langData, stringKeys[i], translated[i]);
          review.push({ seg: segFile, lang, key: stringKeys[i], en: textsToTranslate[i], tr: translated[i] });
        }
        // Copy non-string values from the translatable bucket as well
        for (const k of translatableKeys) {
          if (typeof enFlat[k] !== "string") {
            setNested(langData, k, enFlat[k]);
          }
        }
      }

      writeFileSync(langPath, JSON.stringify(langData, null, 2) + "\n");
      const keysToTranslate = [...translatableKeys, ...identifierKeys];
      const identCount = identicalKeys.filter((k) => keysToTranslate.includes(k)).length;
      const missingCount = keysToTranslate.length - identCount;
      const skippedAsIdentifier = identifierKeys.length;
      const parts = [];
      if (missingCount > 0) parts.push(`+${missingCount} missing`);
      if (skippedAsIdentifier > 0) parts.push(`(${skippedAsIdentifier} kept as identifier)`);
      if (identCount > 0) parts.push(`~${identCount} retranslated`);
      console.log(`  ${lang}/${segFile}: ${parts.join(", ")}`);
      langTranslated += keysToTranslate.length;
    }

    if (langTranslated > 0) {
      console.log(`✅ ${lang}: ${langTranslated} keys translated`);
    } else {
      console.log(`✅ ${lang}: already in sync`);
    }
    totalTranslated += langTranslated;
  }

  console.log(`\n🌍 Total: ${totalTranslated} keys translated across ${TARGETS.length} languages`);

  // ── CONTEXT-REVIEW OUTPUT ──────────────────────────────────────────────────
  // DeepL translates strings in isolation and has no idea this is a page-builder
  // / admin / domain UI, so it routinely picks the wrong sense (e.g. "loop" →
  // "технологический контур", "card" → "บัตร"/ID-card, "signal" → road-signage).
  // We APPLY the machine output (so nothing is left blank) but emit every line
  // here so a human — or a context-aware follow-up pass — can verify and fix the
  // wrong ones in src/i18n/segments/<lang>/<file>, then re-run `npm run i18n:check`.
  if (review.length > 0) {
    const byKey = {};
    for (const r of review) {
      const id = `${r.seg} · ${r.key}`;
      (byKey[id] ??= { en: r.en, langs: {} }).langs[r.lang] = r.tr;
    }
    const md = [
      "# DeepL translation review",
      "",
      "> Machine-translated by DeepL — **no app/domain/UI context**. Review each",
      "> row; fix the wrong ones in `src/i18n/segments/<lang>/<file>` and re-run",
      "> `npm run i18n:check`. (Tip: append `[TODO DEEPL]` to a value to force a",
      "> re-translation on the next run.)",
      "",
    ];
    for (const [id, v] of Object.entries(byKey)) {
      md.push(`### \`${id}\``, `- **en**: ${v.en}`);
      for (const [lang, tr] of Object.entries(v.langs)) md.push(`- ${lang}: ${tr}`);
      md.push("");
    }
    const reportDir = process.env.AISHA_REPORT_DIR || "/tmp/aisha-reports/i18n";
    let reportPath = "";
    try {
      mkdirSync(reportDir, { recursive: true });
      reportPath = join(reportDir, "translate-review.md");
      writeFileSync(reportPath, md.join("\n") + "\n");
    } catch (err) {
      console.warn(`[translate-missing] could not write review report: ${err.message}`);
    }
    console.log(
      `\n⚠️  ${review.length} machine translation(s) need CONTEXT REVIEW — DeepL has no domain context.`,
    );
    if (reportPath) console.log(`   Full report: ${reportPath}`);
    for (const [id, v] of Object.entries(byKey)) {
      console.log(`\n  ${id}\n    en: ${v.en}`);
      for (const [lang, tr] of Object.entries(v.langs)) console.log(`    ${lang}: ${tr}`);
    }
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
