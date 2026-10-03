/**
 * SetBudgetDialog — the per-story budget chip + its edit dialog.
 *
 * Renders as the budget chip on a KanbanCard (colored by budget_state) and,
 * when clicked, opens a dialog to set/clear the story's lifetime USD ceiling
 * via set_ai_budget_audited. Pointer events are stopped so clicking the chip
 * never starts a dnd-kit drag on the parent card.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSetAiBudget } from "@/hooks/useMissionControlActions";
import { formatUsd, type BudgetState } from "@/components/admin/kanban/budgetFormat";

const BADGE_VARIANT: Record<BudgetState, "secondary" | "warning" | "destructive"> = {
  ok: "secondary",
  approaching: "warning",
  stopped: "destructive",
};

interface SetBudgetDialogProps {
  storyId: string;
  storyTitle: string;
  budgetState: BudgetState | null;
  consumedUsd: number | null;
  costLimitUsd: number | null;
}

export function SetBudgetDialog({
  storyId,
  storyTitle,
  budgetState,
  consumedUsd,
  costLimitUsd,
}: SetBudgetDialogProps) {
  const { t } = useTranslation();
  const setBudget = useSetAiBudget();
  const [open, setOpen] = useState(false);
  const [costLimit, setCostLimit] = useState(costLimitUsd != null ? String(costLimitUsd) : "");

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  const handleSubmit = () => {
    const trimmed = costLimit.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      toast.error(t("kanban.budget.invalid", "Enter a non-negative amount."));
      return;
    }
    setBudget.mutate(
      { scopeId: storyId, costUsdLimit: parsed },
      {
        onSuccess: () => {
          toast.success(t("kanban.budget.saved", "Budget updated."));
          setOpen(false);
        },
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onPointerDown={stop}
          onClick={stop}
          className="inline-flex items-center"
          title={t("kanban.budget.setTooltip", "Set AI budget")}
        >
          {budgetState && costLimitUsd != null ? (
            <Badge variant={BADGE_VARIANT[budgetState]} className="text-[10px] font-normal">
              <Wallet className="mr-0.5 size-2.5" aria-hidden="true" />
              {`${formatUsd(consumedUsd ?? 0)} / ${formatUsd(costLimitUsd)}`}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              <Wallet className="mr-0.5 size-2.5" aria-hidden="true" />
              {t("kanban.budget.setShort", "Budget")}
            </Badge>
          )}
        </button>
      </DialogTrigger>
      <DialogContent onPointerDown={stop} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("kanban.budget.dialogTitle", "Set AI budget")}</DialogTitle>
          <DialogDescription>
            {t("kanban.budget.dialogDescription", {
              defaultValue:
                'Lifetime AI spend ceiling for "{{title}}". Leave blank to remove the cap.',
              title: storyTitle,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`budget-cost-limit-${storyId}`}>
            {t("kanban.budget.costLimitLabel", "Cost limit (USD)")}
          </Label>
          <Input
            id={`budget-cost-limit-${storyId}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={costLimit}
            onChange={(e) => setCostLimit(e.target.value)}
            placeholder={t("kanban.budget.costLimitPlaceholder", "e.g. 5.00")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={setBudget.isPending}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={setBudget.isPending}>
            {setBudget.isPending ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
