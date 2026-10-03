/**
 * StoryLoop discussion thread list.
 *
 * Renders knowledge-base topics in the same list panel used by case stories.
 */

import React from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import { Search, MessageSquare, Lock, ShieldCheck, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDiscussionThreads, type DiscussionThread } from '@/hooks/useStoryLoopDiscussions';
import { formatDistanceToNow } from 'date-fns';
interface DiscussionListProps {
  search: string;
  onSearchChange: (search: string) => void;
  selectedDiscussionId: string | null;
  onDiscussionSelect: (topicId: string) => void;
  enabled?: boolean;
  /** Hide embedded search (when FilterBar provides search externally). */
  showSearch?: boolean;
}

interface DiscussionListItemProps {
  thread: DiscussionThread;
  isSelected: boolean;
  onClick: () => void;
}

function DiscussionListItem({ thread, isSelected, onClick }: DiscussionListItemProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const timeAgo = formatDistanceToNow(new Date(thread.updated_at), {
    addSuffix: true,
    locale: dateLocale,
  });

  const topicIcon =
    thread.visibility === 'members' ? (
      <Lock className="h-3.5 w-3.5" />
    ) : thread.verification_status === 'verified' ? (
      <ShieldCheck className="h-3.5 w-3.5" />
    ) : (
      <BookOpen className="h-3.5 w-3.5" />
    );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border-b border-border p-2.5 text-left transition-colors sm:p-3 lg:px-3.5 lg:py-3',
        'hover:bg-muted/50',
        isSelected && 'bg-accent'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-muted-foreground">{topicIcon}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium lg:text-[15px]">{thread.title}</span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo}</span>
          </div>

          {thread.summary && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground lg:text-[13px]">{thread.summary}</p>
          )}

          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {thread.visibility === 'members'
                ? t('knowledge.visibility.members')
                : t('knowledge.visibility.public')}
            </Badge>
            {thread.verification_status === 'verified' && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {t('knowledge.verified')}
              </Badge>
            )}
            <Badge variant="default" className="ml-auto h-4 px-1.5 text-[10px]">
              {t('storyloop.discussions.postsCount', { count: thread.post_count })}
            </Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

function DiscussionListSkeleton() {
  return (
    <div className="border-b border-border p-3">
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <div className="flex-1 space-y-2">
          <div className="flex justify-between gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders searchable knowledge discussion topics in StoryLoop list panel.
 */
export function DiscussionList({
  search,
  onSearchChange,
  selectedDiscussionId,
  onDiscussionSelect,
  enabled = true,
  showSearch = true,
}: DiscussionListProps) {
  const { t } = useTranslation();
  const { data: threads, isLoading } = useDiscussionThreads({
    search: search || null,
  });

  const filteredThreads = React.useMemo(() => {
    if (!enabled) return [];
    return threads ?? [];
  }, [enabled, threads]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {showSearch && (
        <div className="border-b border-border p-2.5 sm:p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('knowledge.search_placeholder')}
              className="h-8 pl-8 sm:h-9 lg:h-10"
            />
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        {!enabled ? (
          <div className="p-6 text-center text-muted-foreground sm:p-8">
            <MessageSquare className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">{t('storyloop.discussions.selectThread')}</p>
          </div>
        ) : isLoading ? (
          <>
            <DiscussionListSkeleton />
            <DiscussionListSkeleton />
            <DiscussionListSkeleton />
          </>
        ) : filteredThreads.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground sm:p-8">
            <MessageSquare className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">{t('knowledge.no_topics')}</p>
          </div>
        ) : (
          filteredThreads.map((thread) => (
            <DiscussionListItem
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedDiscussionId}
              onClick={() => onDiscussionSelect(thread.id)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
