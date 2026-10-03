/**
 * ExplainabilityPanel — "How AISHA reached this answer" trail.
 *
 * Step 7.3 of retrieval optimization plan 2026. Renders the multi-hop
 * graph context fn_get_run_graph_context returned for this ai_run,
 * grouped by target node so duplicate concepts surfaced via multiple
 * citation seeds collapse to one row.
 *
 * Companion to CitationPanel (Step 2): citations are direct chunk usage,
 * explainability is the indirect provenance trail (a concept the run
 * touched on, a rule used in a related past run, a memory derived from a
 * similar question). Same Accordion pattern, different lucide icon set
 * per entity type.
 *
 * Data: useRunGraphContext(runId) + groupByTarget().
 */
import { useTranslation } from "react-i18next";
import {
  Network,
  Lightbulb,
  BookOpen,
  Brain,
  Activity,
  ScrollText,
  ShieldCheck,
  Users,
  PencilRuler,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useRunGraphContext,
  groupByTarget,
  type GroupedGraphContext,
} from "@/hooks/useRunGraphContext";

interface ExplainabilityPanelProps {
  runId: string | null | undefined;
  className?: string;
}

/**
 * Lucide icon per graph_nodes.entity_type. Keep the set in sync with the
 * CHECK constraint on graph_nodes.entity_type (Story, Agent, Plugin,
 * KnowledgeItem, ExpertRule, User, AuditEvent, Run, Memory, Proposal, Concept).
 */
function iconForEntityType(entityType: string) {
  switch (entityType) {
    case "Concept":       return Lightbulb;
    case "KnowledgeItem": return BookOpen;
    case "ExpertRule":    return ScrollText;
    case "Memory":        return Brain;
    case "Run":           return Activity;
    case "AuditEvent":    return Activity;
    case "Story":         return Network;
    case "Agent":         return PencilRuler;
    case "Plugin":        return PencilRuler;
    case "User":          return Users;
    case "Proposal":      return ShieldCheck;
    default:              return Network;
  }
}

export function ExplainabilityPanel({ runId, className }: ExplainabilityPanelProps) {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useRunGraphContext(runId ?? undefined);

  if (!runId) return null;

  const grouped: GroupedGraphContext[] = rows ? groupByTarget(rows) : [];

  return (
    <Accordion type="single" collapsible className={cn("w-full", className)}>
      <AccordionItem value="explainability" className="border-none">
        <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-1">
          <span className="flex items-center gap-1">
            <Network className="h-3 w-3" aria-hidden />
            {t("rag.explainability.panelTitle")}
            {!isLoading && grouped.length > 0 && (
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                {grouped.length}
              </Badge>
            )}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {t("rag.explainability.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {grouped.map((node) => {
                const Icon = iconForEntityType(node.target_entity_type);
                const confidencePct =
                  node.best_confidence !== null
                    ? Math.round(node.best_confidence * 100)
                    : null;
                return (
                  <li
                    key={node.target_node_id}
                    className="rounded-md border bg-card p-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {node.target_label}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              {node.target_entity_type}
                            </Badge>
                            <span aria-hidden>·</span>
                            <span>
                              {t("rag.explainability.depthLabel", { depth: node.best_depth })}
                            </span>
                            {node.best_last_relationship && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="font-mono">
                                  {node.best_last_relationship}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {confidencePct !== null && (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px] flex-shrink-0"
                          aria-label={t("rag.explainability.confidenceLabel", {
                            pct: confidencePct,
                          })}
                        >
                          {confidencePct}%
                        </Badge>
                      )}
                    </div>
                    {node.seeds.length > 0 && (
                      <div className="mt-1 pl-5 text-[11px] text-muted-foreground">
                        {t("rag.explainability.viaSeeds", {
                          count: node.seeds.length,
                          labels: node.seeds
                            .slice(0, 3)
                            .map((s) => s.seed_label)
                            .join(", "),
                          extra: node.seeds.length > 3
                            ? t("rag.explainability.moreSeeds", { n: node.seeds.length - 3 })
                            : "",
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
