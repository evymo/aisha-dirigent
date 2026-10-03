/**
 * Admin page for monitoring Dirigent moderation sessions.
 *
 * View session history, decision timelines, and quality findings.
 * Read-only — sessions are created by Dirigent RPCs during development moderation.
 *
 * @module pages/admin/AdminModerationSessions
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useModerationSessions,
  useModerationDecisions,
} from "@/hooks/useModerationAdmin";

const SESSION_TYPES = [
  "chat_flow",
  "pre_commit",
  "pr_review",
  "test_strategy",
  "architecture",
  "estimation",
] as const;

const STATUSES = ["active", "completed", "escalated"] as const;

const GUIDANCE_LABELS: Record<string, string> = {
  beginner: "Educating",
  intermediate: "Collaborative",
  advanced: "Autonomous",
  expert: "Supervisory",
};

/** Map severity to Badge variant */
function severityVariant(
  severity: string,
): "default" | "destructive" | "secondary" | "outline" {
  switch (severity) {
    case "critical":
    case "error":
      return "destructive";
    case "warning":
      return "secondary";
    default:
      return "outline";
  }
}

/** Map session status to Badge variant */
function statusVariant(
  status: string,
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "escalated":
      return "destructive";
    case "completed":
      return "secondary";
    default:
      return "outline";
  }
}

/** Decision acceptance icon */
function AcceptanceIcon({ accepted }: { accepted: boolean | null }) {
  if (accepted === true) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (accepted === false) return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export default function AdminModerationSessions() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  const [sessionTypeFilter, setSessionTypeFilter] = useState<string | undefined>(
    undefined,
  );
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const {
    data: sessions,
    isLoading,
    refetch,
  } = useModerationSessions({
    sessionType: sessionTypeFilter,
    status: statusFilter,
    limit: 50,
  });

  const { data: decisions, isLoading: decisionsLoading } =
    useModerationDecisions(expandedSessionId ?? undefined);

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.noPermission")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-8 w-8" />
            {t("admin.moderation.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.moderation.description")}
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Select
          value={sessionTypeFilter ?? "all"}
          onValueChange={(v) =>
            setSessionTypeFilter(v === "all" ? undefined : v)
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("admin.moderation.sessionType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("admin.moderation.allTypes")}
            </SelectItem>
            {SESSION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`admin.moderation.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter ?? "all"}
          onValueChange={(v) =>
            setStatusFilter(v === "all" ? undefined : v)
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("common.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("admin.moderation.allStatuses")}
            </SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sessions list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.moderation.sessions")}</CardTitle>
          <CardDescription>
            {sessions?.length ?? 0} {t("admin.aiRunDetail.events")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {sessions?.map((session) => (
              <div
                key={session.id}
                className="border rounded-lg p-4 space-y-2"
              >
                {/* Session header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(session.status)}>
                      {session.status}
                    </Badge>
                    <Badge variant="outline">
                      {t(
                        `admin.moderation.types.${session.session_type}`,
                      )}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {GUIDANCE_LABELS[session.expertise_level] ?? session.expertise_level}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.critical_count > 0 && (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {session.critical_count}
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {session.decision_count}{" "}
                      {t("admin.moderation.decisions")}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setExpandedSessionId(
                          expandedSessionId === session.id
                            ? null
                            : session.id,
                        );
                      }}
                    >
                      {expandedSessionId === session.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Session meta */}
                <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
                  <div>
                    {t("common.created")}:{" "}
                    {new Date(session.created_at).toLocaleString()}
                  </div>
                  <div className="font-mono text-xs truncate">
                    {session.id}
                  </div>
                </div>

                {/* Expanded: decision list */}
                {expandedSessionId === session.id && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-semibold mb-3">
                      {t("admin.moderation.decisions")} (
                      {decisions?.length ?? 0})
                    </h4>
                    {decisionsLoading ? (
                      <Skeleton className="h-20" />
                    ) : decisions && decisions.length > 0 ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {decisions.map((decision) => (
                          <div
                            key={decision.id}
                            className="border rounded p-3 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={severityVariant(decision.severity)}
                                >
                                  {decision.severity}
                                </Badge>
                                <span className="text-sm font-medium">
                                  {t(
                                    `admin.moderation.decisionTypes.${decision.decision_type}`,
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <AcceptanceIcon
                                  accepted={decision.accepted}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {decision.accepted === true
                                    ? t("admin.moderation.accepted")
                                    : decision.accepted === false
                                      ? t("admin.moderation.dismissed")
                                      : t("admin.moderation.pending")}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm">
                              {decision.recommendation}
                            </p>
                            <div className="text-xs text-muted-foreground">
                              {new Date(
                                decision.created_at,
                              ).toLocaleTimeString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("admin.moderation.noDecisions")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {(!sessions || sessions.length === 0) && (
              <Alert>
                <AlertDescription>
                  {t("admin.moderation.empty")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
