import { useTranslation } from "react-i18next";
import { CreditCard, RefreshCw, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type PaymentType } from "@/lib/schemas/stripeSchemas";
import { cn } from "@/lib/utils";

interface PaymentTypeSelectorProps {
  value: PaymentType;
  onChange: (value: PaymentType) => void;
  allowOneTime: boolean;
  allowRecurring: boolean;
  period: "monthly" | "quarterly" | "annual";
  minBillingMonths?: number | null;
  billingIntervalMonths?: number | null;
  disabled?: boolean;
  className?: string;
}

export function PaymentTypeSelector({
  value,
  onChange,
  allowOneTime,
  allowRecurring,
  period,
  minBillingMonths,
  billingIntervalMonths,
  disabled = false,
  className,
}: PaymentTypeSelectorProps) {
  const { t } = useTranslation();

  // Determine what options are available
  const canSelectOneTime = allowOneTime;
  const canSelectRecurring = allowRecurring;

  // Calculate billing info text
  const getBillingInfo = (): string => {
    if (!canSelectRecurring) return "";

    const intervalMonths = billingIntervalMonths ?? 1;
    const periodMonths = period === "monthly" ? 1 : period === "quarterly" ? 3 : 12;

    if (intervalMonths === periodMonths) {
      return t("subscription.checkout.billingFull");
    }

    if (minBillingMonths && minBillingMonths > intervalMonths) {
      return t("subscription.checkout.billingMinimum", { months: minBillingMonths });
    }

    return t("subscription.checkout.billingInterval", { months: intervalMonths });
  };

  // If only one option available, show simplified view
  if (!canSelectOneTime && canSelectRecurring) {
    return (
      <Card className={cn("border-primary/20", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            {t("subscription.checkout.recurringPayment")}
          </CardTitle>
          <CardDescription>
            {getBillingInfo()}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (canSelectOneTime && !canSelectRecurring) {
    return (
      <Card className={cn("border-primary/20", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            {t("subscription.checkout.oneTimePayment")}
          </CardTitle>
          <CardDescription>
            {t("subscription.checkout.oneTimeDesc")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Both options available - show radio selection
  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("subscription.checkout.selectPaymentType")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={value}
          onValueChange={(val) => onChange(val as PaymentType)}
          disabled={disabled}
          className="space-y-3"
        >
          {/* One-time payment option */}
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4 transition-colors",
              value === "one_time"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            )}
          >
            <RadioGroupItem
              value="one_time"
              id="payment-one-time"
              className="mt-0.5"
            />
            <div className="flex-1 space-y-1">
              <Label
                htmlFor="payment-one-time"
                className="flex items-center gap-2 font-medium cursor-pointer"
              >
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t("subscription.checkout.oneTimePayment")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("subscription.checkout.oneTimeDesc")}
              </p>
            </div>
          </div>

          {/* Recurring payment option */}
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4 transition-colors",
              value === "recurring"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            )}
          >
            <RadioGroupItem
              value="recurring"
              id="payment-recurring"
              className="mt-0.5"
            />
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="payment-recurring"
                  className="flex items-center gap-2 font-medium cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  {t("subscription.checkout.recurringPayment")}
                </Label>
                <Badge variant="secondary" className="text-xs">
                  {t("subscription.checkout.recommended")}
                </Badge>
                {(minBillingMonths || billingIntervalMonths) && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{getBillingInfo()}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("subscription.checkout.recurringDesc")}
              </p>
            </div>
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
