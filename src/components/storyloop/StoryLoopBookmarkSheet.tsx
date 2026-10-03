/**
 * StoryLoop Bookmark Sheet
 *
 * A slide-out Sheet containing bookmarked entries and upcoming reminders.
 * Replaces the bookmark/reminder sections from the retired StoryLoopSidebar.
 *
 * @module components/storyloop/StoryLoopBookmarkSheet
 */

import React from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Clock,
  X,
  Bell,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useUpcomingReminders } from "@/hooks/useStoryLoop";
import type { StoryLoopBookmark } from "@/hooks/useStoryLoopBookmarks";
import type { UpcomingReminder } from "@/schemas/storyLoopSchemas";
import { format, isToday, isTomorrow } from "date-fns";
interface StoryLoopBookmarkSheetProps {
  /** Open state (controlled). */
  open: boolean;
  /** Callback when open state changes. */
  onOpenChange: (open: boolean) => void;
  /** List of bookmarked entries. */
  bookmarks: StoryLoopBookmark[];
  /** Callback when a bookmark is clicked. */
  onBookmarkSelect: (bookmark: StoryLoopBookmark) => void;
  /** Callback when a bookmark is removed. */
  onBookmarkRemove: (bookmarkId: string) => void;
  /** Whether reminders should be loaded. */
  remindersEnabled?: boolean;
}

/**
 * Slide-out sheet displaying bookmarks and upcoming reminders.
 *
 * @example
 * <StoryLoopBookmarkSheet
 *   open={isBookmarkSheetOpen}
 *   onOpenChange={setIsBookmarkSheetOpen}
 *   bookmarks={bookmarks}
 *   onBookmarkSelect={handleBookmarkSelect}
 *   onBookmarkRemove={handleBookmarkRemove}
 * />
 */
export function StoryLoopBookmarkSheet({
  open,
  onOpenChange,
  bookmarks,
  onBookmarkSelect,
  onBookmarkRemove,
  remindersEnabled = true,
}: StoryLoopBookmarkSheetProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  const { data: reminders } = useUpcomingReminders(8, { enabled: remindersEnabled && open });

  const formatReminderTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, "HH:mm", { locale: dateLocale });
    }
    if (isTomorrow(date)) {
      return t("common.tomorrow");
    }
    return format(date, "d. MMM", { locale: dateLocale });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[380px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bookmark className="h-5 w-5" />
            {t("storyloop.bookmarks.title")}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100dvh-7rem)]">
          <div className="space-y-6 pr-2">
            {/* Bookmarks */}
            <section>
              {bookmarks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("storyloop.bookmarks.empty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      className="group flex items-start gap-2 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onBookmarkSelect(bookmark);
                          onOpenChange(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            {t(
                              bookmark.threadType === "story"
                                ? "storyloop.threadModes.stories"
                                : "storyloop.threadModes.discussions",
                            )}
                          </Badge>
                        </div>
                        <p className="truncate text-sm font-medium text-foreground">
                          {bookmark.threadTitle}
                        </p>
                        {bookmark.entryPreview && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {bookmark.entryPreview}
                          </p>
                        )}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => onBookmarkRemove(bookmark.id)}
                        aria-label={t("storyloop.bookmarks.remove")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Reminders */}
            {reminders && reminders.length > 0 && (
              <>
                <Separator />
                <section>
                  <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                    <Bell className="h-4 w-4" />
                    {t("storyloop.reminders.upcoming")}
                  </h3>
                  <div className="space-y-2">
                    {reminders.map((reminder: UpcomingReminder) => (
                      <div
                        key={reminder.id}
                        className={cn(
                          "rounded-lg border border-border p-3 text-sm",
                          reminder.is_overdue && "border-destructive/50 bg-destructive/5",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">
                            {formatReminderTime(reminder.remind_at)}
                          </span>
                          {reminder.is_overdue && (
                            <Badge variant="destructive" className="h-4 text-[10px]">
                              {t("storyloop.reminders.overdue")}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {reminder.user_display_name || reminder.story_title}
                        </div>
                        {reminder.message && (
                          <div className="mt-0.5 truncate text-xs">{reminder.message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
