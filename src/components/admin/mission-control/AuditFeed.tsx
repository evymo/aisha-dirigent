/**
 * AuditFeed — recent audit_journal entries at severity ≥ warning.
 *
 * Subscribes to audit_journal INSERT events; client-side severity filter
 * (since get_audit_journal supports exact match only). Shows action +
 * severity badge + entity + summary.
 */
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";

import { useAuditFeed } from "@/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> =
  {
    warning: "secondary",
    warn: "secondary",
    error: "destructive",
    critical: "destructive",
  };

export function AuditFeed() {
  const { t } = useTranslation();
  const { data: rows = [], isLoading, error } = useAuditFeed({ limit: 10 });

  return (
    <Card data-test="mc-audit-feed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4" aria-hidden="true" />
          {t("missionControl.audit.title", "Audit feed")}
          <Badge variant="outline" className="ml-auto text-[10px]">
            {rows.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.audit.subtitle",
            "Warnings, errors, and critical events from audit_journal.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && <Skeleton className="h-16" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              "missionControl.audit.empty",
              "No elevated audit entries — quiet system.",
            )}
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            data-test={`audit-${row.id}`}
            className={cn(
              "rounded border bg-muted/30 p-2 text-xs",
              row.severity.toLowerCase() === "critical" &&
                "border-destructive/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Badge
                variant={SEVERITY_VARIANT[row.severity.toLowerCase()] ?? "outline"}
                className="text-[10px] font-normal uppercase"
              >
                {row.severity}
              </Badge>
              <span className="font-medium">{row.action_type}</span>
              {row.entity_type && (
                <span className="text-muted-foreground">· {row.entity_type}</span>
              )}
            </div>
            {row.summary && (
              <p className="mt-0.5 truncate text-muted-foreground">
                {row.summary}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
