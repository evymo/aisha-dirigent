/**
 * StoryLoop Filter Bar
 *
 * Horizontal toolbar replacing the vertical sidebar.
 * Provides status filter pills, label chips, search input,
 * thread mode toggle and "New Story" button.
 *
 * @module components/storyloop/StoryLoopFilterBar
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Inbox,
  PlayCircle,
  Calendar,
  Archive,
  Trash2,
  Star,
  Tag,
  Plus,
  Search,
  BookOpen,
  Filter,
  X,
  FilePlus,
  MessageSquarePlus,
  LayoutList,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useStoryStats, useStoryLabels } from "@/hooks/useStoryLoop";
import { useIsMobile } from "@/hooks/use-mobile";
import type { StoryStats, LabelStats } from "@/schemas/storyLoopSchemas";

export type StoryLoopThreadMode = "stories" | "discussions";

interface StoryLoopFilterBarProps {
  /** Current thread mode (stories | discussions). */
  threadMode: StoryLoopThreadMode;
  /** Callback to change thread mode. */
  onThreadModeChange: (mode: StoryLoopThreadMode) => void;
  /** Currently selected status folder. */
  selectedStatus: string | null;
  /** Callback when status changes. */
  onStatusChange: (status: string | null) => void;
  /** Currently selected label filters. */
  selectedLabels: string[];
  /** Callback to toggle a label filter. */
  onLabelToggle: (label: string) => void;
  /** Search query string. */
  search: string;
  /** Callback when search value changes. */
  onSearchChange: (search: string) => void;
  /** Whether user can access story mode. */
  allowStoryMode?: boolean;
  /** Whether story data hooks should be enabled. */
  storyDataEnabled?: boolean;
  /** Handler for "New Story" button. */
  onNewStory: () => void;
  /** Whether user can create stories. */
  canCreateStory?: boolean;
  /** Handler for "Add Entry" button. */
  onAddEntry?: () => void;
  /** Handler for "New Discussion" button. */
  onNewDiscussion?: () => void;
}

interface StatusPillProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}

