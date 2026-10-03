/**
 * GrapesJS plugin that registers all Aisha canvas blocks with variant support.
 *
 * Reads from the V2 block registry and adds each block to the
 * GrapesJS editor with i18n labels resolved via the provided
 * translation function. Each block type gets a "variant" trait
 * that allows switching between content variants.
 *
 * @module
 */

import type { Component, Editor } from "grapesjs";
import {
  CANVAS_BLOCK_REGISTRY_V2,
  RUNTIME_BLOCK_DEFINITIONS,
  type BlockCategory,
  type CanvasBlockEntryV2,
  // V1 compat
  CANVAS_BLOCK_REGISTRY,
} from "./blockRegistry";
import type { RuntimeConfigField } from "./blockRegistry.types";
import { COLOR_SCHEME_REGISTRY, getColorScheme } from "./colorSchemeRegistry";
import {
  WEB_I18N_ATTRIBUTE_BINDINGS,
  firstTextI18nKey,
} from "./webI18nBindings";

/** i18n-aware category labels */
const CATEGORY_KEYS: Record<BlockCategory, string> = {
  web: "builder.categories.web",
  workflow: "builder.categories.workflow",
};

/**
 * Plugin options for the Aisha blocks plugin.
 */
export interface AishaBlocksPluginOptions {
  /** Translation function — typically `t` from react-i18next */
  t: (key: string) => string;
}

/**
 * Extract data-i18n-key → textContent pairs from a GrapesJS component tree.
 * Used before variant switch to preserve user-edited text.
 */
function extractI18nTexts(component: Component): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (c: Component) => {
    const attrs = c.getAttributes();
    const textKey = firstTextI18nKey(attrs);
    if (textKey) {
      // Get the inner text content (first text child or component content)
      const content = c.content;
      if (typeof content === "string" && content.trim()) {
        map.set(textKey, content);
      }
    }
    // Preserve attribute-bound translations (placeholder/title/aria-label/alt)
    for (const binding of WEB_I18N_ATTRIBUTE_BINDINGS) {
      const key = attrs[binding.keyAttr];
      if (typeof key === "string" && key.trim()) {
        const value = attrs[binding.targetAttr];
        if (typeof value === "string" && value.trim()) {
          map.set(key.trim(), value);
        }
      }
    }
    c.components().forEach((child: Component) => walk(child));
  };
  walk(component);
  return map;
}

/**
 * Reinject preserved i18n text into a GrapesJS component tree after variant swap.
 * Only overwrites text for keys that exist in the preserved map.
 */
function reinjectI18nTexts(component: Component, preserved: Map<string, string>): void {
  if (preserved.size === 0) return;
  const walk = (c: Component) => {
    const attrs = c.getAttributes();
    const textKey = firstTextI18nKey(attrs);
    if (textKey && preserved.has(textKey)) {
      const text = preserved.get(textKey);
      if (text) {
        c.set("content", text);
      }
    }
    for (const binding of WEB_I18N_ATTRIBUTE_BINDINGS) {
      const key = attrs[binding.keyAttr];
      if (typeof key === "string" && key.trim() && preserved.has(key.trim())) {
        const value = preserved.get(key.trim());
        if (value) {
          c.addAttributes({ [binding.targetAttr]: value });
        }
      }
    }
    c.components().forEach((child: Component) => walk(child));
  };
  walk(component);
}

/**
 * Common section-level traits available on all web blocks.
 * Allows controlling background color, background gradient,
 * padding, and custom CSS class from the traits panel.
 */
function getSectionTraits(t: (key: string) => string) {
  return [
    {
      type: "color",
      name: "data-bg-color",
      label: t("builder.traits.bgColor"),
      category: t("builder.traitGroups.layout"),
    },
    {
      type: "text",
      name: "data-bg-gradient",
      label: t("builder.traits.bgGradient"),
      placeholder: "linear-gradient(135deg, #1A1A1A, #2D2D2D)",
      category: t("builder.traitGroups.layout"),
    },
    {
      type: "text",
      name: "data-section-padding",
      label: t("builder.traits.sectionPadding"),
      placeholder: "64px 24px",
      category: t("builder.traitGroups.layout"),
    },
    {
      type: "select",
      name: "data-color-scheme",
      label: t("builder.traits.colorScheme"),
      category: t("builder.traitGroups.template"),
      options:COLOR_SCHEME_REGISTRY.map((s) => ({
        id: s.id,
        label: t(s.labelKey),
      })),
    },
    {
      type: "text",
      name: "data-css-class",
      label: t("builder.traits.cssClass"),
      placeholder: "my-custom-section",
      category: t("builder.traitGroups.layout"),
    },
  ];
}

