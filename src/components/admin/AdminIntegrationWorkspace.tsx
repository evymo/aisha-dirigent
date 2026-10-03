import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, ExternalLink, LayoutDashboard, Link2, Link2Off, Network } from "lucide-react";
import { useIntegrationServicesByNames } from "@/hooks/useIntegrationServices";
import { AdminDashboardEmbed } from "@/components/admin/AdminDashboardEmbed";
import {
  resolveIntegrationCapabilityDetails,
  resolveIntegrationCapabilitySourceSummary,
  resolveIntegrationCapabilities,
  resolveIntegrationLaunchUrl,
} from "@/lib/integrations/serviceCapabilityResolver";

interface ServiceDescriptor {
  icon: React.ElementType;
  name: string;
  translationKey: string;
}

const SERVICE_DESCRIPTORS: ServiceDescriptor[] = [
  { icon: LayoutDashboard, name: "appsmith", translationKey: "admin.integrations.services.appsmith" },
  { icon: Network, name: "langfuse", translationKey: "admin.integrations.services.langfuse" },
  { icon: Network, name: "n8n", translationKey: "admin.integrations.services.n8n" },
];


/**
 * Unified integrations workspace for Appsmith, Langfuse and n8n.
 */
export function AdminIntegrationWorkspace() {
  const { t } = useTranslation();
  const [activeService, setActiveService] = useState<string>("appsmith");

  const serviceNames = useMemo(() => SERVICE_DESCRIPTORS.map((descriptor) => descriptor.name), []);
  const { data: servicesByName, isLoading } = useIntegrationServicesByNames(serviceNames);

  const serviceMap = useMemo(
    () => ({
      appsmith: servicesByName?.appsmith ?? null,
      langfuse: servicesByName?.langfuse ?? null,
      n8n: servicesByName?.n8n ?? null,
    }),
    [servicesByName],
  );

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>{t("admin.integrations.workspaceTitle")}</CardTitle>
        <CardDescription>{t("admin.integrations.workspaceSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeService} onValueChange={setActiveService} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            {SERVICE_DESCRIPTORS.map((descriptor) => {
              const service = serviceMap[descriptor.name as keyof typeof serviceMap];
              const capabilities = resolveIntegrationCapabilities(service);
              const tabSource = resolveIntegrationCapabilitySourceSummary(service);
              const Icon = descriptor.icon;

              return (
                <TabsTrigger key={descriptor.name} value={descriptor.name} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{t(descriptor.translationKey)}</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">
                    {t(`admin.integrations.diagnostics.sources.${tabSource}`)}
                  </Badge>
                  {capabilities.ssoEnabled ? (
                    <Link2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {SERVICE_DESCRIPTORS.map((descriptor) => {
            const service = serviceMap[descriptor.name as keyof typeof serviceMap];
            const capabilities = resolveIntegrationCapabilities(service);
            const capabilityDetails = resolveIntegrationCapabilityDetails(service);
            const launchUrl = resolveIntegrationLaunchUrl(service);
            const rawConfig = service?.config ? JSON.stringify(service.config, null, 2) : "{}";

            return (
              <TabsContent key={descriptor.name} value={descriptor.name} className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={capabilities.ssoEnabled ? "default" : "secondary"}>
                    {t("admin.integrations.capabilityLabels.sso")}
                  </Badge>
                  <Badge variant={capabilities.embedEnabled ? "default" : "secondary"}>
                    {t("admin.integrations.capabilityLabels.embed")}
                  </Badge>
                  <Badge variant={capabilities.contextSyncEnabled ? "default" : "secondary"}>
                    {t("admin.integrations.capabilityLabels.contextSync")}
                  </Badge>
                  {service?.health_status && (
                    <Badge variant={service.health_status === "healthy" ? "default" : "outline"}>
                      {service.health_status}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild disabled={!launchUrl}>
                    <a href={launchUrl ?? "#"} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {capabilities.ssoEnabled
                        ? t("admin.integrations.launchSso")
                        : t("admin.integrations.launchDirect")}
                    </a>
                  </Button>
                  {capabilities.ssoEnabled && (
                    <Badge variant="outline">{t("admin.integrations.ssoPreferred")}</Badge>
                  )}
                </div>

                {!service && !isLoading && (
                  <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{t("admin.integrations.notConfigured")}</span>
                  </div>
                )}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t("admin.integrations.diagnostics.title")}</CardTitle>
                    <CardDescription>
                      {t("admin.integrations.diagnostics.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 text-xs md:grid-cols-3">
                      <div className="rounded-md border p-2">
                        <div className="text-muted-foreground">
                          {t("admin.integrations.capabilityLabels.sso")}
                        </div>
                        <div className="font-medium">
                          {String(capabilityDetails.ssoEnabled.value)}
                        </div>
                        <div className="text-muted-foreground">
                          {t(`admin.integrations.diagnostics.sources.${capabilityDetails.ssoEnabled.source}`)}
                        </div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-muted-foreground">
                          {t("admin.integrations.capabilityLabels.embed")}
                        </div>
                        <div className="font-medium">
                          {String(capabilityDetails.embedEnabled.value)}
                        </div>
                        <div className="text-muted-foreground">
                          {t(`admin.integrations.diagnostics.sources.${capabilityDetails.embedEnabled.source}`)}
                        </div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-muted-foreground">
                          {t("admin.integrations.capabilityLabels.contextSync")}
                        </div>
                        <div className="font-medium">
                          {String(capabilityDetails.contextSyncEnabled.value)}
                        </div>
                        <div className="text-muted-foreground">
                          {t(`admin.integrations.diagnostics.sources.${capabilityDetails.contextSyncEnabled.source}`)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">
                        {t("admin.integrations.diagnostics.rawConfig")}
                      </div>
                      <pre className="max-h-44 overflow-auto rounded-md border bg-muted p-2 text-xs">
                        {rawConfig}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                {capabilities.embedEnabled ? (
                  <AdminDashboardEmbed
                    service={service}
                    isLoading={isLoading}
                    minHeight="680px"
                  />
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{t("admin.integrations.embeddingDisabled")}</span>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
