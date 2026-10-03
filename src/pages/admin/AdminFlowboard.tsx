/**
 * Admin → Flowboard — the visual agent/automation builder surface.
 *
 * Pure wire-up: it hosts the existing <FlowCanvas/> (src/components/flowboard) fed by the
 * existing federated registry (builtin + get_flowboard_agent_catalog), and persists through the
 * existing owner-scoped RPCs (save/get/list_flowboard_graph). No new builder, store, or renderer —
 * the runtime (svc-ai-chat /flowboard/graphs/:id/execute) and the StoryLoop timeline already carry
 * execution + provenance. This page is the canvas + a saved-flow sidebar.
 *
 * Gated behind `manage_ai_workflows` (route guard + nav).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Play } from "lucide-react";
import { FlowCanvas } from "@/components/flowboard/FlowCanvas";
import {
  builtinProvider,
  agentCatalogProvider,
  flowGraphSchema,
  type FlowGraph,
  type FlowNodeDescriptor,
  type AgentCatalogRow,
} from "@/lib/flowboard";

interface SavedFlowRow {
  id: string;
  name: string;
  status?: string;
  updated_at?: string;
}

/** The federated palette: builtin node types + the active agent catalog (server-projected). */
async function loadDescriptors(): Promise<FlowNodeDescriptor[]> {
  const fetchAgents = async (): Promise<AgentCatalogRow[]> => {
    const { data, error } = await aisha.rpc("get_flowboard_agent_catalog");
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as unknown as AgentCatalogRow[];
  };
  const lists = await Promise.all([
    builtinProvider().load(),
    agentCatalogProvider(fetchAgents).load(),
  ]);
  return lists.flat();
}

async function loadFlows(): Promise<SavedFlowRow[]> {
  const { data, error } = await aisha.rpc("list_flowboard_graphs");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as SavedFlowRow[];
}

export default function AdminFlowboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeGraph, setActiveGraph] = useState<FlowGraph | undefined>(undefined);
  const [running, setRunning] = useState(false);

  const descriptorsQuery = useQuery({ queryKey: ["flowboard", "descriptors"], queryFn: loadDescriptors });
  const flowsQuery = useQuery({ queryKey: ["flowboard", "flows"], queryFn: loadFlows });

  const descriptors = useMemo(() => descriptorsQuery.data ?? [], [descriptorsQuery.data]);

  async function openFlow(id: string) {
    const { data, error } = await aisha.rpc("get_flowboard_graph", { p_id: id });
    if (error || !data) {
      toast({ title: t("flowboard.page.loadFailed"), variant: "destructive" });
      return;
    }
    const row = data as { graph?: FlowGraph };
    setActiveId(id);
    setActiveGraph(row.graph);
  }

  function newFlow() {
    setActiveId(null);
    setActiveGraph(undefined);
  }

  async function handleSave(graph: FlowGraph) {
    // Validate before persisting — the graph column is "validated app-side"; an invalid graph saved
    // here would otherwise only surface (as a fail-loud 422) later at execute time. Catch it now.
    const parsed = flowGraphSchema.safeParse(graph);
    if (!parsed.success) {
      toast({
        title: t("flowboard.page.saveFailed"),
        description: parsed.error.issues.map((i) => i.message).join("; "),
        variant: "destructive",
      });
      return;
    }
    const { data, error } = await aisha.rpc("save_flowboard_graph", {
      p_graph: parsed.data as unknown as Json,
      p_name: parsed.data.name ?? null,
      p_id: activeId ?? undefined,
      p_engine_pin: undefined,
      p_status: undefined,
    });
    if (error) {
      toast({ title: t("flowboard.page.saveFailed"), variant: "destructive" });
      return;
    }
    const saved = data as { id?: string } | null;
    if (saved?.id) setActiveId(saved.id);
    toast({ title: t("flowboard.page.saved") });
    void queryClient.invalidateQueries({ queryKey: ["flowboard", "flows"] });
  }

  async function handleRun() {
    if (!activeId) return;
    if (!user?.id) {
      toast({ title: t("flowboard.page.runFailed"), variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      // Run-as-story: each run gets its own StoryLoop timeline (reuses create_story_audited),
      // then the merged runtime executes + writes provenance into it under the user's JWT.
      const { data: storyId, error: storyErr } = await aisha.rpc("create_story_audited", {
        p_user_id: user.id,
        p_study_id: undefined,
        p_title: `Run: ${activeGraph?.name ?? "Flow"}`,
      });
      if (storyErr || typeof storyId !== "string") {
        toast({ title: t("flowboard.page.runFailed"), variant: "destructive" });
        return;
      }
      const { data: result, error: runErr } = await aisha.functions.invoke("flowboard-execute", {
        body: { graph_id: activeId, story_id: storyId },
      });
      if (runErr) {
        toast({ title: t("flowboard.page.runFailed"), variant: "destructive" });
        return;
      }
      const status = (result as { status?: string } | null)?.status;
      toast({
        title:
          status === "awaiting_approval"
            ? t("flowboard.page.runAwaitingApproval")
            : t("flowboard.page.runStarted"),
      });
      navigate(`/member/story/${storyId}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <Card className="w-64 shrink-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">{t("flowboard.page.savedFlows")}</CardTitle>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={newFlow} title={t("flowboard.page.newFlow")}>
            <Plus className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-2">
          <ScrollArea className="h-full">
            {(flowsQuery.data ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => openFlow(f.id)}
                className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent ${
                  f.id === activeId ? "bg-accent" : ""
                }`}
              >
                <span className="truncate font-medium">{f.name}</span>
                {f.status ? <span className="text-[10px] text-muted-foreground">{f.status}</span> : null}
              </button>
            ))}
            {flowsQuery.data?.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("flowboard.page.empty")}</p>
            ) : null}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-2">
          <CardTitle className="text-sm">{activeGraph?.name ?? t("flowboard.page.newFlow")}</CardTitle>
          <Button size="sm" onClick={handleRun} disabled={!activeId || running}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {running ? t("flowboard.page.running") : t("flowboard.page.run")}
          </Button>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          {descriptorsQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("flowboard.page.loading")}
            </div>
          ) : (
            <FlowCanvas
              key={activeId ?? "new"}
              descriptors={descriptors}
              initialGraph={activeGraph}
              onSave={handleSave}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
