/**
 * StoryLoop Story List
 * 
 * List of stories with search and filters.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import { Search, Star, Circle, Loader2, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useInfiniteStories, useToggleStoryStar } from '@/hooks/useStoryLoop';
import type { StoryListItem } from '@/schemas/storyLoopSchemas';
import { formatDistanceToNow } from 'date-fns';
interface StoryListProps {
  status: string | null;
  labels: string[];
  search: string;
  onSearchChange: (search: string) => void;
  selectedStoryId: string | null;
  onStorySelect: (storyId: string) => void;
  enabled?: boolean;
  /** Hide embedded search (when FilterBar provides search externally). */
  showSearch?: boolean;
}

interface StoryListItemComponentProps {
  story: StoryListItem;
  isSelected: boolean;
  onClick: () => void;
  onStarClick: (e: React.MouseEvent) => void;
}

function StoryListItemComponent({ 
  story, 
  isSelected, 
  onClick, 
  onStarClick 
}: StoryListItemComponentProps) {
  const { i18n, t } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const timeAgo = formatDistanceToNow(new Date(story.last_activity_at), {
    addSuffix: true,
    locale: dateLocale,
  });

  const priorityColors: Record<string, string> = {
    urgent: 'bg-destructive',
    high: 'bg-warning',
    normal: 'bg-muted',
    low: 'bg-muted/50',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full border-b border-border p-2.5 text-left transition-colors sm:p-3 lg:px-3.5 lg:py-3',
        'hover:bg-muted/50',
        isSelected && 'bg-accent',
        !story.is_read && 'bg-muted/30'
      )}
    >
      <div className="flex items-start gap-2">
        {/* Star button */}
        <button
          onClick={onStarClick}
          className={cn(
            'mt-0.5 p-0.5 rounded hover:bg-background/50 transition-colors',
            story.is_starred ? 'text-warning' : 'text-muted-foreground'
          )}
        >
          <Star className={cn('h-4 w-4', story.is_starred && 'fill-current')} />
        </button>

        <div className="flex-1 min-w-0">
          {/* User name + time */}
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              'truncate text-sm lg:text-[15px]',
              !story.is_read && 'font-semibold'
            )}>
              {story.user_display_name || t('storyloop.unknownUser')}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {timeAgo}
            </span>
          </div>

          {/* Title */}
          <div className="flex items-center gap-1.5 mt-0.5">
            {/* Priority indicator */}
            {story.priority !== 'normal' && (
              <span className={cn(
                'h-2 w-2 rounded-full',
                priorityColors[story.priority]
              )} />
            )}
            <span className={cn(
              'truncate text-sm lg:text-[15px]',
              !story.is_read ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {story.title}
            </span>
          </div>

          {/* Study name */}
          {story.study_name && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
              {story.study_name}
            </p>
          )}

          {/* Preview */}
          {story.last_entry_preview && (
            <p className="mt-1 truncate text-xs text-muted-foreground lg:text-[13px]">
              {story.last_entry_preview}
            </p>
          )}

          {/* Labels + Unread count */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {story.labels.slice(0, 2).map((label) => (
              <Badge 
                key={label.label} 
                variant="outline" 
                className="h-4 text-[10px] px-1"
              >
                {label.label}
              </Badge>
            ))}
            {story.labels.length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{story.labels.length - 2}
              </span>
            )}
            {story.is_shared && (
              <Badge variant="outline" className="h-4 text-[10px] px-1 gap-0.5">
                <Users className="h-2.5 w-2.5" />
                {t('storyloop.participants.shared')}
              </Badge>
            )}
            {story.unread_count > 0 && (
              <Badge variant="default" className="h-4 text-[10px] px-1.5 ml-auto">
                {story.unread_count}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function StoryListSkeleton() {
  return (
    <div className="p-3 border-b border-border">
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <div className="flex-1 space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  );
}

export function StoryList({
  status,
  labels,
  search,
  onSearchChange,
  selectedStoryId,
  onStorySelect,
  enabled = true,
  showSearch = true,
}: StoryListProps) {
  const { t } = useTranslation();
  const {
    data: storiesData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteStories({
    status: status === 'starred' ? null : status,
    search: search || null,
    labels: labels.length > 0 ? labels : null,
  }, { enabled });
  const toggleStar = useToggleStoryStar();

  // Flatten infinite query pages into a single array
  const stories = useMemo(
    () => storiesData?.pages.flatMap((page) => page.stories) ?? [],
    [storiesData]
  );

  // Filter starred stories client-side if "starred" is selected
  const filteredStories = useMemo(() => {
    if (status === 'starred') {
      return stories.filter(s => s.is_starred);
    }
    return stories;
  }, [stories, status]);

  // Infinite scroll — trigger fetchNextPage when sentinel enters viewport
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleStarClick = (e: React.MouseEvent, storyId: string) => {
    e.stopPropagation();
    toggleStar.mutate(storyId);
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Search — hidden when FilterBar provides search externally */}
      {showSearch && (
        <div className="border-b border-border p-2.5 sm:p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('storyloop.search')}
              className="h-8 pl-8 sm:h-9 lg:h-10"
            />
          </div>
        </div>
      )}

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <>
            <StoryListSkeleton />
            <StoryListSkeleton />
            <StoryListSkeleton />
          </>
        ) : filteredStories.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground sm:p-8">
            <Circle className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">{t('storyloop.noStories')}</p>
          </div>
        ) : (
          <>
            {filteredStories.map((story) => (
              <StoryListItemComponent
                key={story.id}
                story={story}
                isSelected={story.id === selectedStoryId}
                onClick={() => onStorySelect(story.id)}
                onStarClick={(e) => handleStarClick(e, story.id)}
              />
            ))}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} />

            {/* Loading indicator for next page */}
            {isFetchingNextPage && (
              <div className="flex justify-center py-3">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Manual load-more fallback */}
            {hasNextPage && !isFetchingNextPage && (
              <div className="flex justify-center py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
