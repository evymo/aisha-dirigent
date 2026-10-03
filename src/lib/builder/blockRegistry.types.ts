/**
 * Type definitions for the AISHA Story Canvas block registry.
 *
 * @module
 */

import type { LucideIcon } from "lucide-react";

/** Category for block grouping in the library panel */
export type BlockCategory = "web" | "workflow";

/** A single variant of a block (e.g., "default", "minimal", "dark") */
export interface CanvasBlockVariant {
  /** Unique variant identifier within the block */
  id: string;
  /** i18n key for the variant label */
  labelKey: string;
  /** GrapesJS component HTML for this variant */
  content: string;
  /** Optional preview image URL for the variant picker */
  previewUrl?: string;
}

/** @deprecated Use CanvasBlockEntryV2 for variant support. */
export interface CanvasBlockEntry {
  /** Unique block type identifier */
  blockType: string;
  /** Block category for grouping */
  category: BlockCategory;
  /** Default GrapesJS component HTML */
  content: string;
  /** i18n key for the block description (builder.blocks.{type}.description) */
  descriptionKey: string;
  /** Lucide icon component for the block */
  icon: LucideIcon;
  /** i18n key for the block name (builder.blocks.{type}.title) */
  nameKey: string;
}

/** V2 block entry with variant support */
export interface CanvasBlockEntryV2 {
  /** Unique block type identifier */
  blockType: string;
  /** Block category for grouping */
  category: BlockCategory;
  /** i18n key for the block description (builder.blocks.{type}.description) */
  descriptionKey: string;
  /** Lucide icon component for the block */
  icon: LucideIcon;
  /** i18n key for the block name (builder.blocks.{type}.title) */
  nameKey: string;
  /** Available variants for this block */
  variants: CanvasBlockVariant[];
  /** ID of the default variant to use when adding the block */
  defaultVariant: string;
}

/**
 * Configuration field for a runtime block trait.
 * Maps to a GrapesJS trait in the sidebar panel.
 */
export interface RuntimeConfigField {
  /** Field name — maps to data-block-config JSON key */
  name: string;
  /** Field type for the GrapesJS trait */
  type: "number" | "text" | "checkbox" | "select";
  /** i18n key for the field label */
  labelKey: string;
  /** Default value */
  defaultValue: string | number | boolean;
  /** Options for select type */
  options?: Array<{ id: string; labelKey: string }>;
  /** Min value for number type */
  min?: number;
  /** Max value for number type */
  max?: number;
}

/**
 * Definition of a runtime block for the GrapesJS editor.
 * These blocks produce placeholder HTML with `data-runtime-block`
 * attributes that get hydrated at render time by PageRenderer.
 */
export interface RuntimeBlockDefinition {
  /** Unique block type — must match the runtimeBlockRegistry key */
  blockType: string;
  /** Block category for grouping */
  category: BlockCategory;
  /** i18n key for the block description */
  descriptionKey: string;
  /** Lucide icon for the block panel */
  icon: LucideIcon;
  /** i18n key for the block name */
  nameKey: string;
  /** Placeholder HTML rendered in the editor canvas */
  editorHtml: string;
  /** Configuration fields exposed as GrapesJS traits */
  configFields?: RuntimeConfigField[];
}
