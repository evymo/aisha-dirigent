import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, UserX, Filter } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useAdminDeletionRequests } from "@/hooks/useAdminDeletionRequests";

const STATUSES = ["all", "pending", "cancelled", "completed"] as const;

/**
 * Admin page for managing account deletion requests.
 * Displays a filterable table with all deletion requests, status badges,
 * scheduled dates, and days remaining.
 */
export default function AdminDeletionRequests() {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const locale = getDateFnsLocale(i18n.language);

  const { data: requests, isLoading, refetch } = useAdminDeletionRequests({
    status: statusFilter !== "all" ? statusFilter : null,
    limit: 100,
  });

  const pendingCount = requests?.filter((r) => r.status === "pending").length ?? 0;
  const cancelledCount = requests?.filter((r) => r.status === "cancelled").length ?? 0;
  const completedCount = requests?.filter((r) => r.status === "completed").length ?? 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="destructive">{t("admin.deletionRequests.statuses.pending")}</Badge>;
      case "cancelled":
        return <Badge variant="secondary">{t("admin.deletionRequests.statuses.cancelled")}</Badge>;
      case "completed":
        return <Badge variant="outline">{t("admin.deletionRequests.statuses.completed")}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDaysRemaining = (scheduledDate: string, status: string) => {
    if (status !== "pending") return null;
    const days = Math.max(0, differenceInDays(new Date(scheduledDate), new Date()));
    return (
      <span className={days <= 3 ? "text-destructive font-semibold" : "text-muted-foreground"}>
        {t("admin.deletionRequests.daysRemaining", { count: days })}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.deletionRequests.title")}</h1>
          <p className="text-muted-foreground">{t("admin.deletionRequests.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.deletionRequests.statuses.pending")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-2xl font-bold text-destructive">{pendingCount}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.deletionRequests.statuses.cancelled")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-2xl font-bold">{cancelledCount}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.deletionRequests.statuses.completed")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-2xl font-bold">{completedCount}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("admin.deletionRequests.filterByStatus")} />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? t("admin.deletionRequests.allStatuses")
                  : t(`admin.deletionRequests.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !requests || requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <UserX className="h-12 w-12 mb-3 opacity-50" />
              <p>{t("admin.deletionRequests.noRequests")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.deletionRequests.columns.user")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.email")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.status")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.requestedAt")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.scheduledAt")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.remaining")}</TableHead>
                  <TableHead>{t("admin.deletionRequests.columns.reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">{req.display_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{req.user_email}</TableCell>
                    <TableCell>{getStatusBadge(req.status)}</TableCell>
                    <TableCell>
                      {format(new Date(req.requested_at), "Pp", { locale })}
                    </TableCell>
                    <TableCell>
                      {format(new Date(req.scheduled_deletion_at), "PPP", { locale })}
                    </TableCell>
                    <TableCell>{getDaysRemaining(req.scheduled_deletion_at, req.status)}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={req.reason ?? undefined}>
                      {req.reason || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
