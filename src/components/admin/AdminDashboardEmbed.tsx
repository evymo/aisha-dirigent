/**
 * AdminDashboardEmbed — Iframe embed for external no-code dashboards.
 *
 * Mirrors the VS Code extension's `dashboardView.ts` pattern:
 * - Embeds Appsmith (or any service) as an iframe
 * - Sends storyContext via postMessage (same API contract)
 * - Resolves embed URL from `integration_services` table
 *
 * This creates a unified dashboard surface across:
 * - Web admin (this component)
 * - VS Code extension (dashboardView.ts)
 * Both use the same postMessage contract: `{ type: "storyContext", storyId, branch }`
 */

import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, RefreshCw, AlertTriangle, Link2, Link2Off } from "lucide-react";
import {
  resolveIntegrationCapabilities,
  resolveIntegrationCapabilitySourceSummary,
  resolveIntegrationLaunchUrl,
} from "@/lib/integrations/serviceCapabilityResolver";
import type { IntegrationService } from "@/schemas/integrationServiceSchemas";

interface AdminDashboardEmbedProps {
  /** Integration service record (from useIntegrationServiceByName). */
  service: IntegrationService | null | undefined;
  /** Whether service data is loading. */
  isLoading: boolean;
  /** Optional story ID to pass via postMessage. */
  storyId?: string | null;
  /** Minimum height of the iframe. */
  minHeight?: string;
}

/**
 * Embeddable admin dashboard with storyContext postMessage sync.
 *
 * Uses the same postMessage API contract as the VS Code extension
 * `dashboardView.ts` — `{ type: "storyContext", storyId, branch }`.
 */
export function AdminDashboardEmbed({
  isLoading,
  minHeight = "600px",
  service,
  storyId,
}: AdminDashboardEmbedProps) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /**
   * Send story context to the embedded iframe.
   * Same contract as VS Code extension: `{ type: "storyContext", storyId, branch }`
   */
  const sendStoryContext = useCallback(() => {
    if (!iframeRef.current?.contentWindow || !service?.base_url) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "storyContext", storyId: storyId ?? null, branch: null },
      service.base_url,
    );
  }, [service?.base_url, storyId]);

  useEffect(() => {
    if (!service?.base_url) return;
    // Send context after iframe loads
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => sendStoryContext();
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [sendStoryContext, service?.base_url]);

  // Re-send when storyId changes
  useEffect(() => {
    sendStoryContext();
  }, [sendStoryContext]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent>
          <Skeleton className="w-full" style={{ minHeight }} />
        </CardContent>
      </Card>
    );
  }

  if (!service) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertTriangle className="mb-3 h-10 w-10 opacity-50" />
          <p className="text-sm">{t("admin.integrations.serviceNotFound")}</p>
        </CardContent>
      </Card>
    );
  }

  // Prefer embed_path or embed_url from config (set by provision-appsmith.sh) over raw base_url
  const config = typeof service.config === "object" && service.config !== null
    ? (service.config as Record<string, unknown>)
    : {};
  const capabilities = resolveIntegrationCapabilities(service);
  const sourceSummary = resolveIntegrationCapabilitySourceSummary(service);
  const launchUrl = resolveIntegrationLaunchUrl(service) ?? service.base_url;
  const embedPath = typeof config.embed_path === "string"
    ? config.embed_path
    : typeof config.embed_url === "string"
      ? config.embed_url
      : null;
  const dashboardUrl = (embedPath ?? service.base_url).replace(/\/+$/, "");

  // When service health is unknown or down, show a link instead of embedding
  // a broken iframe (e.g. Appsmith behind OAuth2 Proxy needs setup first).
  if (service.health_status !== "healthy") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {service.display_name}
                <Badge
                  variant={service.health_status === "degraded" ? "outline" : "secondary"}
                  className="text-xs"
                >
                  {service.health_status}
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {t(`admin.integrations.diagnostics.sources.${sourceSummary}`)}
                </Badge>
                {capabilities.ssoEnabled ? (
                  <Link2 className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </CardTitle>
              <CardDescription className="text-xs">{dashboardUrl}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertTriangle className="mb-3 h-10 w-10 opacity-50" />
          <p className="mb-4 text-sm">{t("admin.integrations.serviceUnavailable")}</p>
          <Button variant="outline" size="sm" asChild>
            <a href={launchUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {capabilities.ssoEnabled
                ? t("admin.integrations.launchSso")
                : t("admin.integrations.launchDirect")}
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {service.display_name}
              <Badge
                variant={service.health_status === "healthy" ? "default" : "secondary"}
                className="text-xs"
              >
                {service.health_status}
              </Badge>
              <Badge variant="outline" className="text-[10px] uppercase">
                {t(`admin.integrations.diagnostics.sources.${sourceSummary}`)}
              </Badge>
              {capabilities.ssoEnabled ? (
                <Link2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </CardTitle>
            <CardDescription className="text-xs">{dashboardUrl}</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={sendStoryContext}
              title={t("common.refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
            >
              <a
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={service.display_name}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          ref={iframeRef}
          src={dashboardUrl}
          title={service.display_name}
          className="w-full border-0 rounded-b-lg"
          style={{ minHeight }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      </CardContent>
    </Card>
  );
}
