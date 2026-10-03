/**
 * RuntimeBlockRenderer — Resolves and renders a single runtime block.
 *
 * Looks up the block type in the runtime registry and renders the
 * corresponding lazy-loaded React component inside a Suspense boundary
 * with loading fallback.
 *
 * @module
 */

import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { safeError } from "@/lib/security/safeLogger";
import {
  resolveRuntimeBlock,
  type RuntimeBlockConfig,
} from "@/lib/builder/runtimeBlockRegistry";

// =====================================================
// Types
// =====================================================

interface RuntimeBlockRendererProps {
  /** The block type identifier (from data-runtime-block attribute) */
  blockType: string;
  /** Parsed config from data-block-config attribute */
  config: RuntimeBlockConfig;
}

// =====================================================
// Component
// =====================================================

/**
 * Renders a runtime block by type with Suspense loading state.
 *
 * If the block type is not registered, renders a visible placeholder
 * in development and nothing in production.
 */
export function RuntimeBlockRenderer({ blockType, config }: RuntimeBlockRendererProps) {
  const { t } = useTranslation();
  const entry = resolveRuntimeBlock(blockType);

  if (!entry) {
    safeError("runtime-block.unregistered", { blockType });
    return null;
  }

  const BlockComponent = entry.component;

  return (
    <Suspense
      fallback={
        <div className="w-full py-16 flex items-center justify-center">
          <Skeleton className="h-48 w-full max-w-4xl" />
        </div>
      }
    >
      <BlockComponent config={config} />
    </Suspense>
  );
}
