/**
 * AgentSessionsStrip — mission-control pane showing live agent work sessions
 * from ANY reporting surface (Claude Code CLI, VS Code Dirigent, Zed, Codex,
 * AISHA-spawned container runs), complementing LiveAgentsStrip (orchestrated
 * ai_runs — the two panes are disjoint by design).
 *
 * Each row: source chip + phase badge + story + branch + live token/cost
 * rollup + elapsed time, expandable to the sub-agent snapshot accumulated
 * server-side from Agent tool pre/post events.
 *
 * Phase badge labels come from the seed-extensible agent_phase_catalog
 * (useAgentPhaseCatalog) with a static fallback map for cold-start.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Clock,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Cpu,
  Coins,
} from "lucide-react";

import {
  useAgentLiveSessions,
  useAgentPhaseCatalog,
  type AgentLiveSession,
  type AgentSubagent,
  type AgentPhaseCatalogEntry,
} from "@/hooks/useAgentLiveSessions";
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
import { SpawnClaudeRunButton } from "./SpawnClaudeRunButton";

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Cold-start fallback when the catalog hasn't loaded (mirrors seed labels). */
const FALLBACK_PHASE_LABELS: Record<string, string> = {
  idle: "idle",
  planning: "planning",
  tool_use: "tool use",
  reviewing: "reviewing",
  stopped: "stopped",
};

const PHASE_VARIANTS: Record<string, BadgeVariant> = {
  idle: "outline",
  planning: "secondary",
  tool_use: "default",
  reviewing: "secondary",
  stopped: "destructive",
};

function phaseLabel(
  slug: string,
  locale: string,
  catalog: AgentPhaseCatalogEntry[] | undefined,
): string {
  const entry = catalog?.find((c) => c.axis === "activity" && c.slug === slug);
  if (entry) {
    return entry.labels[locale] ?? entry.labels.en ?? slug;
  }
  return FALLBACK_PHASE_LABELS[slug] ?? slug;
}

export function AgentSessionsStrip() {
  const { t, i18n } = useTranslation();
  const { data: sessions = [], isLoading, error } = useAgentLiveSessions({ limit: 10 });
  const { data: phaseCatalog } = useAgentPhaseCatalog();
  const locale = i18n.language?.split("-")[0] ?? "en";

  return (
    <Card data-test="mc-agent-sessions-strip">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" aria-hidden="true" />
          {t("missionControl.agentSessions.title", "Agent sessions")}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {sessions.length}
            </Badge>
            <SpawnClaudeRunButton />
          </div>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.agentSessions.subtitle",
            "Live work sessions across IDEs, CLIs and spawned agents.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-16" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.agentSessions.empty", "No active sessions.")}
          </p>
        )}
        {sessions.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            locale={locale}
            phaseCatalog={phaseCatalog}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  locale,
  phaseCatalog,
}: {
  session: AgentLiveSession;
  locale: string;
  phaseCatalog: AgentPhaseCatalogEntry[] | undefined;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasSubagents = session.subagents.length > 0;
  const variant = PHASE_VARIANTS[session.current_phase] ?? "outline";
  const isAishaSpawned = !!session.agent_run_id;
  const totalTokens = session.tokens_input + session.tokens_output;

  return (
    <div
      data-test={`agent-session-${session.session_id}`}
      className="rounded border bg-muted/30 text-sm"
    >
      <div className="flex items-center gap-2 p-2">
        <span
          className="size-2 animate-pulse rounded-full bg-blue-500"
          aria-label={t("missionControl.agentSessions.active", "Active")}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-normal shrink-0">
              {session.source}
            </Badge>
            <span className="font-medium truncate">
              {session.story_title ??
                session.current_task ??
                t("missionControl.agentSessions.noStory", "No story")}
            </span>
            <Badge variant={variant} className="text-[10px] font-normal shrink-0">
              {phaseLabel(session.current_phase, locale, phaseCatalog)}
            </Badge>
            {session.phase_detail && (
              <span className="text-[10px] text-muted-foreground/70 shrink-0">
                {session.phase_detail}
              </span>
            )}
            {isAishaSpawned && (
              <Badge
                variant="outline"
                className="text-[10px] font-normal shrink-0 border-primary/40 text-primary"
              >
                {t("missionControl.agentSessions.aishaSpawned", "AISHA")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
            {session.branch && (
              <span className="flex items-center gap-1">
                <GitBranch className="size-3" aria-hidden="true" />
                {session.branch}
              </span>
            )}
            {session.last_tool && (
              <span className="truncate max-w-[180px]">
                {session.last_tool}
                {session.last_file ? ` · ${session.last_file.split("/").pop()}` : ""}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="flex items-center gap-1 tabular-nums">
                <Coins className="size-3" aria-hidden="true" />
                {formatTokens(totalTokens)}
                {session.cost > 0 ? ` · $${session.cost.toFixed(2)}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="size-3" aria-hidden="true" />
          {formatElapsed(session.elapsed_ms)}
        </div>
        {hasSubagents && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 text-muted-foreground hover:text-foreground"
            aria-label={
              expanded
                ? t("missionControl.agentSessions.collapseAgents", "Collapse sub-agents")
                : t("missionControl.agentSessions.expandAgents", "Expand sub-agents")
            }
          >
            {expanded ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {expanded && hasSubagents && (
        <div className="border-t mx-2 mb-2 pt-1.5 space-y-1">
          {session.subagents.map((subagent, i) => (
            <SubagentRow key={`${subagent.label ?? "agent"}-${i}`} subagent={subagent} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentRow({ subagent }: { subagent: AgentSubagent }) {
  const running = subagent.status === "running";
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
      <Cpu
        className={`size-3 shrink-0 ${running ? "text-emerald-500" : ""}`}
        aria-hidden="true"
      />
      <span className="truncate flex-1">{subagent.label ?? "agent"}</span>
      {subagent.status && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">{subagent.status}</span>
      )}
      {subagent.started_at && (
        <span className="shrink-0 tabular-nums">
          {formatElapsedSince(subagent.started_at, subagent.ended_at)}
        </span>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatElapsedSince(startedAt: string, endedAt?: string | null): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "—";
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  return formatElapsed(end - start);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
