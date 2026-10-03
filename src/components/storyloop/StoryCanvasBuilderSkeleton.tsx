/**
 * Loading skeleton for StoryCanvasBuilder (shown during lazy load).
 *
 * Separated from the main builder to avoid static-importing the
 * entire GrapesJS bundle when only the fallback is needed.
 *
 * @module
 */

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lightweight skeleton placeholder rendered while StoryCanvasBuilder is lazy-loaded.
 */
export function StoryCanvasBuilderSkeleton() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full min-h-[500px] items-center justify-center gap-4 p-8">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("builder.status.loading")}</p>
      <div className="w-full max-w-lg space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    </div>
  );
}
