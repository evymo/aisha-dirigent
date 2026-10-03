/**
 * StoryBindingsTab — Phase 5 bot ↔ KB binding list with toggle.
 *
 * Renders one row per active binding visible for this story (both
 * story-scoped and global). Admin/staff sees toggle/priority controls
 * inline; other participants see read-only list.
 *
 * Groups by agent_slug so it reads as "what each agent has bound".
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, LinkIcon, Globe2, Power, PowerOff, Loader2 } from "lucide-react";

import {
  useAgentKbBindings,
  useSetAgentKbBinding,
  type AgentKbBinding,
} from "@/hooks/useAgentKbBindings";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { safeError } from "@/lib/security/safeLogger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface StoryBindingsTabProps {
  storyId: string;
}

export function StoryBindingsTab({ storyId }: StoryBindingsTabProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("manage_bindings") || hasPermission("admin");
  const { data: bindings = [], isLoading, error } = useAgentKbBindings({
    storyId,
  });
  const setBinding = useSetAgentKbBinding();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, AgentKbBinding[]>();
    for (const b of bindings) {
      const list = m.get(b.agent_slug) ?? [];
      list.push(b);
      m.set(b.agent_slug, list);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [bindings]);

  async function handleToggle(binding: AgentKbBinding) {
    setMutationError(null);
    setPendingId(binding.binding_id);
    try {
      await setBinding.mutateAsync({
        agentSlug: binding.agent_slug,
        knowledgeItemId: binding.knowledge_item_id,
        bindingType: binding.binding_type,
        priority: binding.priority,
        version: binding.version,
        isActive: !binding.is_active,
        storyId: binding.story_id,
        notes: binding.notes,
      });
    } catch (err) {
      safeError("StoryBindingsTab.handleToggle", err);
      setMutationError(err instanceof Error ? err.message : String(err));
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
  if (bindings.length === 0) {
    return (
      <Card data-test="story-bindings-empty">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t(
            "storyDetail.bindings.empty",
            "No bot↔KB bindings configured for this story yet. Bind expert rules to agents to shape AISHA's behavior.",
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-test="story-bindings-tab">
      {mutationError && (
        <Alert variant="destructive" data-test="binding-mutation-error">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}

      {grouped.map(([agentSlug, rows]) => (
        <Card key={agentSlug} data-test={`binding-agent-${agentSlug}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
              {agentSlug}
              <Badge variant="outline" className="text-[10px]">
                {rows.filter((r) => r.is_active).length}/{rows.length}{" "}
                {t("storyDetail.bindings.active", "active")}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "storyDetail.bindings.agentHint",
                "Expert rules attached to this agent",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.binding_id}
                data-test={`binding-${row.binding_id}`}
                className={cn(
                  "flex items-start gap-2 rounded border bg-muted/30 p-2 text-sm",
                  !row.is_active && "opacity-60",
                )}
              >
                <LinkIcon
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{row.knowledge_title}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-normal"
                    >
                      {row.binding_type}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-normal capitalize"
                    >
                      {row.knowledge_category}
                    </Badge>
                    {row.is_global && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-normal"
                        title={t(
                          "storyDetail.bindings.globalTooltip",
                          "Global binding (applies across all stories)",
                        )}
                      >
                        <Globe2 className="mr-0.5 size-2.5" aria-hidden="true" />
                        {t("storyDetail.bindings.global", "global")}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {t("storyDetail.bindings.priority", "priority")} ·{" "}
                      {row.priority}
                    </span>
                    {row.version != null && (
                      <span className="text-[10px] text-muted-foreground">
                        v{row.version}
                      </span>
                    )}
                  </div>
                  {row.notes && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {row.notes}
                    </p>
                  )}
                </div>
                {canManage && !row.is_global && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleToggle(row)}
                    disabled={pendingId === row.binding_id}
                    data-test={`binding-toggle-${row.binding_id}`}
                  >
                    {pendingId === row.binding_id ? (
                      <Loader2
                        className="size-3 animate-spin"
                        aria-hidden="true"
                      />
                    ) : row.is_active ? (
                      <PowerOff className="size-3" aria-hidden="true" />
                    ) : (
                      <Power className="size-3" aria-hidden="true" />
                    )}
                    <span className="ml-1">
                      {row.is_active
                        ? t("storyDetail.bindings.disable", "Disable")
                        : t("storyDetail.bindings.enable", "Enable")}
                    </span>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
