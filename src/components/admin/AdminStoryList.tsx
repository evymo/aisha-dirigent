/**
 * AdminStoryList Component
 *
 * Renders a paginated, searchable list of all member stories
 * for admin/staff operational monitoring. Non-sensitive view:
 * anonymised member names, partner names, status badges.
 */

import { useState, useCallback, useMemo } from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAdminStories } from '@/hooks/useAdminStories';
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Star,
  Circle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', labelKey: 'admin.activityFeed.allTypes' },
  { value: 'inbox', labelKey: 'storyloop.inbox' },
  { value: 'in_progress', labelKey: 'storyloop.inProgress' },
  { value: 'scheduled', labelKey: 'storyloop.scheduled' },
  { value: 'archived', labelKey: 'storyloop.archived' },
  { value: 'starred', labelKey: 'storyloop.starred' },
];

/**
 * Admin-level story list with search and pagination.
 *
 * Shows all member stories across all partners with anonymised
 * display names and operational metadata.
 */
export function AdminStoryList() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  // Debounce search
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
    const trimmed = value.trim();
    // Simple debounce via timeout in state — we could use a proper debounce
    // but for admin views the query is server-side and staleTime handles it
    if (trimmed.length >= 2) {
      setDebouncedSearch(trimmed);
    } else if (trimmed.length === 0) {
      setDebouncedSearch(null);
    }
  }, []);

  const filters = useMemo(() => ({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: debouncedSearch,
    status: statusFilter === 'all' ? null : statusFilter,
  }), [debouncedSearch, page, statusFilter]);

  const { data, isLoading } = useAdminStories(filters);
  const stories = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(0);
  }, []);

  const priorityVariant = (priority: string): 'destructive' | 'default' | 'secondary' | 'outline' => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'default';
      default: return 'secondary';
    }
  };

  const statusBadgeClass = (status: string): string => {
    switch (status) {
      case 'inbox': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'scheduled': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'archived': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
      default: return '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('admin.stories.title')}
        </CardTitle>
        <CardDescription>{t('admin.stories.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search & Status filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t('admin.stories.searchPlaceholder')}
              className="h-9 pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton key={`story-skeleton-${idx}`} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : stories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Circle className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">{t('admin.stories.noStories')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stories.map((story) => {
              const timeAgo = formatDistanceToNow(new Date(story.last_activity_at), {
                addSuffix: true,
                locale: dateLocale,
              });

              return (
                <Link
                  key={story.id}
                  to={`/partner/storyloop/${story.id}`}
                  className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {story.is_starred && (
                          <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
                        )}
                        <span className="truncate font-medium text-sm">
                          {story.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn('shrink-0 text-[10px]', statusBadgeClass(story.status))}
                        >
                          {t(`storyloop.statuses.${story.status === 'in_progress' ? 'inProgress' : story.status}`)}
                        </Badge>
                        {story.priority !== 'normal' && (
                          <Badge variant={priorityVariant(story.priority)} className="shrink-0 text-[10px]">
                            {story.priority}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{story.user_display_name ?? t('common.unknown')}</span>
                        {story.partner_display_name && (
                          <>
                            <span className="text-border">|</span>
                            <span>{story.partner_display_name}</span>
                          </>
                        )}
                        {story.study_name && (
                          <>
                            <span className="text-border">|</span>
                            <span>{story.study_name}</span>
                          </>
                        )}
                      </div>
                      {story.last_entry_preview && (
                        <p className="mt-1 truncate text-xs text-muted-foreground/70">
                          {story.last_entry_preview}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                      <span>{timeAgo}</span>
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3" />
                        <span>{story.entry_count}</span>
                        {story.unread_count > 0 && (
                          <Badge variant="default" className="h-4 px-1.5 text-[10px]">
                            {story.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {story.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {story.labels.slice(0, 3).map((label) => (
                        <Badge
                          key={label.label}
                          variant="outline"
                          className="h-4 px-1 text-[10px]"
                        >
                          {label.label}
                        </Badge>
                      ))}
                      {story.labels.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{story.labels.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              {t('admin.stories.pagination', {
                from: page * PAGE_SIZE + 1,
                to: Math.min((page + 1) * PAGE_SIZE, totalCount),
                total: totalCount,
              })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
