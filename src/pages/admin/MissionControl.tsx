/**
 * MissionControl — `/admin/mission-control` multi-pane landing.
 *
 * 12-column responsive grid laying out 6 simultaneous live panes. Each
 * pane subscribes to its own realtime channel via useLiveTable (the shared
 * registry dedupes per (table, filter) tuple, so this page costs 6 channels).
 */
import { useTranslation } from "react-i18next";
import { LayoutDashboard } from "lucide-react";

import { LiveAgentsStrip } from "@/components/admin/mission-control/LiveAgentsStrip";
import { AgentSessionsStrip } from "@/components/admin/mission-control/AgentSessionsStrip";
import { DeployStateStrip } from "@/components/admin/mission-control/DeployStateStrip";
import { DriftMeter } from "@/components/admin/mission-control/DriftMeter";
import { RollbackPending } from "@/components/admin/mission-control/RollbackPending";
import { KanbanMini } from "@/components/admin/mission-control/KanbanMini";
import { AuditFeed } from "@/components/admin/mission-control/AuditFeed";
import { SpendApprovalPending } from "@/components/admin/mission-control/SpendApprovalPending";
import { ClaudeRunApprovalsPending } from "@/components/admin/mission-control/ClaudeRunApprovalsPending";
import { SpendPolicyCard } from "@/components/admin/mission-control/SpendPolicyCard";
import { ResolverPolicyCard } from "@/components/admin/mission-control/ResolverPolicyCard";

export default function MissionControl() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 p-6" data-test="mission-control-landing">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <LayoutDashboard className="size-6" aria-hidden="true" />
          {t("missionControl.pageTitle", "Mission control")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "missionControl.pageSubtitle",
            "Live view of AISHA's stack — agents, deploys, drift, rollback, stories, audit.",
          )}
        </p>
      </header>

      {/* 12-col responsive grid:
            xs:  every pane full width
            md:  6-col → 2 per row
            xl:  4-col → 3 per row, with KanbanMini spanning 2 cols */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <LiveAgentsStrip />
        <AgentSessionsStrip />
        <DeployStateStrip />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <DriftMeter />
          <RollbackPending />
        </div>
        <SpendApprovalPending />
        <ClaudeRunApprovalsPending />
        <SpendPolicyCard />
        <ResolverPolicyCard />
        <div className="md:col-span-2 xl:col-span-2">
          <KanbanMini />
        </div>
        <AuditFeed />
      </div>
    </div>
  );
}
