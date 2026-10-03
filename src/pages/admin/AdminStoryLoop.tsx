import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminStoryLoopOverview } from "@/hooks/useStoryLoopAdmin";
import { useAdminPendingCounts, useAdminActivityFeed } from "@/hooks/useAdminActivityFeed";
import { AdminActivityCard } from "@/components/admin/AdminActivityCard";
import { AdminStoryList } from "@/components/admin/AdminStoryList";
import { AdminIntegrationPanel } from "@/components/admin/AdminIntegrationPanel";
import { AdminIntegrationWorkspace } from "@/components/admin/AdminIntegrationWorkspace";
import {
  BookOpen,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Users,
  Bell,
  Archive,
  Inbox,
  Clock3,
  CreditCard,
  UserX,
  FlaskConical,
  DollarSign,
  UserCheck,
  AlertTriangle,
  Shield,
  ShoppingBag,
  Search,
  Filter,
  Loader2,
  LayoutDashboard,
} from "lucide-react";
import type { ActivityFeedItemType, AdminPendingCounts } from "@/hooks/useAdminActivityFeed";

const FEED_PAGE_SIZE = 20;

/** Map each action type to its corresponding key in AdminPendingCounts. */
const ACTION_TYPE_TO_COUNT_KEY: Record<ActivityFeedItemType, keyof AdminPendingCounts> = {
  consultant_pending: "pending_consultants",
  contribution_pending: "pending_contributions",
  deletion_pending: "pending_deletions",
  registration_pending: "pending_registrations",
  escalation_pending: "pending_escalations",
  moderation_pending: "pending_moderation",
  order_pending: "pending_orders",
  subscription_pending: "pending_subscriptions",
};

const ACTION_TYPES: { icon: React.ElementType; labelKey: string; value: ActivityFeedItemType }[] = [
  { icon: CreditCard, labelKey: "activityFeed.types.subscription", value: "subscription_pending" },
  { icon: UserX, labelKey: "activityFeed.types.deletion", value: "deletion_pending" },
  { icon: FlaskConical, labelKey: "activityFeed.types.registration", value: "registration_pending" },
  { icon: DollarSign, labelKey: "activityFeed.types.contribution", value: "contribution_pending" },
  { icon: UserCheck, labelKey: "activityFeed.types.consultant", value: "consultant_pending" },
  { icon: AlertTriangle, labelKey: "activityFeed.types.escalation", value: "escalation_pending" },
  { icon: Shield, labelKey: "activityFeed.types.moderation", value: "moderation_pending" },
  { icon: ShoppingBag, labelKey: "activityFeed.types.order", value: "order_pending" },
];

/**
 * Admin entry page for StoryLoop-related operations.
 *
 * This page is intentionally non-sensitive and acts as a guarded gateway
 * to operational views (audit/monitoring) and role-gated workspaces.
 */
