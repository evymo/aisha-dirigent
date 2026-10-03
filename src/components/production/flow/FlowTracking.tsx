/**
 * @fileoverview Flow Tracking main container component.
 * Provides tabbed interface for managing:
 * - Substances (tracked materials master data)
 * - Nodes (graph vertices: supplier/storage/process/finished/waste)
 * - Records + Balance (immutable movement log + dynamic balance)
 */
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlaskConical, Network, Activity, Cable, Container, BarChart3, Bell, Droplets, GitBranch } from "lucide-react";
import FlowSubstancesSection from "./FlowSubstancesSection";
import FlowNodesSection from "./FlowNodesSection";
import FlowRecordsSection from "./FlowRecordsSection";
import FlowInventorySection from "./FlowInventorySection";
import FlowIotIntegrationSection from "./FlowIotIntegrationSection";
import FlowNodeMonitoringDashboard from "./FlowNodeMonitoringDashboard";
import SensorAlertsPanel from "./SensorAlertsPanel";
import AngelsShareReportSection from "./AngelsShareReportSection";
import CrossBatchTraceabilityPanel from "./CrossBatchTraceabilityPanel";

/**
 * Main flow tracking container with sub-tabs.
 * Mounted as a tab in AdminProduction page.
 */
export default function FlowTracking() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("admin.production.flow.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("admin.production.flow.description")}
        </p>
      </div>

      <Tabs defaultValue="substances">
        <TabsList>
          <TabsTrigger value="substances" className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            {t("admin.production.flow.tabs.substances")}
          </TabsTrigger>
          <TabsTrigger value="nodes" className="flex items-center gap-2">
            <Network className="w-4 h-4" />
            {t("admin.production.flow.tabs.nodes")}
          </TabsTrigger>
          <TabsTrigger value="records" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            {t("admin.production.flow.tabs.records")}
          </TabsTrigger>
          <TabsTrigger value="iot" className="flex items-center gap-2">
            <Cable className="w-4 h-4" />
            {t("admin.production.flow.tabs.iot")}
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            {t("admin.production.flow.tabs.monitoring")}
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center gap-2">
            <Container className="w-4 h-4" />
            {t("admin.production.flow.tabs.inventory")}
          </TabsTrigger>
          <TabsTrigger value="sensorAlerts" className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            {t("admin.production.flow.tabs.sensorAlerts")}
          </TabsTrigger>
          <TabsTrigger value="angelsShare" className="flex items-center gap-2">
            <Droplets className="w-4 h-4" />
            {t("admin.production.flow.tabs.angelsShare")}
          </TabsTrigger>
          <TabsTrigger value="traceability" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            {t("admin.production.flow.tabs.traceability")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="substances" className="mt-6">
          <FlowSubstancesSection />
        </TabsContent>
        <TabsContent value="nodes" className="mt-6">
          <FlowNodesSection />
        </TabsContent>
        <TabsContent value="records" className="mt-6">
          <FlowRecordsSection />
        </TabsContent>
        <TabsContent value="iot" className="mt-6">
          <FlowIotIntegrationSection />
        </TabsContent>
        <TabsContent value="monitoring" className="mt-6">
          <FlowNodeMonitoringDashboard />
        </TabsContent>
        <TabsContent value="inventory" className="mt-6">
          <FlowInventorySection />
        </TabsContent>
        <TabsContent value="sensorAlerts" className="mt-6">
          <SensorAlertsPanel />
        </TabsContent>
        <TabsContent value="angelsShare" className="mt-6">
          <AngelsShareReportSection />
        </TabsContent>
        <TabsContent value="traceability" className="mt-6">
          <CrossBatchTraceabilityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
