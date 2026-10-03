/**
 * i18n integrity test for builder segments.
 *
 * Verifies that every i18n key referenced by the block registry
 * exists in all 6 supported language segments.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { CANVAS_BLOCK_REGISTRY } from "@/lib/builder/blockRegistry";
import { RUNTIME_BLOCK_DEFINITIONS } from "@/lib/builder/blockRegistry.runtime-blocks";

import en from "@/i18n/segments/en/builder.json";
import cs from "@/i18n/segments/cs/builder.json";
import de from "@/i18n/segments/de/builder.json";
import fr from "@/i18n/segments/fr/builder.json";
import ru from "@/i18n/segments/ru/builder.json";
import th from "@/i18n/segments/th/builder.json";

// =====================================================
// Helpers
// =====================================================

/** Resolve dot-notation key from nested object */
function resolveKey(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

const LANGUAGES: Record<string, Record<string, unknown>> = { cs, de, en, fr, ru, th };

/**
 * Every i18n key referenced by a RUNTIME block — name, description, config-field
 * labels, and select-option labels. The gate historically iterated only
 * CANVAS_BLOCK_REGISTRY, leaving every runtime block (hero-slides … discussion-thread)
 * i18n-unchecked — a structural blind spot that let the discussion-thread keys ship
 * missing. This collector closes the root class.
 */
function runtimeBlockI18nKeys(): string[] {
  const keys: string[] = [];
  for (const block of RUNTIME_BLOCK_DEFINITIONS) {
    keys.push(block.nameKey, block.descriptionKey);
    for (const field of block.configFields ?? []) {
      keys.push(field.labelKey);
      for (const opt of field.options ?? []) keys.push(opt.labelKey);
    }
  }
  return [...new Set(keys)];
}

// =====================================================
// Tests
// =====================================================

describe("builder i18n segment integrity", () => {
  it("all block nameKeys exist in all 6 languages", () => {
    const missing: string[] = [];

    for (const block of CANVAS_BLOCK_REGISTRY) {
      for (const [lang, data] of Object.entries(LANGUAGES)) {
        if (resolveKey(data, block.nameKey) === undefined) {
          missing.push(`${lang}: ${block.nameKey}`);
        }
      }
    }

    expect(missing, `Missing i18n keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("all block descriptionKeys exist in all 6 languages", () => {
    const missing: string[] = [];

    for (const block of CANVAS_BLOCK_REGISTRY) {
      for (const [lang, data] of Object.entries(LANGUAGES)) {
        if (resolveKey(data, block.descriptionKey) === undefined) {
          missing.push(`${lang}: ${block.descriptionKey}`);
        }
      }
    }

    expect(missing, `Missing i18n keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("all RUNTIME-block i18n keys (name/description/config/options) exist in all 6 languages", () => {
    const missing: string[] = [];

    for (const key of runtimeBlockI18nKeys()) {
      for (const [lang, data] of Object.entries(LANGUAGES)) {
        if (resolveKey(data, key) === undefined) {
          missing.push(`${lang}: ${key}`);
        }
      }
    }

    expect(missing, `Missing runtime-block i18n keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("category keys exist in all 6 languages", () => {
    const categoryKeys = ["builder.categories.web", "builder.categories.workflow"];
    const missing: string[] = [];

    for (const key of categoryKeys) {
      for (const [lang, data] of Object.entries(LANGUAGES)) {
        if (resolveKey(data, key) === undefined) {
          missing.push(`${lang}: ${key}`);
        }
      }
    }

    expect(missing, `Missing category keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("panel keys exist in all 6 languages", () => {
    const panelKeys = [
      "builder.panels.activity",
      "builder.panels.blocks",
      "builder.panels.properties",
    ];
    const missing: string[] = [];

    for (const key of panelKeys) {
      for (const [lang, data] of Object.entries(LANGUAGES)) {
        if (resolveKey(data, key) === undefined) {
          missing.push(`${lang}: ${key}`);
        }
      }
    }

    expect(missing, `Missing panel keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no i18n value is empty string in any language", () => {
    const empty: string[] = [];

    for (const block of CANVAS_BLOCK_REGISTRY) {
      for (const key of [block.nameKey, block.descriptionKey]) {
        for (const [lang, data] of Object.entries(LANGUAGES)) {
          const val = resolveKey(data, key);
          if (typeof val === "string" && val.trim() === "") {
            empty.push(`${lang}: ${key}`);
          }
        }
      }
    }

    expect(empty, `Empty i18n values:\n${empty.join("\n")}`).toEqual([]);
  });

  it("EN segment has all keys used by the builder", () => {
    const requiredKeys = [
      // Status keys
      "builder.status.loading",
      "builder.status.saving",
      "builder.status.saved",
      "builder.status.error",
      // Action keys
      "builder.actions.save",
      "builder.actions.publish",
      "builder.actions.undo",
      "builder.actions.redo",
    ];
    const missing: string[] = [];

    for (const key of requiredKeys) {
      if (resolveKey(en, key) === undefined) {
        missing.push(key);
      }
    }

    expect(missing, `Missing required EN keys:\n${missing.join("\n")}`).toEqual([]);
  });
});