export default function AdminStoryLoop() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = usePermissions();
  const { data: overview, isLoading: isOverviewLoading, error: overviewError } = useAdminStoryLoopOverview();

  // ─── Pending counts ──────────────────────────────────────
  const { data: pendingCounts, isLoading: isPendingLoading } = useAdminPendingCounts();

  // ─── Activity feed state ─────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActivityFeedItemType | "all">("all");
  const [feedPage, setFeedPage] = useState(0);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      setFeedPage(0);
      // Simple debounce via timeout ref in the handler
      const trimmed = value.trim();
      // We use a naive approach: set after a short delay
      // (For production, consider useDeferredValue or a debounce hook)
      setDebouncedSearch(trimmed.length >= 2 ? trimmed : null);
    },
    [],
  );

  const handleFilterChange = useCallback((value: string) => {
    setActionFilter(value as ActivityFeedItemType | "all");
    setFeedPage(0);
  }, []);

  const feedParams = useMemo(
    () => ({
      actionType: actionFilter === "all" ? null : actionFilter,
      limit: FEED_PAGE_SIZE,
      offset: feedPage * FEED_PAGE_SIZE,
      search: debouncedSearch,
    }),
    [actionFilter, debouncedSearch, feedPage],
  );

  const {
    data: feedItems,
    isLoading: isFeedLoading,
    isFetching: isFeedFetching,
  } = useAdminActivityFeed(feedParams);

  const canViewMemberDiary = hasPermission("view_studies");
  const canViewPartnerStoryLoop = hasPermission("view_partner_dashboard");
  const canViewPhi = hasPermission("view_sensitive_data");
  const numberFormatter = new Intl.NumberFormat(i18n.language);

  const totalPending = pendingCounts
    ? Object.values(pendingCounts).reduce((sum, v) => sum + v, 0)
    : 0;

  const metrics = overview ?? {
    total_stories: 0,
    active_stories: 0,
    stories_active_7d: 0,
    stories_active_30d: 0,
    inbox_count: 0,
    in_progress_count: 0,
    scheduled_count: 0,
    archived_count: 0,
    trash_count: 0,
    starred_count: 0,
    unread_total: 0,
    total_entries: 0,
    entries_7d: 0,
    entries_30d: 0,
    reminders_upcoming_7d: 0,
    reminders_overdue: 0,
    partners_active: 0,
    members_covered: 0,
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground sm:text-3xl">{t("storyloop.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground sm:text-base">{t("partnerUsers.privacyNotice.description")}</p>
        </div>
        <Badge variant="secondary" className="w-fit self-start lg:self-auto">
          {t("admin.roles.capabilities.secureAccess")}
        </Badge>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{t("common.warning")}</AlertTitle>
        <AlertDescription>{t("admin.roles.capabilities.viewSensitiveDataTooltip")}</AlertDescription>
      </Alert>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="mr-1.5 h-4 w-4" />
            {t("admin.overview.title")}
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <LayoutDashboard className="mr-1.5 h-4 w-4" />
            {t("admin.integrations.title")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 sm:space-y-6">

      {overviewError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{t("common.error")}</AlertTitle>
          <AlertDescription>{t("common.somethingWentWrong")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader className="pb-4">
            <CardTitle>{t("storyloop.title")}</CardTitle>
            <CardDescription>{t("admin.overview.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {isOverviewLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={`overview-skeleton-${index}`} className="space-y-2 rounded-lg border p-3 sm:p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-8 w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <MessageSquare className="h-4 w-4" />
                    <span>{`${t("common.total")} ${t("storyloop.title")}`}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.total_stories)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <Activity className="h-4 w-4" />
                    <span>{`${t("common.active")} ${t("storyloop.days", { count: 30 })}`}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.stories_active_30d)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <Bell className="h-4 w-4" />
                    <span>{t("admin.notifications.deliveries.readStates.unread")}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.unread_total)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <Clock3 className="h-4 w-4" />
                    <span>{t("storyloop.reminders.upcoming")}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.reminders_upcoming_7d)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <ShieldCheck className="h-4 w-4" />
                    <span>{t("navigation.partners")}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.partners_active)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <Users className="h-4 w-4" />
                    <span>{t("partnerUsers.stats.total")}</span>
                  </div>
                  <p className="text-2xl font-semibold leading-none sm:text-3xl">{numberFormatter.format(metrics.members_covered)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="pb-4">
            <CardTitle>{t("common.latest")}</CardTitle>
            <CardDescription>{`${t("common.latest")} ${t("storyloop.days", { count: 30 })}`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isOverviewLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`window-skeleton-${index}`} className="h-12 w-full" />
              ))
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm leading-tight text-muted-foreground">{`${t("common.active")} ${t("storyloop.days", { count: 7 })}`}</div>
                  <div className="text-lg font-semibold">{numberFormatter.format(metrics.stories_active_7d)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm leading-tight text-muted-foreground">{`${t("storyloop.entry.message")} ${t("storyloop.days", { count: 7 })}`}</div>
                  <div className="text-lg font-semibold">{numberFormatter.format(metrics.entries_7d)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm leading-tight text-muted-foreground">{`${t("storyloop.entry.message")} ${t("storyloop.days", { count: 30 })}`}</div>
                  <div className="text-lg font-semibold">{numberFormatter.format(metrics.entries_30d)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm leading-tight text-muted-foreground">{t("storyloop.reminders.overdue")}</div>
                  <div className="text-lg font-semibold">{numberFormatter.format(metrics.reminders_overdue)}</div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>{t("common.status")}</CardTitle>
          <CardDescription>{t("storyloop.title")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="h-4 w-4" />
              <span>{t("storyloop.inbox")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.inbox_count)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span>{t("storyloop.inProgress")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.in_progress_count)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              <span>{t("storyloop.scheduled")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.scheduled_count)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Archive className="h-4 w-4" />
              <span>{t("storyloop.archived")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.archived_count)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bell className="h-4 w-4" />
              <span>{t("storyloop.starred")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.starred_count)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Archive className="h-4 w-4" />
              <span>{t("storyloop.trash")}</span>
            </div>
            <span className="text-lg font-semibold sm:text-xl">{numberFormatter.format(metrics.trash_count)}</span>
          </div>
        </CardContent>
      </Card>

      {/* ─── Pending Action Badges ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                {t("admin.activityFeed.pendingActions")}
              </CardTitle>
              <CardDescription>{t("admin.activityFeed.pendingActionsDescription")}</CardDescription>
            </div>
            {totalPending > 0 && (
              <Badge variant="destructive" className="text-sm">
                {totalPending}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isPendingLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <Skeleton key={`pending-skeleton-${idx}`} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ACTION_TYPES.map(({ icon: TypeIcon, labelKey, value }) => {
                const count = pendingCounts?.[ACTION_TYPE_TO_COUNT_KEY[value]] ?? 0;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleFilterChange(value)}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
                      actionFilter === value ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <TypeIcon className="h-4 w-4" />
                      <span>{t(labelKey)}</span>
                    </div>
                    <Badge variant={count > 0 ? "destructive" : "secondary"} className="text-xs">
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Activity Feed ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t("admin.activityFeed.title")}
          </CardTitle>
          <CardDescription>{t("admin.activityFeed.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search & filter bar */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("admin.activityFeed.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground sm:block hidden" />
              <Select value={actionFilter} onValueChange={handleFilterChange}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder={t("admin.activityFeed.filterByType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.activityFeed.allTypes")}</SelectItem>
                  {ACTION_TYPES.map(({ labelKey, value }) => (
                    <SelectItem key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Feed items */}
          {isFeedLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Skeleton key={`feed-skeleton-${idx}`} className="h-24 w-full" />
              ))}
            </div>
          ) : feedItems && feedItems.length > 0 ? (
            <div className="space-y-3">
              {isFeedFetching && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("common.loading")}
                </div>
              )}
              {feedItems.map((item) => (
                <AdminActivityCard key={item.item_id} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Inbox className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">{t("admin.activityFeed.noItems")}</p>
            </div>
          )}

          {/* Pagination */}
          {feedItems && feedItems.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={feedPage === 0}
                onClick={() => setFeedPage((p) => Math.max(0, p - 1))}
              >
                {t("common.previous")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("admin.activityFeed.page", { page: feedPage + 1 })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={feedItems.length < FEED_PAGE_SIZE}
                onClick={() => setFeedPage((p) => p + 1)}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── All Stories (Admin view) ─────────────────────────── */}
      <AdminStoryList />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t("admin.auditJournal.title")}
            </CardTitle>
            <CardDescription>{t("admin.auditJournal.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/admin/audit-journal">{t("common.viewDetails")}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t("admin.sessionMonitoring.title")}
            </CardTitle>
            <CardDescription>{t("admin.sessionMonitoring.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/admin/session-monitoring">{t("common.viewDetails")}</Link>
            </Button>
          </CardContent>
        </Card>

        {canViewMemberDiary && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {t("memberDiary.title")}
              </CardTitle>
              <CardDescription>{t("header.memberSection")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link to="/member/story">{t("common.viewDetails")}</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {canViewPartnerStoryLoop && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t("storyloop.title")}
              </CardTitle>
              <CardDescription>{t("header.partnerSection")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={canViewPhi ? "default" : "secondary"}>
                  {canViewPhi ? t("admin.roles.capabilities.viewSensitiveData") : t("admin.roles.capabilities.secureAccess")}
                </Badge>
              </div>
              {canViewPhi ? (
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link to="/partner/storyloop">{t("common.viewDetails")}</Link>
                </Button>
              ) : (
                <Button variant="outline" disabled className="w-full sm:w-auto">
                  {t("errors.accessDenied")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4 sm:space-y-6">
          <AdminIntegrationPanel />
          <AdminIntegrationWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}
