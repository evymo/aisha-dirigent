/**
 * StoryLoop Sidebar
 * 
 * Folders, labels, and reminders navigation.
 */

import React from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import { 
  Inbox, 
  PlayCircle, 
  Calendar, 
  Archive, 
  Trash2, 
  Star,
  Tag,
  Bell,
  Plus,
  Clock,
  BookOpen,
  Bookmark,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useStoryStats, useUpcomingReminders, useStoryLabels } from '@/hooks/useStoryLoop';
import type { StoryLoopBookmark } from '@/hooks/useStoryLoopBookmarks';
import { format, isToday, isTomorrow } from 'date-fns';
export type StoryLoopThreadMode = 'stories' | 'discussions';

interface StoryLoopSidebarProps {
  selectedStatus: string | null;
  onStatusChange: (status: string | null) => void;
  selectedLabels: string[];
  onLabelToggle: (label: string) => void;
  threadMode: StoryLoopThreadMode;
  onThreadModeChange: (mode: StoryLoopThreadMode) => void;
  allowStoryMode?: boolean;
  storyDataEnabled?: boolean;
  onNewStory: () => void;
  canCreateStory?: boolean;
  bookmarks?: StoryLoopBookmark[];
  onBookmarkSelect?: (bookmark: StoryLoopBookmark) => void;
  onBookmarkRemove?: (bookmarkId: string) => void;
}

interface FolderItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive?: boolean;
  onClick: () => void;
}

function FolderItem({ icon, label, count, isActive, onClick }: FolderItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-sm transition-colors sm:px-3 lg:text-[15px]',
        'flex items-center gap-2',
        'hover:bg-accent hover:text-accent-foreground',
        isActive && 'bg-accent text-accent-foreground font-medium'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 text-xs">
          {count}
        </Badge>
      )}
    </button>
  );
}

