/**
 * Admin Settings Page
 *
 * Centrální stránka pro nastavení systému:
 * - API klíče (Stripe, Packeta, OpenAI, Fio)
 * - E-mail branding
 * - Fakturační hlavička
 * - Platební metody
 */
import { useTranslation } from "react-i18next";
import { CreditCard, FileText, Globe, Key, Palette, Settings } from "lucide-react";

import { AllApiKeysManager } from "@/components/admin/settings/AllApiKeysManager";
import { BrandingProfileSettings } from "@/components/admin/settings/BrandingProfileSettings";
import { DomainRoutingSettings } from "@/components/admin/settings/DomainRoutingSettings";
import { InvoiceHeaderSettings } from "@/components/admin/settings/InvoiceHeaderSettings";
import { PaymentMethodSettings } from "@/components/admin/settings/PaymentMethodSettings";

export default function AdminSettings() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8" />
        <div>
          <h1 className="text-2xl font-bold">{t("admin.settings.title")}</h1>
          <p className="text-muted-foreground">{t("admin.settings.description")}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* API Keys Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Key className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("admin.settings.apiKeysSection")}</h2>
          </div>
          <AllApiKeysManager />
        </section>

        {/* Branding Profile Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("admin.settings.brandingProfile.sectionTitle")}</h2>
          </div>
          <BrandingProfileSettings />
        </section>

        {/* Invoice Header Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("admin.settings.invoiceHeader.sectionTitle")}</h2>
          </div>
          <InvoiceHeaderSettings />
        </section>

        {/* Payment Methods Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("admin.settings.paymentMethods.sectionTitle")}</h2>
          </div>
          <PaymentMethodSettings />
        </section>

        {/* Domain Routing Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Globe className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("admin.settings.domainRouting.sectionTitle")}</h2>
          </div>
          <DomainRoutingSettings />
        </section>
      </div>
    </div>
  );
}
