/**
 * CitationPanel — expandable list of chunks the assistant cited.
 *
 * Step 2 of retrieval optimization plan 2026. Data via useRunCitations(runId)
 * hook (already in main; joins knowledge_attribution → knowledge_items →
 * knowledge_chunks with story-scoped RBAC inside the RPC).
 *
 * Pattern mirrors the existing shadcn-ui Accordion (radix wrapped) — single
 * item that toggles "Show sources / Hide sources". Each citation is a row
 * with contextual_prefix (from Step 1) shown as muted intro + chunk_text +
 * attribution_weight badge.
 */
import { useTranslation } from "react-i18next";
import { ExternalLink, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRunCitations } from "@/hooks/useRunCitations";
import type { Citation } from "@/schemas/rpcResponseSchemas";

interface CitationPanelProps {
  runId: string | null | undefined;
  className?: string;
}

export function CitationPanel({ runId, className }: CitationPanelProps) {
  const { t } = useTranslation();
  const { data: citations, isLoading } = useRunCitations(runId ?? undefined);

  // No run id → no panel (parent already gates by message.ai_run_id, but
  // double-guard here so the component is safe to use standalone).
  if (!runId) return null;

  // Empty citations after load → render the panel anyway with empty hint so
  // users know AISHA didn't cite a knowledge source (vs. UI didn't try).
  const list: Citation[] = citations ?? [];

  return (
    <Accordion type="single" collapsible className={cn("w-full", className)}>
      <AccordionItem value="citations" className="border-none">
        <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-1">
          <span className="flex items-center gap-1">
            <BookOpen className="h-3 w-3" aria-hidden />
            {t("rag.citations.panelTitle")}
            {!isLoading && list.length > 0 && (
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                {list.length}
              </Badge>
            )}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {t("rag.citations.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {list.map((c, idx) => (
                <li
                  key={`${c.chunk_id ?? c.item_id}-${idx}`}
                  className="rounded-md border bg-card p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Link
                      to={`/knowledge/${c.item_id}`}
                      className="font-medium text-foreground hover:underline flex items-center gap-1"
                    >
                      {c.item_title}
                      <ExternalLink className="h-3 w-3 inline" aria-hidden />
                    </Link>
                    {c.attribution_weight !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("rag.citations.weight", {
                          value: c.attribution_weight.toFixed(2),
                        })}
                      </Badge>
                    )}
                  </div>
                  {c.section_title && (
                    <div className="text-[11px] text-muted-foreground mb-1">
                      {c.section_title}
                    </div>
                  )}
                  {c.contextual_prefix && (
                    <p className="text-[11px] italic text-muted-foreground mb-1 line-clamp-2">
                      {c.contextual_prefix}
                    </p>
                  )}
                  {c.chunk_text && (
                    <p className="line-clamp-3 text-foreground/90">
                      {c.chunk_text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
