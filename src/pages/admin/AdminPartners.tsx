import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePartnerProfilesAdmin } from "@/hooks/useAdminPartners";
import { Handshake, Search, Building, User, Eye } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { usePartnersColumns } from "./partners-columns";

export default function AdminPartners() {
  const { t } = useTranslation();
  const columns = usePartnersColumns();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterVisible, setFilterVisible] = useState<string>("all");

  const { data: partners = [], isLoading } = usePartnerProfilesAdmin();

  const filteredPartners = partners.filter((partner) => {
    const matchesSearch =
      searchQuery === "" ||
      partner.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      partner.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      partner.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      partner.email?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType =
      filterType === "all" ||
      (filterType === "provider" && partner.is_production_provider) ||
      (filterType === "individual" && !partner.is_production_provider);

    const matchesVisible =
      filterVisible === "all" ||
      (filterVisible === "visible" && partner.is_visible) ||
      (filterVisible === "hidden" && !partner.is_visible);

    return matchesSearch && matchesType && matchesVisible;
  });

  const providerCount = partners.filter((p) => p.is_production_provider).length;
  const individualCount = partners.filter((p) => !p.is_production_provider).length;
  const visibleCount = partners.filter((p) => p.is_visible).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t("admin.partners.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.partners.subtitle")}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Handshake className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.partners.stats.total")}</p>
                <p className="text-2xl font-semibold">{partners.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/50">
                <Building className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.partners.stats.providers")}</p>
                <p className="text-2xl font-semibold">{providerCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/50">
                <User className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.partners.stats.individuals")}</p>
                <p className="text-2xl font-semibold">{individualCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Eye className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.partners.stats.visible")}</p>
                <p className="text-2xl font-semibold">{visibleCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.partners.list.title")}</CardTitle>
          <CardDescription>{t("admin.partners.list.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("admin.partners.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder={t("admin.partners.filterType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.partners.typeAll")}</SelectItem>
                <SelectItem value="provider">{t("admin.partners.typeProvider")}</SelectItem>
                <SelectItem value="individual">{t("admin.partners.typeIndividual")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterVisible} onValueChange={setFilterVisible}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder={t("admin.partners.filterVisibility")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.partners.visAll")}</SelectItem>
                <SelectItem value="visible">{t("admin.partners.visVisible")}</SelectItem>
                <SelectItem value="hidden">{t("admin.partners.visHidden")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredPartners}
              searchKey="display_name"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}