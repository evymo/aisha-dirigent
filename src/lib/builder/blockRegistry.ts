/**
 * Block registry assembler — combines web, workflow, and runtime block modules.
 *
 * @module
 */

// --- Re-export all types ---
export type {
  BlockCategory,
  CanvasBlockEntry,
  CanvasBlockEntryV2,
  CanvasBlockVariant,
  RuntimeBlockDefinition,
} from "./blockRegistry.types";

// --- Import sub-registries ---
import { WORKFLOW_BLOCKS_V2 } from "./blockRegistry.workflow-blocks";
import { WEB_BLOCKS_V2 } from "./blockRegistry.web-blocks";
import { KIT_BLOCKS_V2 } from "./blockRegistry.kit-blocks";
import type { BlockCategory, CanvasBlockEntry, CanvasBlockEntryV2, CanvasBlockVariant } from "./blockRegistry.types";

export { RUNTIME_BLOCK_DEFINITIONS } from "./blockRegistry.runtime-blocks";

// --- Assembled V2 registry ---

/** Full V2 block registry: web + workflow blocks, variant-aware. */
export const CANVAS_BLOCK_REGISTRY_V2: CanvasBlockEntryV2[] = [
  ...WEB_BLOCKS_V2,
  ...KIT_BLOCKS_V2,
  ...WORKFLOW_BLOCKS_V2,
];

// --- V1 Backward-compatible Registry (derived from V2) ---

/** @deprecated Use CANVAS_BLOCK_REGISTRY_V2 for variant support. Derived from V2. */
export const CANVAS_BLOCK_REGISTRY: CanvasBlockEntry[] =
  CANVAS_BLOCK_REGISTRY_V2.map((v2) => {
    const defaultVar = v2.variants.find((v) => v.id === v2.defaultVariant) ?? v2.variants[0];
    return {
      blockType: v2.blockType,
      category: v2.category,
      content: defaultVar.content,
      descriptionKey: v2.descriptionKey,
      icon: v2.icon,
      nameKey: v2.nameKey,
    };
  });

// --- Helpers ---

/** @deprecated Use getBlocksByCategoryV2. */
export function getBlocksByCategory(category: BlockCategory): CanvasBlockEntry[] {
  return CANVAS_BLOCK_REGISTRY.filter((b) => b.category === category);
}

/** Get V2 blocks filtered by category. */
export function getBlocksByCategoryV2(category: BlockCategory): CanvasBlockEntryV2[] {
  return CANVAS_BLOCK_REGISTRY_V2.filter((b) => b.category === category);
}

/** Find a specific variant for a block. Returns default if variantId not found. */
export function getBlockVariant(
  blockType: string,
  variantId: string,
): CanvasBlockVariant | undefined {
  const block = CANVAS_BLOCK_REGISTRY_V2.find((b) => b.blockType === blockType);
  if (!block) return undefined;
  return (
    block.variants.find((v) => v.id === variantId) ??
    block.variants.find((v) => v.id === block.defaultVariant)
  );
}