/**
 * Register a V2 block with variant support and section-level traits.
 *
 * - Adds a GrapesJS block for the default variant
 * - Registers a custom component type with section traits + optional variant trait
 * - On trait change, swaps component HTML or updates inline styles
 */
function registerBlockV2(
  editor: Editor,
  block: CanvasBlockEntryV2,
  t: (key: string) => string,
): void {
  const defaultVariant = block.variants.find((v) => v.id === block.defaultVariant)
    ?? block.variants[0];

  if (!defaultVariant) return;

  const componentTypeName = `aisha-${block.blockType}`;

  // Register the block (appears in block panel)
  editor.Blocks.add(componentTypeName, {
    label: t(block.nameKey),
    content: {
      type: componentTypeName,
      content: defaultVariant.content,
      attributes: { "data-variant": defaultVariant.id },
    },
    category: t(CATEGORY_KEYS[block.category]),
    attributes: {
      class: `gjs-block-aisha gjs-block-${block.blockType}`,
      title: t(block.descriptionKey),
    },
  });

  // Build traits array: section traits + optional variant trait
  const traits = [...getSectionTraits(t)];

  if (block.variants.length > 1) {
    traits.unshift({
      type: "select",
      name: "data-variant",
      label: t("builder.traits.variant"),
      category: t("builder.traitGroups.template"),
      options:block.variants.map((v) => ({
        id: v.id,
        label: t(v.labelKey),
      })),
    });
  }

  // Register component type with traits
  editor.DomComponents.addType(componentTypeName, {
    model: {
      defaults: {
        traits,
      },
      init() {
        const blockRef = block;
        // Handle variant switching with i18n text preservation
        if (blockRef.variants.length > 1) {
          this.on("change:attributes:data-variant", function (this: ReturnType<Editor["DomComponents"]["addType"]> extends void ? never : unknown) {
            const model = this as unknown as Component;
            const variantId = model.getAttributes()["data-variant"];
            const variant = blockRef.variants.find((v) => v.id === variantId);
            if (variant) {
              // Preserve user-edited i18n text before swap
              const preserved = extractI18nTexts(model);
              model.components(variant.content);
              // Reinject preserved text after swap
              reinjectI18nTexts(model, preserved);
            }
          });
        }

        // Handle section trait changes — apply inline styles
        this.on("change:attributes:data-bg-color", function (this: Record<string, unknown> & { getAttributes: () => Record<string, string>; addStyle: (s: Record<string, string>) => void }) {
          const val = this.getAttributes()["data-bg-color"];
          if (val) this.addStyle({ "background-color": val, background: "" });
        });
        this.on("change:attributes:data-bg-gradient", function (this: Record<string, unknown> & { getAttributes: () => Record<string, string>; addStyle: (s: Record<string, string>) => void }) {
          const val = this.getAttributes()["data-bg-gradient"];
          if (val) this.addStyle({ background: val });
        });
        this.on("change:attributes:data-section-padding", function (this: Record<string, unknown> & { getAttributes: () => Record<string, string>; addStyle: (s: Record<string, string>) => void }) {
          const val = this.getAttributes()["data-section-padding"];
          if (val) this.addStyle({ padding: val });
        });
        this.on("change:attributes:data-color-scheme", function (this: Record<string, unknown> & { getAttributes: () => Record<string, string>; addClass: (c: string) => void; removeClass: (c: string) => void; getClasses: () => string[] }) {
          // Remove previous scheme classes
          const currentClasses = this.getClasses();
          for (const cls of currentClasses) {
            if (cls.startsWith("sc-scheme-")) this.removeClass(cls);
          }
          // Apply new scheme class
          const schemeId = this.getAttributes()["data-color-scheme"];
          const scheme = getColorScheme(schemeId ?? "default");
          if (scheme.cssClass) this.addClass(scheme.cssClass);
        });
        this.on("change:attributes:data-css-class", function (this: Record<string, unknown> & { getAttributes: () => Record<string, string>; addClass: (c: string) => void }) {
          const val = this.getAttributes()["data-css-class"];
          if (val) this.addClass(val);
        });
      },
    },
  });
}

