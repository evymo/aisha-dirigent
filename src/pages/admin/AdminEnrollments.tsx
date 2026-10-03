import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllRegistrations, type RegistrationWithDetails } from "@/hooks/useAdminData";
import { toast } from "sonner";
import { FlaskConical, CheckCircle, Clock, Users } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useRegistrationColumns } from "./registrations-columns";

export default function AdminRegistrations() {
  const { t } = useTranslation();
  const { registrations, updateRegistrationStatus } = useAllRegistrations();
  const [updating, setUpdating] = useState<string | null>(null);

  const pendingCount = registrations.filter(e => e.status === "screening").length;
  const activeCount = registrations.filter(e => e.status === "active" || e.status === "enrolled").length;
  const completedCount = registrations.filter(e => e.status === "completed").length;

  const handleStatusChange = async (registrationId: string, newStatus: RegistrationWithDetails["status"]) => {
    setUpdating(registrationId);
    const { error } = await updateRegistrationStatus(registrationId, newStatus);
    setUpdating(null);

    if (error) {
      toast.error(t("common.error"), {
        description: error,
      });
    } else {
      toast.success(t("admin.registrations.statusUpdated"), {
        description: t("admin.registrations.statusChangedTo", { status: newStatus }),
      });
    }
  };

  const handleApprove = async (registrationId: string) => {
    await handleStatusChange(registrationId, "enrolled");
  };

  const handleReject = async (registrationId: string) => {
    await handleStatusChange(registrationId, "withdrawn");
  };

  const columns = useRegistrationColumns(handleStatusChange, handleApprove, handleReject, updating);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.registrations.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.registrations.subtitle")}
        </p>
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
                <p className="text-sm text-muted-foreground">{t("admin.registrations.stats.total")}</p>
                <p className="text-2xl font-semibold">{registrations.length}</p>
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
                <p className="text-sm text-muted-foreground">{t("admin.registrations.stats.pending")}</p>
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
                <p className="text-sm text-muted-foreground">{t("admin.registrations.stats.active")}</p>
                <p className="text-2xl font-semibold">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <FlaskConical className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.stats.completed")}</p>
                <p className="text-2xl font-semibold">{completedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5" />
            {t("admin.registrations.allRegistrations")}
          </CardTitle>
          <CardDescription>{registrations.length} {t("admin.registrations.totalRegistrations")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={registrations}
            searchKey="profile.display_name"
          />
        </CardContent>
      </Card>
    </div>
  );
}