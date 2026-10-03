import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import {
  DEFAULT_INVOICE_HEADER,
  useInvoiceHeaderConfig,
  useUpdateInvoiceHeader,
  type InvoiceHeaderConfig,
} from "@/hooks/useInvoiceSettings";

/**
 * Admin settings section for invoice header (company details, bank account).
 */
export function InvoiceHeaderSettings() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useInvoiceHeaderConfig();
  const updateMutation = useUpdateInvoiceHeader();

  const [formState, setFormState] =
    useState<InvoiceHeaderConfig>(DEFAULT_INVOICE_HEADER);

  useEffect(() => {
    if (!config) return;
    setFormState(config);
  }, [config]);

  const canSave = useMemo(
    () => Boolean(formState.company_name.trim()),
    [formState.company_name]
  );

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(formState);
      toast.success(t("admin.settings.settingsSaved"), {
        description: t("admin.settings.invoiceHeader.savedDesc"),
      });
    } catch {
      toast.error(t("admin.settings.settingsError"), {
        description: t("admin.settings.invoiceHeader.saveError"),
      });
    }
  };

  const set = (field: keyof InvoiceHeaderConfig) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setFormState((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.settings.invoiceHeader.title")}</CardTitle>
        <CardDescription>
          {t("admin.settings.invoiceHeader.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Company information */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">
            {t("admin.settings.invoiceHeader.companySection")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-company-name">
                {t("admin.settings.invoiceHeader.companyName")}
              </Label>
              <Input
                id="inv-company-name"
                value={formState.company_name}
                onChange={set("company_name")}
                placeholder={t("admin.settings.invoiceHeader.companyNamePlaceholder")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-ico">
                {t("admin.settings.invoiceHeader.ico")}
              </Label>
              <Input
                id="inv-ico"
                value={formState.ico}
                onChange={set("ico")}
                placeholder="12345678"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-dic">
                {t("admin.settings.invoiceHeader.dic")}
              </Label>
              <Input
                id="inv-dic"
                value={formState.dic}
                onChange={set("dic")}
                placeholder="CZ12345678"
                disabled={isLoading}
              />
            </div>
          </div>
        </fieldset>

        {/* Address */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">
            {t("admin.settings.invoiceHeader.addressSection")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-address1">
                {t("admin.settings.invoiceHeader.addressLine1")}
              </Label>
              <Input
                id="inv-address1"
                value={formState.address_line1}
                onChange={set("address_line1")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-address2">
                {t("admin.settings.invoiceHeader.addressLine2")}
              </Label>
              <Input
                id="inv-address2"
                value={formState.address_line2}
                onChange={set("address_line2")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-city">
                {t("admin.settings.invoiceHeader.city")}
              </Label>
              <Input
                id="inv-city"
                value={formState.city}
                onChange={set("city")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-postal-code">
                {t("admin.settings.invoiceHeader.postalCode")}
              </Label>
              <Input
                id="inv-postal-code"
                value={formState.postal_code}
                onChange={set("postal_code")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-country">
                {t("admin.settings.invoiceHeader.country")}
              </Label>
              <Input
                id="inv-country"
                value={formState.country}
                onChange={set("country")}
                placeholder="CZ"
                disabled={isLoading}
              />
            </div>
          </div>
        </fieldset>

        {/* Bank account */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">
            {t("admin.settings.invoiceHeader.bankSection")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-bank-name">
                {t("admin.settings.invoiceHeader.bankName")}
              </Label>
              <Input
                id="inv-bank-name"
                value={formState.bank_name}
                onChange={set("bank_name")}
                placeholder="Fio banka"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-iban">
                {t("admin.settings.invoiceHeader.iban")}
              </Label>
              <Input
                id="inv-iban"
                value={formState.bank_account_iban}
                onChange={set("bank_account_iban")}
                placeholder="CZ1234567890123456789012"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-bic">
                {t("admin.settings.invoiceHeader.bic")}
              </Label>
              <Input
                id="inv-bic"
                value={formState.bank_account_bic}
                onChange={set("bank_account_bic")}
                placeholder="FIOBCZPPXXX"
                disabled={isLoading}
              />
            </div>
          </div>
        </fieldset>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave || updateMutation.isPending}
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