export function StoryLoopSidebar({
  selectedStatus,
  onStatusChange,
  selectedLabels,
  onLabelToggle,
  threadMode,
  onThreadModeChange,
  allowStoryMode = true,
  storyDataEnabled,
  onNewStory,
  canCreateStory = true,
  bookmarks = [],
  onBookmarkSelect,
  onBookmarkRemove,
}: StoryLoopSidebarProps) {
  const { t, i18n } = useTranslation();
  const loadStoryData = storyDataEnabled ?? (allowStoryMode && threadMode === 'stories');
  const { data: stats } = useStoryStats({ enabled: loadStoryData });
  const { data: reminders } = useUpcomingReminders(5, { enabled: loadStoryData });
  const { data: labels } = useStoryLabels({ enabled: loadStoryData });

  const dateLocale = getDateFnsLocale(i18n.language);

  const formatReminderTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, 'HH:mm', { locale: dateLocale });
    }
    if (isTomorrow(date)) {
      return t('common.tomorrow');
    }
    return format(date, 'd. MMM', { locale: dateLocale });
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[hsl(var(--md-color-surface-container-high))]">
      <div className="p-2.5 sm:p-3">
        <div
          className={cn(
            'grid gap-1 rounded-md bg-muted/60 p-1',
            allowStoryMode ? 'grid-cols-2' : 'grid-cols-1'
          )}
        >
          {allowStoryMode && (
            <button
              type="button"
              onClick={() => onThreadModeChange('stories')}
              className={cn(
                'flex items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
                threadMode === 'stories'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Inbox className="h-3.5 w-3.5" />
              {t('storyloop.threadModes.stories')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onThreadModeChange('discussions')}
            className={cn(
              'flex items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
              threadMode === 'discussions'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('storyloop.threadModes.discussions')}
          </button>
        </div>
      </div>

      <Separator />

      {/* New Story Button */}
      {canCreateStory && allowStoryMode && threadMode === 'stories' && (
        <>
          <div className="p-2.5 sm:p-3">
            <Button onClick={onNewStory} className="h-9 w-full gap-2 lg:h-10" size="sm">
              <Plus className="h-4 w-4" />
              {t('storyloop.newStory.title')}
            </Button>
          </div>

          <Separator />
        </>
      )}

      <ScrollArea className="flex-1">
        <div className="p-1.5 sm:p-2">
          <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-3">
            <Bookmark className="h-3 w-3" />
            {t('storyloop.bookmarks.title')}
          </div>
          {bookmarks.length === 0 ? (
            <p className="px-2.5 py-1 text-xs text-muted-foreground sm:px-3">
              {t('storyloop.bookmarks.empty')}
            </p>
          ) : (
            <div className="mt-1 space-y-1">
              {bookmarks.slice(0, 12).map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="group flex items-start gap-1 rounded-md px-1.5 py-1.5 hover:bg-accent/50 sm:px-2"
                >
                  <button
                    type="button"
                    onClick={() => onBookmarkSelect?.(bookmark)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {t(
                          bookmark.threadType === 'story'
                            ? 'storyloop.threadModes.stories'
                            : 'storyloop.threadModes.discussions'
                        )}
                      </Badge>
                    </div>
                    <p className="truncate text-xs font-medium text-foreground">
                      {bookmark.threadTitle}
                    </p>
                    {bookmark.entryPreview && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {bookmark.entryPreview}
                      </p>
                    )}
                    {!bookmark.entryPreview && (
                      <p className="text-xs text-muted-foreground">
                        {t('storyloop.bookmarks.open')}
                      </p>
                    )}
                  </button>
                  {onBookmarkRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => onBookmarkRemove(bookmark.id)}
                      aria-label={t('storyloop.bookmarks.remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator className="my-2" />

        {threadMode === 'discussions' && (
          <div className="p-2.5 text-xs text-muted-foreground sm:p-3">
            {t('storyloop.discussions.selectThread')}
          </div>
        )}

        {allowStoryMode && threadMode === 'stories' && (
          <div className="space-y-1 p-1.5 sm:p-2">
          {/* Folders */}
          <FolderItem
            icon={<Inbox className="h-4 w-4" />}
            label={t('storyloop.inbox')}
            count={stats?.inbox_count}
            isActive={selectedStatus === 'inbox'}
            onClick={() => onStatusChange('inbox')}
          />
          <FolderItem
            icon={<PlayCircle className="h-4 w-4" />}
            label={t('storyloop.inProgress')}
            count={stats?.in_progress_count}
            isActive={selectedStatus === 'in_progress'}
            onClick={() => onStatusChange('in_progress')}
          />
          <FolderItem
            icon={<Calendar className="h-4 w-4" />}
            label={t('storyloop.scheduled')}
            count={stats?.scheduled_count}
            isActive={selectedStatus === 'scheduled'}
            onClick={() => onStatusChange('scheduled')}
          />
          <FolderItem
            icon={<Star className="h-4 w-4" />}
            label={t('storyloop.starred')}
            count={stats?.starred_count}
            isActive={selectedStatus === 'starred'}
            onClick={() => onStatusChange('starred')}
          />
          <FolderItem
            icon={<Archive className="h-4 w-4" />}
            label={t('storyloop.archived')}
            count={stats?.archived_count}
            isActive={selectedStatus === 'archived'}
            onClick={() => onStatusChange('archived')}
          />
          <FolderItem
            icon={<Trash2 className="h-4 w-4" />}
            label={t('storyloop.trash')}
            isActive={selectedStatus === 'trash'}
            onClick={() => onStatusChange('trash')}
          />
          </div>
        )}

        {/* Labels Section */}
        {allowStoryMode && threadMode === 'stories' && labels && labels.length > 0 && (
          <>
            <Separator className="my-2" />
            <div className="p-1.5 sm:p-2">
              <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-3">
                <Tag className="h-3 w-3" />
                {t('storyloop.labels')}
              </div>
              <div className="mt-1 space-y-1">
                {labels.map((labelItem) => (
                  <button
                    key={labelItem.label}
                    onClick={() => onLabelToggle(labelItem.label)}
                    className={cn(
                      'w-full rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3 lg:text-[15px]',
                      'flex items-center gap-2',
                      'hover:bg-accent hover:text-accent-foreground',
                      selectedLabels.includes(labelItem.label) && 'bg-accent/50'
                    )}
                  >
                    <span 
                      className="h-2 w-2 rounded-full" 
                      style={{ backgroundColor: `var(--${labelItem.color}, hsl(var(--muted-foreground)))` }}
                    />
                    <span className="flex-1 text-left truncate">{labelItem.label}</span>
                    <span className="text-xs text-muted-foreground">{labelItem.story_count}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Reminders Section */}
        {allowStoryMode && threadMode === 'stories' && reminders && reminders.length > 0 && (
          <>
            <Separator className="my-2" />
            <div className="p-1.5 sm:p-2">
              <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-3">
                <Bell className="h-3 w-3" />
                {t('storyloop.reminders.upcoming')}
              </div>
              <div className="mt-1 space-y-1">
                {reminders.map((reminder) => (
                  <div
                    key={reminder.id}
                    className={cn(
                      'rounded-md bg-muted/50 px-2.5 py-2 text-xs sm:px-3',
                      reminder.is_overdue && 'bg-destructive/10 text-destructive'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span className="font-medium">
                        {formatReminderTime(reminder.remind_at)}
                      </span>
                      {reminder.is_overdue && (
                        <Badge variant="destructive" className="h-4 text-[10px]">
                          {t('storyloop.reminders.overdue')}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">
                      {reminder.user_display_name || reminder.story_title}
                    </div>
                    {reminder.message && (
                      <div className="mt-0.5 truncate">{reminder.message}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  );
}
