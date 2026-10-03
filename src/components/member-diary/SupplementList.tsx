/**
 * Product List
 * List of user's product plans
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill, Plus, Clock, Package, Check } from "lucide-react";
import { format } from "date-fns";
import type { MemberProductPlan } from "@/lib/schemas/memberDiarySchemas";

interface ProductListProps {
  plans: MemberProductPlan[];
  selectedPlanId: string | null;
  onSelectPlan: (plan: MemberProductPlan) => void;
  onAddPlan: () => void;
  onConfirmTaken: (planId: string) => void;
  isLoading?: boolean;
}

export function ProductList({
  plans,
  selectedPlanId,
  onSelectPlan,
  onAddPlan,
  onConfirmTaken,
  isLoading: _isLoading,
}: ProductListProps) {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  const activePlans = plans.filter((p) => p.is_active);
  const inactivePlans = plans.filter((p) => !p.is_active);

  const renderPlan = (plan: MemberProductPlan) => {
    const isSelected = selectedPlanId === plan.id;
    const lastTaken = plan.last_taken_at
      ? format(new Date(plan.last_taken_at), "d. M. HH:mm", { locale })
      : null;

    return (
      <div
        key={plan.id}
        className={cn(
          "p-3 border-b border-border cursor-pointer transition-colors",
          isSelected ? "bg-accent" : "hover:bg-accent/50"
        )}
        onClick={() => onSelectPlan(plan)}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Pill className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">
              {plan.product_name || plan.product_name || t("memberDiary.unknownProduct")}
            </p>
            <p className="text-sm text-muted-foreground">
              {plan.dose_amount} {plan.dose_unit} • {plan.doses_per_day}x {t("memberDiary.daily")}
            </p>
            <div className="flex items-center gap-3 mt-2">
              {lastTaken && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {lastTaken}
                </span>
              )}
              {plan.remaining_doses !== undefined && plan.remaining_doses !== null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  {Math.round(plan.remaining_doses)}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmTaken(plan.id);
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddPlan}>
          <Plus className="h-4 w-4 mr-2" />
          {t("memberDiary.addProduct")}
        </Button>
      </div>

      {plans.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-muted-foreground">
          <div>
            <Pill className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t("memberDiary.noProducts")}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {activePlans.length > 0 && (
            <>
              <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("memberDiary.activePlans")} ({activePlans.length})
              </div>
              {activePlans.map(renderPlan)}
            </>
          )}

          {inactivePlans.length > 0 && (
            <>
              <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("memberDiary.inactivePlans")} ({inactivePlans.length})
              </div>
              {inactivePlans.map(renderPlan)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
