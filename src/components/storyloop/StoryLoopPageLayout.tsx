/**
 * StoryLoop Page Layout
 *
 * Responsive 2-column CSS grid layout replacing the 3-panel resizable layout.
 * Desktop: list (24rem) + detail (1fr).
 * Tablet: list (20rem) + detail (1fr).
 * Mobile: single column with back navigation.
 *
 * @module components/storyloop/StoryLoopPageLayout
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface StoryLoopPageLayoutProps {
  /** List panel content (StoryList or DiscussionList). */
  list: React.ReactNode;
  /** Detail panel content (StoryDetail or DiscussionDetail). */
  detail: React.ReactNode;
  /** Whether a detail item is selected (controls mobile view). */
  hasDetailSelection: boolean;
  /** Callback when user clicks back on mobile (deselects detail). */
  onBackToList: () => void;
  /** Additional class names for the wrapper. */
  className?: string;
}

/**
 * Responsive 2-column layout for StoryLoop.
 * On desktop/tablet renders side-by-side grid.
 * On mobile shows either list or detail with back button.
 *
 * @example
 * <StoryLoopPageLayout
 *   list={<StoryList ... />}
 *   detail={<StoryDetail ... />}
 *   hasDetailSelection={!!selectedStoryId}
 *   onBackToList={() => setSelectedStoryId(null)}
 * />
 */
export function StoryLoopPageLayout({
  list,
  detail,
  hasDetailSelection,
  onBackToList,
  className,
}: StoryLoopPageLayoutProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Mobile: single column with list/detail switch
  if (isMobile) {
    if (hasDetailSelection) {
      return (
        <div className={cn("flex flex-col min-h-0", className)}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-2 h-8 w-fit gap-1.5 self-start text-xs text-muted-foreground"
            onClick={onBackToList}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("common.back")}
          </Button>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {detail}
          </div>
        </div>
      );
    }

    return (
      <div className={cn("min-h-0", className)}>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {list}
        </div>
      </div>
    );
  }

  // Desktop/Tablet: 2-column grid
  return (
    <div
      className={cn(
        "grid gap-4 min-h-0",
        "grid-cols-[20rem_1fr] lg:grid-cols-[24rem_1fr]",
        className,
      )}
      style={{ height: "calc(100dvh - 16rem)" }}
    >
      {/* List column */}
      <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-card">
        {list}
      </div>
      {/* Detail column */}
      <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-card">
        {detail}
      </div>
    </div>
  );
}
