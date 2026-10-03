/**
 * StoryHippocampusTab — Phase 6 hippocampus surface.
 *
 * Lists hippocampus signals (agent_memories WHERE agent_slug LIKE
 * 'hippocampus:%') for the story. Content is PII-scrubbed preview by
 * default; admin/staff can Reveal one row at a time (audited).
 * Per-row Promote/Suspend/Forget actions write audit_journal.
 *
 * Importance is rendered as a heatmap bar (0..10 scale).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Trash2,
  Loader2,
  AlertOctagon,
} from "lucide-react";

import {
  useHippocampusSignals,
  useRevealHippocampusContent,
  useSetMemoryGovernance,
  type HippocampusSignal,
} from "@/hooks/useHippocampusSignals";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { safeError } from "@/lib/security/safeLogger";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface StoryHippocampusTabProps {
  storyId: string;
}

export function StoryHippocampusTab({ storyId }: StoryHippocampusTabProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("manage_hippocampus") || hasPermission("admin");
  const { data: signals = [], isLoading, error } = useHippocampusSignals({
    storyId,
  });
  const reveal = useRevealHippocampusContent();
  const governance = useSetMemoryGovernance();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, HippocampusSignal[]>();
    for (const s of signals) {
      const list = m.get(s.agent_slug) ?? [];
      list.push(s);
      m.set(s.agent_slug, list);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [signals]);

  async function handleReveal(memoryId: string) {
    if (revealed.has(memoryId)) {
      // Toggle off
      const next = new Map(revealed);
      next.delete(memoryId);
      setRevealed(next);
      return;
    }
    setErrorMessage(null);
    setPendingId(memoryId);
    try {
      const data = await reveal.mutateAsync({ memoryId });
      if (data) {
        const next = new Map(revealed);
        next.set(memoryId, data.content);
        setRevealed(next);
      }
    } catch (err) {
      safeError("StoryHippocampusTab.handleReveal", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  async function handleGovernance(
    memoryId: string,
    mode: "promote" | "forget" | "suspend",
  ) {
    setErrorMessage(null);
    setPendingId(memoryId);
    try {
      await governance.mutateAsync({ memoryId, mode });
    } catch (err) {
      safeError(`StoryHippocampusTab.${mode}`, err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  if (signals.length === 0) {
    return (
      <Card data-test="story-hippocampus-empty">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t(
            "storyDetail.hippocampus.empty",
            "No hippocampus signals captured for this story yet. AISHA writes here as she learns from interactions.",
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-test="story-hippocampus-tab">
      {errorMessage && (
        <Alert variant="destructive" data-test="hippocampus-mutation-error">
          <AlertOctagon className="size-4" aria-hidden="true" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {grouped.map(([agentSlug, rows]) => {
        const avgImportance =
          rows.reduce((a, b) => a + b.importance, 0) / rows.length;
        return (
          <Card key={agentSlug} data-test={`hippocampus-agent-${agentSlug}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {agentSlug}
                <Badge variant="outline" className="text-[10px]">
                  {rows.length}
                </Badge>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-normal"
                  title={t(
                    "storyDetail.hippocampus.avgImportance",
                    "Average importance",
                  )}
                >
                  ⌀ {avgImportance.toFixed(1)}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                {t(
                  "storyDetail.hippocampus.agentHint",
                  "Memory signals captured by this hippocampus agent",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((sig) => {
                const fullContent = revealed.get(sig.memory_id);
                const isRevealed = fullContent != null;
                return (
                  <div
                    key={sig.memory_id}
                    data-test={`hippocampus-signal-${sig.memory_id}`}
                    className="space-y-1.5 rounded border bg-muted/30 p-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {sig.memory_type}
                      </Badge>
                      <ImportanceBar value={sig.importance} />
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(sig.created_at).toLocaleString()}
                      </span>
                      {sig.expires_at && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {t("storyDetail.hippocampus.expires", "expires")}{" "}
                          {new Date(sig.expires_at).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>

                    <p
                      className={cn(
                        "text-xs",
                        isRevealed
                          ? "whitespace-pre-wrap text-foreground"
                          : "text-muted-foreground",
                      )}
                      data-test={`hippocampus-content-${sig.memory_id}`}
                      data-revealed={isRevealed ? "true" : "false"}
                    >
                      {isRevealed ? fullContent : sig.content_preview}
                      {!isRevealed && sig.preview_truncated && (
                        <span className="ml-1 italic">…</span>
                      )}
                    </p>

                    {canManage && (
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={pendingId === sig.memory_id}
                          onClick={() => handleReveal(sig.memory_id)}
                          data-test={`hippocampus-reveal-${sig.memory_id}`}
                        >
                          {pendingId === sig.memory_id ? (
                            <Loader2
                              className="size-3 animate-spin"
                              aria-hidden="true"
                            />
                          ) : isRevealed ? (
                            <EyeOff className="size-3" aria-hidden="true" />
                          ) : (
                            <Eye className="size-3" aria-hidden="true" />
                          )}
                          <span className="ml-1">
                            {isRevealed
                              ? t("storyDetail.hippocampus.hide", "Hide")
                              : t("storyDetail.hippocampus.reveal", "Reveal")}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={pendingId === sig.memory_id}
                          onClick={() =>
                            handleGovernance(sig.memory_id, "promote")
                          }
                          data-test={`hippocampus-promote-${sig.memory_id}`}
                        >
                          <TrendingUp className="size-3" aria-hidden="true" />
                          <span className="ml-1">
                            {t("storyDetail.hippocampus.promote", "Promote")}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={pendingId === sig.memory_id}
                          onClick={() =>
                            handleGovernance(sig.memory_id, "suspend")
                          }
                          data-test={`hippocampus-suspend-${sig.memory_id}`}
                        >
                          <TrendingDown className="size-3" aria-hidden="true" />
                          <span className="ml-1">
                            {t("storyDetail.hippocampus.suspend", "Suspend")}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={pendingId === sig.memory_id}
                          onClick={() =>
                            handleGovernance(sig.memory_id, "forget")
                          }
                          data-test={`hippocampus-forget-${sig.memory_id}`}
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                          <span className="ml-1">
                            {t("storyDetail.hippocampus.forget", "Forget")}
                          </span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ImportanceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  return (
    <div
      className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      title={`importance ${value}/10`}
      data-test="hippocampus-importance"
      data-value={value}
    >
      <div
        className={cn(
          "h-full",
          value >= 8
            ? "bg-emerald-500"
            : value >= 5
              ? "bg-amber-500"
              : value >= 2
                ? "bg-slate-400"
                : "bg-destructive/60",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
