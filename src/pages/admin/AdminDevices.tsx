import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Info, TabletSmartphone } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKnockDevicesColumns } from "@/components/admin/devices/knockDevicesColumns";
import { TabletyPanel } from "@/components/admin/devices/TabletyPanel";
import { useMembersSummary } from "@/hooks/useAdminData";
import {
  knockDeviceStatus,
  useKnockDevicesAdmin,
  useSetKnockDeviceApproval,
  type KnockDeviceStatus,
} from "@/hooks/useAdminKnockDevices";

type StatusFilter = KnockDeviceStatus | "all";

const FILTERS: StatusFilter[] = ["pending", "approved", "revoked", "all"];

export default function AdminDevices() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const { data: devices = [], isLoading, isError } = useKnockDevicesAdmin();
  const { members } = useMembersSummary();
  const setApproval = useSetKnockDeviceApproval();

  // Bez ruční memoizace — tu obstarává React Compiler (brána wp-4-5-react-compiler).
  const labels = new Map(members.map((m) => [m.user_id, m.display_name || m.email || m.user_id]));
  const userLabel = (userId: string) => labels.get(userId) ?? userId.slice(0, 8);

  const onSetApproval = (kid: string, approved: boolean) => {
    setApproval.mutate(
      { approved, kid },
      {
        onSuccess: () => toast.success(t(approved ? "admin.devices.toast.approved" : "admin.devices.toast.revoked")),
        onError: () => toast.error(t("admin.devices.toast.failed")),
      },
    );
  };

  const columns = useKnockDevicesColumns({ userLabel, onSetApproval, isSaving: setApproval.isPending });
  const visible = filter === "all" ? devices : devices.filter((d) => knockDeviceStatus(d) === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.devices.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("admin.devices.subtitle")}</p>
      </div>

      {/* Dvě věci jednoho tématu: průkazy zařízení pro dveře (schvalování) a
          tablety s hlídačem (volitelná schopnost instance — panel sám řekne,
          když na instanci není zapnutá). */}
      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials">{t("admin.devices.tabs.credentials")}</TabsTrigger>
          <TabsTrigger value="tablets">{t("admin.devices.tabs.tablets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="credentials" className="space-y-6">
          {/* Schválení dnes do dveří nedoteče samo — bez téhle věty by schválené
              zařízení, které stále mlčí, vypadalo jako porucha. */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{t("admin.devices.rosterNotice.title")}</AlertTitle>
            <AlertDescription>{t("admin.devices.rosterNotice.body")}</AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TabletSmartphone className="w-5 h-5" />
                {t("admin.devices.allDevices")}
              </CardTitle>
              <CardDescription>{t("admin.devices.count", { count: visible.length })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
                <TabsList>
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f} value={f}>
                      {t(`admin.devices.filter.${f}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {isLoading ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground">
                  {t("admin.devices.loading")}
                </div>
              ) : isError ? (
                <div className="h-32 flex items-center justify-center text-destructive">{t("admin.devices.loadError")}</div>
              ) : (
                <DataTable columns={columns} data={visible} searchKey="kid" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="tablets">
          <TabletyPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
