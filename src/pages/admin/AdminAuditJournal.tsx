import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, RefreshCw } from "lucide-react";
import { useAuditJournal, useAuditJournalStats, JournalArea, JournalSeverity, JournalActionType } from "@/hooks/useAuditJournal";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useAuditJournalColumns } from "./audit-journal-columns";

const AREAS: JournalArea[] = [
  'admin', 'appointments', 'auth', 'blockchain', 'chat', 'operational_data',
  'consents', 'content', 'documents', 'registrations', 'integration',
  'logistics', 'members', 'memberships', 'notifications', 'orders',
  'partner_matching', 'partners', 'production', 'products', 'profile',
  'research', 'studies', 'subscriptions', 'system', 'tokens', 'users',
];

const SEVERITIES: JournalSeverity[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical'];

const ACTION_TYPES: JournalActionType[] = [
  'access', 'approve', 'assign', 'cancel', 'complete', 'create',
  'delete', 'error', 'export', 'integration', 'login', 'logout',
  'read', 'reject', 'scheduled_task', 'submit', 'system_event',
  'update', 'view',
];

export default function AdminAuditJournal() {
  const { t } = useTranslation();
  const columns = useAuditJournalColumns();
  const [search, setSearch] = useState("");
  // Keep filters for server-side query, but the Table handles display
  const [areaFilter, setAreaFilter] = useState<JournalArea | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<JournalSeverity | "all">("all");
  const [actionFilter, setActionFilter] = useState<JournalActionType | "all">("all");

  const { data: entries, isLoading, refetch } = useAuditJournal({
    area: areaFilter !== "all" ? areaFilter : undefined,
    severity: severityFilter !== "all" ? severityFilter : undefined,
    actionType: actionFilter !== "all" ? actionFilter : undefined,
    search: search || undefined,
    limit: 200,
  });

  const { data: stats } = useAuditJournalStats();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.auditJournal.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.auditJournal.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("admin.auditJournal.refresh")}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.auditJournal.stats.today")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats?.total || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.auditJournal.stats.warnings")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">
              {(stats?.bySeverity?.warning || 0) + (stats?.bySeverity?.error || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.auditJournal.severities.critical")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              {stats?.bySeverity?.critical || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.auditJournal.areas.production")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats?.byArea?.production || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("admin.auditJournal.filters.search")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={areaFilter} onValueChange={(v) => setAreaFilter(v as JournalArea | "all")}>
              <SelectTrigger className="w-[150px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t("admin.auditJournal.filters.area")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.auditJournal.filters.allAreas")}</SelectItem>
                {AREAS.map((area) => (
                  <SelectItem key={area} value={area}>
                    {t(`admin.auditJournal.areas.${area}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as JournalSeverity | "all")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("admin.auditJournal.filters.severity")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.auditJournal.filters.allSeverities")}</SelectItem>
                {SEVERITIES.map((sev) => (
                  <SelectItem key={sev} value={sev}>
                    {t(`admin.auditJournal.severities.${sev}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as JournalActionType | "all")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("admin.auditJournal.filters.action")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.auditJournal.filters.allActions")}</SelectItem>
                {ACTION_TYPES.map((action) => (
                  <SelectItem key={action} value={action}>
                    {t(`admin.auditJournal.actions.${action}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Journal Table */}
      <Card>
        <CardContent className="p-6">
          {!isLoading ? (
            <DataTable columns={columns} data={entries || []} />
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
