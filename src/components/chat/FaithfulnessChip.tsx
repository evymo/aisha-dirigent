/**
 * FaithfulnessChip — small badge next to assistant message showing the
 * faithfulness score of an AI run.
 *
 * Step 2 of retrieval optimization plan 2026. Pattern mirrors
 * QuestionnaireRewardBadge: <Badge variant="secondary"> with a lucide icon,
 * dark-mode tailwind variants, and a Tooltip exposing the precise score +
 * citation count.
 *
 * Data: useRunFaithfulness(runId) hook (already in main). Tier mapping via
 * faithfulnessTier() helper. Returns null when there is no run id (e.g. for
 * historical messages loaded before Step 2) — chip is opt-in per-message.
 */
import { useTranslation } from "react-i18next";
import { ShieldCheck, AlertCircle, XCircle, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRunFaithfulness, faithfulnessTier } from "@/hooks/useRunCitations";

interface FaithfulnessChipProps {
  runId: string | null | undefined;
  className?: string;
  showTooltip?: boolean;
}

const TIER_STYLE: Record<"high" | "medium" | "low" | "noData", string> = {
  high: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300",
  noData: "bg-muted text-muted-foreground hover:bg-muted/80",
};

const TIER_ICON = {
  high: ShieldCheck,
  medium: AlertCircle,
  low: XCircle,
  noData: HelpCircle,
} as const;

const TIER_LABEL_KEY: Record<"high" | "medium" | "low" | "noData", string> = {
  high: "rag.chip.high",
  medium: "rag.chip.medium",
  low: "rag.chip.low",
  noData: "rag.chip.noData",
};

export function FaithfulnessChip({ runId, className, showTooltip = true }: FaithfulnessChipProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useRunFaithfulness(runId ?? undefined);

  // No run id at all → hide chip (e.g. historical messages, error messages).
  if (!runId) return null;

  if (isLoading) {
    return <Skeleton className={cn("h-5 w-20", className)} />;
  }

  const score = data?.faithfulness ?? null;
  const citations = data?.citation_count ?? 0;
  const tier = faithfulnessTier(score);
  const Icon = TIER_ICON[tier];

  const badge = (
    <Badge
      variant="secondary"
      className={cn("gap-1 cursor-default", TIER_STYLE[tier], className)}
      aria-label={t(TIER_LABEL_KEY[tier])}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span className="text-xs">
        {score === null ? t("rag.chip.noData") : score.toFixed(2)}
      </span>
    </Badge>
  );

  if (!showTooltip) return badge;

  const tooltipText = score === null
    ? t("rag.chip.noData")
    : t("rag.chip.tooltip", { score: score.toFixed(2), count: citations });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
