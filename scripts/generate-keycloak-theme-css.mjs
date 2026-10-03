#!/usr/bin/env node
/**
 * Generate Keycloak login theme CSS variables from a branding profile JSON.
 *
 * Usage:
 *   node scripts/generate-keycloak-theme-css.mjs [branding-profile.json]
 *
 * When run without arguments, fetches the published global profile from the
 * local Supabase instance. Output is written to stdout.
 *
 * The generated CSS is a `:root` override block intended to be appended or
 * included after the base aisha.css theme — it remaps --aisha-* variables
 * to values derived from the branding profile.
 *
 * @module scripts/generate-keycloak-theme-css
 */

import { readFileSync } from "node:fs";

// ── HSL conversion helpers ──────────────────────────────
/**
 * Convert "H S% L%" string to hex color.
 * @param {string} hsl - HSL triplet like "23 100% 55%"
 * @returns {string} Hex color like "#ff6a1a"
 */
function hslToHex(hsl) {
  const parts = hsl.match(/(\d+)\s+(\d+)%\s+(\d+)%/);
  if (!parts) return "#888888";

  const h = parseInt(parts[1], 10) / 360;
  const s = parseInt(parts[2], 10) / 100;
  const l = parseInt(parts[3], 10) / 100;

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert HSL to rgba string with given alpha.
 * @param {string} hsl
 * @param {number} alpha
 * @returns {string}
 */
function hslToRgba(hsl, alpha) {
  const hex = hslToHex(hsl);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Lighten or darken an HSL string by adjusting lightness.
 * @param {string} hsl
 * @param {number} delta - positive = lighter, negative = darker
 * @returns {string}
 */
function adjustLightness(hsl, delta) {
  const parts = hsl.match(/(\d+)\s+(\d+)%\s+(\d+)%/);
  if (!parts) return hsl;
  const h = parseInt(parts[1], 10);
  const s = parseInt(parts[2], 10);
  const l = Math.max(0, Math.min(100, parseInt(parts[3], 10) + delta));
  return `${h} ${s}% ${l}%`;
}

// ── Main ────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} profile
 * @returns {string} CSS text
 */
function generateKeycloakCssOverride(profile) {
  const primary = profile.color_primary ?? "23 100% 55%";
  const bg = profile.login_background_color ?? profile.dark_color_background ?? "0 0% 10%";
  const accent = profile.login_accent_color ?? primary;
  const cardBg = profile.login_card_bg ?? hslToRgba(adjustLightness(bg, 6), 0.85);
  const fg = profile.dark_color_foreground ?? "0 0% 98%";
  const fontBrand = profile.font_family_brand ?? "Nunito Sans, sans-serif";

  const primaryHex = hslToHex(primary);
  const accentHex = hslToHex(accent);
  const bgHex = hslToHex(bg);
  const bgLightHex = hslToHex(adjustLightness(bg, 6));
  const bgDarkHex = hslToHex(adjustLightness(bg, -4));

  return `/*
 * Auto-generated Keycloak theme CSS variables
 * Generated from branding profile: ${profile.operator_name ?? "Global"}
 * Do not edit manually — regenerate via: node scripts/generate-keycloak-theme-css.mjs
 */

:root {
  --aisha-ink: ${bgHex};
  --aisha-ink-light: ${bgLightHex};
  --aisha-ink-dark: ${bgDarkHex};
  --aisha-orange: ${primaryHex};
  --aisha-orange-light: ${hslToHex(adjustLightness(primary, 10))};
  --aisha-orange-dark: ${hslToHex(adjustLightness(primary, -8))};
  --aisha-orange-pale: ${hslToHex(adjustLightness(primary, 30))};
  --aisha-card-bg: ${typeof cardBg === "string" && cardBg.startsWith("rgba") ? cardBg : hslToRgba(cardBg, 0.85)};
  --aisha-card-border: ${hslToRgba(primary, 0.15)};
  --aisha-text: ${hslToHex(fg)};
  --aisha-text-muted: rgba(255, 255, 255, 0.6);
  --aisha-text-subtle: rgba(255, 255, 255, 0.4);
  --aisha-input-bg: ${hslToRgba(adjustLightness(bg, -8), 0.6)};
  --aisha-input-border: ${hslToRgba(primary, 0.25)};
  --aisha-border: ${hslToHex(adjustLightness(bg, 15))};
}

body,
.login-pf {
  font-family: '${fontBrand.split(",")[0].trim().replace(/['"]/g, "")}', system-ui, -apple-system, sans-serif !important;
}
`;
}

// ── CLI entry point ─────────────────────────────────────
const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node scripts/generate-keycloak-theme-css.mjs <branding-profile.json>");
  console.error("  Reads a JSON file with branding profile fields and outputs CSS to stdout.");
  process.exit(1);
}

try {
  const raw = readFileSync(inputPath, "utf-8");
  const profile = JSON.parse(raw);
  process.stdout.write(generateKeycloakCssOverride(profile));
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