/**
 * GrapesJS plugin that registers Aisha canvas blocks (V2 with variants).
 *
 * @param editor - GrapesJS editor instance
 * @param opts - Plugin options with translation function
 */
export function aishaBlocksPlugin(
  editor: Editor,
  opts: AishaBlocksPluginOptions,
): void {
  const { t } = opts;

  // Register static V2 blocks
  for (const block of CANVAS_BLOCK_REGISTRY_V2) {
    registerBlockV2(editor, block, t);
  }

  // Register runtime block placeholders with config traits
  for (const def of RUNTIME_BLOCK_DEFINITIONS) {
    const componentTypeName = `aisha-runtime-${def.blockType}`;

    // Register DomComponents type with traits if block has configFields
    if (def.configFields && def.configFields.length > 0) {
      const traits = def.configFields.map((field: RuntimeConfigField) => {
        const baseTrait: Record<string, unknown> = {
          name: field.name,
          label: t(field.labelKey),
          type: field.type === "checkbox" ? "checkbox" : field.type === "number" ? "number" : "text",
          default: field.defaultValue,
          category: t("builder.traitGroups.config"),
        };
        if (field.type === "select" && field.options) {
          baseTrait.type = "select";
          baseTrait.options = field.options.map((o) => ({ id: o.id, label: t(o.labelKey) }));
        }
        if (field.min !== undefined) baseTrait.min = field.min;
        if (field.max !== undefined) baseTrait.max = field.max;
        return baseTrait;
      });

      editor.DomComponents.addType(componentTypeName, {
        isComponent: (el) =>
          el.getAttribute?.("data-runtime-block") === def.blockType,
        model: {
          defaults: {
            tagName: "div",
            droppable: false,
            traits,
          },
          init() {
            // Sync traits → data-block-config on any trait change
            for (const field of def.configFields!) {
              this.on(`change:${field.name}`, () => this.syncBlockConfig());
            }
            // Initialize traits from existing data-block-config
            this.initFromBlockConfig();
          },
          initFromBlockConfig() {
            const configAttr = this.getAttributes()["data-block-config"];
            if (configAttr) {
              try {
                const parsed: Record<string, unknown> = JSON.parse(configAttr);
                for (const field of def.configFields!) {
                  if (parsed[field.name] !== undefined) {
                    this.set(field.name, parsed[field.name]);
                  }
                }
              } catch {
                // Invalid JSON — keep defaults
              }
            }
          },
          syncBlockConfig() {
            const config: Record<string, unknown> = {};
            for (const field of def.configFields!) {
              config[field.name] = this.get(field.name) ?? field.defaultValue;
            }
            this.addAttributes({ "data-block-config": JSON.stringify(config) });
          },
        },
      });
    }

    editor.Blocks.add(componentTypeName, {
      label: t(def.nameKey),
      content: def.editorHtml,
      category: t(CATEGORY_KEYS[def.category]),
      attributes: {
        class: `gjs-block-aisha gjs-block-runtime gjs-block-${def.blockType}`,
        title: t(def.descriptionKey),
      },
    });
  }
}

/**
 * @deprecated Use aishaBlocksPlugin which now uses V2 registry with variants.
 */
export function aishaBlocksPluginV1(
  editor: Editor,
  opts: AishaBlocksPluginOptions,
): void {
  const { t } = opts;

  for (const block of CANVAS_BLOCK_REGISTRY) {
    editor.Blocks.add(`aisha-${block.blockType}`, {
      label: t(block.nameKey),
      content: block.content,
      category: t(CATEGORY_KEYS[block.category]),
      attributes: {
        class: `gjs-block-aisha gjs-block-${block.blockType}`,
        title: t(block.descriptionKey),
      },
    });
  }
}
