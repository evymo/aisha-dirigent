/**
 * AdminIntegrationPanel — Grid of registered integration services with health status.
 *
 * Shows all services from `integration_services` table with their status,
 * and provides embed/link actions for dashboard-capable services (Appsmith, NocoDB).
 *
 * Data source: `useIntegrationServices()` → `list_integration_services` RPC.
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Server,
  ExternalLink,
  Activity,
  LayoutDashboard,
  Database,
  Eye,
  GitBranch,
  Workflow,
  Heart,
  Link2,
  Link2Off,
} from "lucide-react";
import { useIntegrationServices } from "@/hooks/useIntegrationServices";
import {
  resolveIntegrationCapabilitySourceSummary,
  resolveIntegrationCapabilities,
  resolveIntegrationLaunchUrl,
} from "@/lib/integrations/serviceCapabilityResolver";
import type { IntegrationService } from "@/schemas/integrationServiceSchemas";

/** Map service_type to an icon. */
const SERVICE_TYPE_ICON: Record<string, React.ElementType> = {
  admin: LayoutDashboard,
  admin_bridge: Database,
  automation: Workflow,
  monitoring: Heart,
  observability: Eye,
  scm: GitBranch,
};

/** Map health_status to badge variant. */
function healthBadgeVariant(status: string): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "healthy":
      return "default";
    case "degraded":
      return "outline";
    case "down":
      return "destructive";
    default:
      return "secondary";
  }
}

/**
 * Single service card within the integration panel grid.
 */
function ServiceCard({ service }: { service: IntegrationService }) {
  const { t } = useTranslation();
  const Icon = SERVICE_TYPE_ICON[service.service_type] ?? Server;
  const capabilities = resolveIntegrationCapabilities(service);
  const source = resolveIntegrationCapabilitySourceSummary(service);
  const launchUrl = resolveIntegrationLaunchUrl(service) ?? service.base_url;
  const description =
    typeof service.config === "object" && service.config !== null
      ? (service.config as Record<string, unknown>).description
      : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted/50">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{service.display_name}</span>
          <Badge variant={healthBadgeVariant(service.health_status)} className="text-[10px] px-1.5 py-0">
            {service.health_status}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 uppercase">
            {t(`admin.integrations.diagnostics.sources.${source}`)}
          </Badge>
          {capabilities.ssoEnabled ? (
            <Link2 className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        {typeof description === "string" && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{description}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{launchUrl}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" asChild>
        <a href={launchUrl} target="_blank" rel="noopener noreferrer" title={service.display_name}>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  );
}

/**
 * Panel showing all registered integration services.
 */
export function AdminIntegrationPanel() {
  const { t } = useTranslation();
  const { data: services, isLoading, error } = useIntegrationServices();

  const healthyCount = services?.filter((s) => s.health_status === "healthy").length ?? 0;
  const totalCount = services?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t("admin.integrations.title")}
            </CardTitle>
            <CardDescription>{t("admin.integrations.subtitle")}</CardDescription>
          </div>
          {!isLoading && totalCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {t("admin.integrations.healthySummary", { healthy: healthyCount, total: totalCount })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={`svc-skeleton-${idx}`} className="h-20 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{t("common.somethingWentWrong")}</p>
        ) : services && services.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((svc) => (
              <ServiceCard key={svc.id} service={svc} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.integrations.noServices")}</p>
        )}
      </CardContent>
    </Card>
  );
}
