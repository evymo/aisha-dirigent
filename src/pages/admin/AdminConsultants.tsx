import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Clock, CheckCircle, XCircle, Users } from "lucide-react";
import {
  useStudyConsultantsAdmin,
  useStudiesDropdownAdmin,
} from "@/hooks/useAdminConsultants";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useConsultantsColumns } from "./consultants-columns";

export default function AdminConsultants() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [studyFilter, setStudyFilter] = useState("all");

  const { data: consultants, isLoading } = useStudyConsultantsAdmin();
  const { data: studies } = useStudiesDropdownAdmin();
  const columns = useConsultantsColumns();

  const filteredConsultants = consultants?.filter((c) => {
    const matchesSearch =
      search === "" ||
      c.partner?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.partner?.business_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.study?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesStudy = studyFilter === "all" || c.study_id === studyFilter;
    return matchesSearch && matchesStatus && matchesStudy;
  }) ?? [];

  const pendingCount = consultants?.filter(c => c.status === "pending").length || 0;
  const approvedCount = consultants?.filter(c => c.status === "approved").length || 0;
  const rejectedCount = consultants?.filter(c => c.status === "rejected").length || 0;

  if (isLoading) {
    return <div className="p-6">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("admin.consultants.title")}</h1>
        <p className="text-muted-foreground">{t("admin.consultants.subtitle")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.consultants.stats.total")}</p>
                <p className="text-2xl font-semibold">{consultants?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.consultants.stats.pending")}</p>
                <p className="text-2xl font-semibold">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.consultants.stats.approved")}</p>
                <p className="text-2xl font-semibold">{approvedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <XCircle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.consultants.stats.rejected")}</p>
                <p className="text-2xl font-semibold">{rejectedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consultants Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>{t("admin.consultants.allConsultants")}</CardTitle>
              <CardDescription>{filteredConsultants.length} {t("admin.consultants.totalConsultants")}</CardDescription>
            </div>
            <div className="flex gap-3">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t("admin.consultants.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t("common.all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  <SelectItem value="pending">{t("common.pending")}</SelectItem>
                  <SelectItem value="approved">{t("admin.consultants.stats.approved")}</SelectItem>
                  <SelectItem value="rejected">{t("admin.consultants.stats.rejected")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={studyFilter} onValueChange={setStudyFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t("admin.consultants.filterStudy")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.consultants.allStudies")}</SelectItem>
                  {studies?.map((study) => (
                    <SelectItem key={study.id} value={study.id}>
                      {study.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filteredConsultants} />
        </CardContent>
      </Card>
    </div>
  );
}