function StatusPill({ icon, label, count, isActive, onClick }: StatusPillProps) {
  return (
    <Button
      type="button"
      variant={isActive ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className={cn(
        "gap-1.5 h-8 text-xs whitespace-nowrap",
        isActive && "shadow-none",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {count !== undefined && count > 0 && (
        <Badge
          variant={isActive ? "secondary" : "outline"}
          className="h-4 min-w-[16px] px-1 text-[10px]"
        >
          {count}
        </Badge>
      )}
    </Button>
  );
}

/** Mobile-only bottom sheet with full filter selection */
function MobileFilterSheet({
  selectedStatus,
  onStatusChange,
  selectedLabels,
  onLabelToggle,
  stats,
  labels,
}: {
  selectedStatus: string | null;
  onStatusChange: (status: string | null) => void;
  selectedLabels: string[];
  onLabelToggle: (label: string) => void;
  stats: StoryStats | undefined;
  labels: LabelStats[] | undefined;
}) {
  const { t } = useTranslation();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Filter className="h-3.5 w-3.5" />
          {t("common.filter")}
          {(selectedLabels.length > 0 || (selectedStatus != null && selectedStatus !== "inbox")) && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
              {selectedLabels.length + (selectedStatus != null && selectedStatus !== "inbox" ? 1 : 0)}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[70dvh]">
        <SheetHeader>
          <SheetTitle>{t("common.filter")}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {/* Status */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("storyloop.status")}
            </p>
            <div className="flex flex-wrap gap-2">
              <StatusPill
                icon={<LayoutList className="h-3.5 w-3.5" />}
                label={t("storyloop.all")}
                isActive={selectedStatus === null}
                onClick={() => onStatusChange(null)}
              />
              <StatusPill
                icon={<Zap className="h-3.5 w-3.5" />}
                label={t("storyloop.active")}
                count={stats?.active_count}
                isActive={selectedStatus === "active"}
                onClick={() => onStatusChange(selectedStatus === "active" ? null : "active")}
              />
              <StatusPill
                icon={<Inbox className="h-3.5 w-3.5" />}
                label={t("storyloop.inbox")}
                count={stats?.inbox_count}
                isActive={selectedStatus === "inbox"}
                onClick={() => onStatusChange(selectedStatus === "inbox" ? null : "inbox")}
              />
              <StatusPill
                icon={<PlayCircle className="h-3.5 w-3.5" />}
                label={t("storyloop.inProgress")}
                count={stats?.in_progress_count}
                isActive={selectedStatus === "in_progress"}
                onClick={() => onStatusChange(selectedStatus === "in_progress" ? null : "in_progress")}
              />
              <StatusPill
                icon={<Calendar className="h-3.5 w-3.5" />}
                label={t("storyloop.scheduled")}
                count={stats?.scheduled_count}
                isActive={selectedStatus === "scheduled"}
                onClick={() => onStatusChange(selectedStatus === "scheduled" ? null : "scheduled")}
              />
              <StatusPill
                icon={<Star className="h-3.5 w-3.5" />}
                label={t("storyloop.starred")}
                count={stats?.starred_count}
                isActive={selectedStatus === "starred"}
                onClick={() => onStatusChange(selectedStatus === "starred" ? null : "starred")}
              />
              <StatusPill
                icon={<Archive className="h-3.5 w-3.5" />}
                label={t("storyloop.archived")}
                count={stats?.archived_count}
                isActive={selectedStatus === "archived"}
                onClick={() => onStatusChange(selectedStatus === "archived" ? null : "archived")}
              />
              <StatusPill
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t("storyloop.trash")}
                isActive={selectedStatus === "trash"}
                onClick={() => onStatusChange(selectedStatus === "trash" ? null : "trash")}
              />
            </div>
          </div>

          {/* Labels */}
          {labels && labels.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("storyloop.labels")}
              </p>
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => (
                  <Button
                    key={l.label}
                    type="button"
                    variant={selectedLabels.includes(l.label) ? "default" : "outline"}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => onLabelToggle(l.label)}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `var(--${l.color}, hsl(var(--muted-foreground)))` }}
                    />
                    {l.label}
                    <span className="text-muted-foreground">({l.story_count})</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Horizontal filter toolbar for StoryLoop.
 *
 * @example
 * <StoryLoopFilterBar
 *   threadMode="stories"
 *   onThreadModeChange={setThreadMode}
 *   selectedStatus={selectedStatus}
 *   onStatusChange={setSelectedStatus}
 *   selectedLabels={selectedLabels}
 *   onLabelToggle={handleLabelToggle}
 *   search={searchQuery}
 *   onSearchChange={setSearchQuery}
 *   onNewStory={handleNewStory}
 * />
 */
export function StoryLoopFilterBar({
  threadMode,
  onThreadModeChange,
  selectedStatus,
  onStatusChange,
  selectedLabels,
  onLabelToggle,
  search,
  onSearchChange,
  allowStoryMode = true,
  storyDataEnabled,
  onNewStory,
  canCreateStory = true,
  onAddEntry,
  onNewDiscussion,
}: StoryLoopFilterBarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const loadStoryData = storyDataEnabled ?? (allowStoryMode && threadMode === "stories");
  const { data: stats } = useStoryStats({ enabled: loadStoryData });
  const { data: labels } = useStoryLabels({ enabled: loadStoryData });

  const isStoryMode = threadMode === "stories";

  return (
    <div className="space-y-3">
      {/* Row 1: Thread mode tabs + New Story + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Tabs
            value={threadMode}
            onValueChange={(value) => onThreadModeChange(value as StoryLoopThreadMode)}
          >
            <TabsList className="h-9">
              {allowStoryMode && (
                <TabsTrigger value="stories" className="gap-1.5 text-xs">
                  <Inbox className="h-3.5 w-3.5" />
                  {t("storyloop.threadModes.stories")}
                </TabsTrigger>
              )}
              <TabsTrigger value="discussions" className="gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" />
                {t("storyloop.threadModes.discussions")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {canCreateStory && allowStoryMode && isStoryMode && (
            <Button onClick={onNewStory} size="sm" className="gap-1.5 h-9">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("storyloop.newStory.title")}</span>
            </Button>
          )}

          {onAddEntry && allowStoryMode && isStoryMode && (
            <Button onClick={onAddEntry} size="sm" variant="outline" className="gap-1.5 h-9">
              <FilePlus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("storyloop.addEntry.title")}</span>
            </Button>
          )}

          {onNewDiscussion && !isStoryMode && (
            <Button onClick={onNewDiscussion} size="sm" className="gap-1.5 h-9">
              <MessageSquarePlus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("storyloop.newDiscussion.title")}</span>
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("storyloop.search")}
            className="h-9 pl-8"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => onSearchChange("")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Status pills + Labels (only in story mode) */}
      {isStoryMode && allowStoryMode && (
        isMobile ? (
          <MobileFilterSheet
            selectedStatus={selectedStatus}
            onStatusChange={onStatusChange}
            selectedLabels={selectedLabels}
            onLabelToggle={onLabelToggle}
            stats={stats}
            labels={labels}
          />
        ) : (
          <div className="flex items-center gap-2">
            {/* Status pills (horizontally scrollable on tablet) */}
            <ScrollArea className="max-w-full">
              <div className="flex items-center gap-1.5">
                <StatusPill
                  icon={<LayoutList className="h-3.5 w-3.5" />}
                  label={t("storyloop.all")}
                  isActive={selectedStatus === null}
                  onClick={() => onStatusChange(null)}
                />
                <StatusPill
                  icon={<Zap className="h-3.5 w-3.5" />}
                  label={t("storyloop.active")}
                  count={stats?.active_count}
                  isActive={selectedStatus === "active"}
                  onClick={() => onStatusChange("active")}
                />
                <StatusPill
                  icon={<Inbox className="h-3.5 w-3.5" />}
                  label={t("storyloop.inbox")}
                  count={stats?.inbox_count}
                  isActive={selectedStatus === "inbox"}
                  onClick={() => onStatusChange("inbox")}
                />
                <StatusPill
                  icon={<PlayCircle className="h-3.5 w-3.5" />}
                  label={t("storyloop.inProgress")}
                  count={stats?.in_progress_count}
                  isActive={selectedStatus === "in_progress"}
                  onClick={() => onStatusChange("in_progress")}
                />
                <StatusPill
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label={t("storyloop.scheduled")}
                  count={stats?.scheduled_count}
                  isActive={selectedStatus === "scheduled"}
                  onClick={() => onStatusChange("scheduled")}
                />
                <StatusPill
                  icon={<Star className="h-3.5 w-3.5" />}
                  label={t("storyloop.starred")}
                  count={stats?.starred_count}
                  isActive={selectedStatus === "starred"}
                  onClick={() => onStatusChange("starred")}
                />
                <StatusPill
                  icon={<Archive className="h-3.5 w-3.5" />}
                  label={t("storyloop.archived")}
                  count={stats?.archived_count}
                  isActive={selectedStatus === "archived"}
                  onClick={() => onStatusChange("archived")}
                />
                <StatusPill
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label={t("storyloop.trash")}
                  isActive={selectedStatus === "trash"}
                  onClick={() => onStatusChange("trash")}
                />
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            {/* Labels popover */}
            {labels && labels.length > 0 && (
              <>
                <div className="mx-1 h-6 w-px bg-border" />
                <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant={selectedLabels.length > 0 ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 h-8 text-xs"
                    >
                      <Tag className="h-3.5 w-3.5" />
                      {t("storyloop.labels")}
                      {selectedLabels.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          {selectedLabels.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-2">
                    <div className="space-y-1">
                      {labels.map((labelItem: LabelStats) => (
                        <button
                          key={labelItem.label}
                          type="button"
                          onClick={() => onLabelToggle(labelItem.label)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            selectedLabels.includes(labelItem.label) && "bg-accent/50",
                          )}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: `var(--${labelItem.color}, hsl(var(--muted-foreground)))`,
                            }}
                          />
                          <span className="flex-1 text-left truncate">{labelItem.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {labelItem.story_count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )}

            {/* Active label chips */}
            {selectedLabels.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => onLabelToggle(label)}
              >
                {label}
                <X className="h-3 w-3" />
              </Badge>
            ))}
          </div>
        )
      )}
    </div>
  );
}
