import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  DEFAULT_PAYMENT_METHODS,
  usePaymentMethodsConfig,
  useUpdatePaymentMethods,
  type PaymentMethodsConfig,
} from "@/hooks/usePaymentMethodSettings";

/**
 * Admin settings section for payment methods (card, bank transfer toggle + options).
 */
export function PaymentMethodSettings() {
  const { t } = useTranslation();
  const { data: config, isLoading } = usePaymentMethodsConfig();
  const updateMutation = useUpdatePaymentMethods();

  const [formState, setFormState] =
    useState<PaymentMethodsConfig>(DEFAULT_PAYMENT_METHODS);

  useEffect(() => {
    if (!config) return;
    setFormState(config);
  }, [config]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(formState);
      toast.success(t("admin.settings.settingsSaved"), {
        description: t("admin.settings.paymentMethods.savedDesc"),
      });
    } catch {
      toast.error(t("admin.settings.settingsError"), {
        description: t("admin.settings.paymentMethods.saveError"),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.settings.paymentMethods.title")}</CardTitle>
        <CardDescription>
          {t("admin.settings.paymentMethods.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Card payments */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="pm-card">
              {t("admin.settings.paymentMethods.cardEnabled")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.paymentMethods.cardEnabledDesc")}
            </p>
          </div>
          <Switch
            id="pm-card"
            checked={formState.card_enabled}
            onCheckedChange={(checked) =>
              setFormState((prev) => ({ ...prev, card_enabled: checked }))
            }
            disabled={isLoading}
          />
        </div>

        {/* Bank transfer */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="pm-bank-transfer">
              {t("admin.settings.paymentMethods.bankTransferEnabled")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.paymentMethods.bankTransferEnabledDesc")}
            </p>
          </div>
          <Switch
            id="pm-bank-transfer"
            checked={formState.bank_transfer_enabled}
            onCheckedChange={(checked) =>
              setFormState((prev) => ({
                ...prev,
                bank_transfer_enabled: checked,
              }))
            }
            disabled={isLoading}
          />
        </div>

        {/* Bank transfer due days */}
        {formState.bank_transfer_enabled && (
          <div className="space-y-2 pl-4">
            <Label htmlFor="pm-due-days">
              {t("admin.settings.paymentMethods.dueDays")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="pm-due-days"
                type="number"
                min={1}
                max={90}
                className="w-24"
                value={formState.bank_transfer_due_days}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    bank_transfer_due_days: Math.max(
                      1,
                      Math.min(90, Number(e.target.value) || 7)
                    ),
                  }))
                }
                disabled={isLoading}
              />
              <span className="text-sm text-muted-foreground">
                {t("admin.settings.paymentMethods.dueDaysUnit")}
              </span>
            </div>
          </div>
        )}

        {/* Default method */}
        <div className="space-y-2">
          <Label>{t("admin.settings.paymentMethods.defaultMethod")}</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="defaultMethod"
                value="bank_transfer"
                checked={formState.default_method === "bank_transfer"}
                onChange={() =>
                  setFormState((prev) => ({
                    ...prev,
                    default_method: "bank_transfer",
                  }))
                }
                disabled={isLoading || !formState.bank_transfer_enabled}
                className="accent-primary"
              />
              <span className="text-sm">
                {t("admin.settings.paymentMethods.methodBankTransfer")}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="defaultMethod"
                value="card"
                checked={formState.default_method === "card"}
                onChange={() =>
                  setFormState((prev) => ({
                    ...prev,
                    default_method: "card",
                  }))
                }
                disabled={isLoading || !formState.card_enabled}
                className="accent-primary"
              />
              <span className="text-sm">
                {t("admin.settings.paymentMethods.methodCard")}
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateMutation.isPending
              ? t("common.saving")
              : t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
