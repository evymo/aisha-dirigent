import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Ban } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { knockDeviceStatus, type KnockDeviceStatus } from "@/hooks/useAdminKnockDevices";
import type { KnockDeviceAdminRow } from "@/lib/schemas/adminSchemas";

const STATUS_VARIANT: Record<KnockDeviceStatus, "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  revoked: "destructive",
};

export interface KnockDevicesColumnsOptions {
  /** Jméno nebo e-mail uživatele; neznámé id vrátí zkrácené id, ne prázdno. */
  userLabel: (userId: string) => string;
  onSetApproval: (kid: string, approved: boolean) => void;
  isSaving: boolean;
}

export const useKnockDevicesColumns = ({
  userLabel,
  onSetApproval,
  isSaving,
}: KnockDevicesColumnsOptions): ColumnDef<KnockDeviceAdminRow>[] => {
  const { t } = useTranslation();

  return [
    {
      accessorKey: "kid",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.devices.table.device")} />,
      cell: ({ row }) => (
        <div>
          <p className="font-mono text-sm">{row.original.kid}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.owner_user_id
              ? t("admin.devices.enrolledBy", { user: userLabel(row.original.owner_user_id) })
              : t("admin.devices.tabletAnnounced", { ip: row.original.ohlaseno_z_ip ?? "?" })}
          </p>
          {row.original.verze && (
            <p className="text-xs text-muted-foreground">
              {Object.entries(row.original.verze)
                .map(([appka, verze]) => `${appka} ${verze}`)
                .join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "scope",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.devices.table.scope")} />,
      cell: ({ row }) => <Badge variant="outline">{row.original.scope}</Badge>,
    },
    {
      id: "status",
      accessorFn: (device) => knockDeviceStatus(device),
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.devices.table.status")} />,
      cell: ({ row }) => {
        const status = knockDeviceStatus(row.original);
        return <Badge variant={STATUS_VARIANT[status]}>{t(`admin.devices.status.${status}`)}</Badge>;
      },
    },
    {
      id: "users",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.devices.table.users")} />,
      cell: ({ row }) => {
        const users = row.original.uzivatele;
        if (users.length === 0) {
          return <span className="text-sm text-muted-foreground">{t("admin.devices.noUsers")}</span>;
        }
        return (
          <ul className="text-sm">
            {users.map((user) => (
              <li key={user.user_id}>{userLabel(user.user_id)}</li>
            ))}
          </ul>
        );
      },
    },
    {
      accessorKey: "last_seen_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.devices.table.lastSeen")} />,
      cell: ({ row }) => <span className="text-sm">{new Date(row.original.last_seen_at).toLocaleString()}</span>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("admin.devices.table.actions")}</span>,
      cell: ({ row }) => {
        const device = row.original;
        // Odvolané zařízení jde znovu schválit — odvolání záznam nemaže.
        const approve = knockDeviceStatus(device) !== "approved";
        const dialog = approve ? "approveDialog" : "revokeDialog";
        return (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant={approve ? "default" : "outline"} size="sm" disabled={isSaving}>
                {approve ? <CheckCircle2 className="mr-1 h-4 w-4" /> : <Ban className="mr-1 h-4 w-4" />}
                {t(approve ? "admin.devices.actions.approve" : "admin.devices.actions.revoke")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`admin.devices.${dialog}.title`, { kid: device.kid })}</AlertDialogTitle>
                <AlertDialogDescription>{t(`admin.devices.${dialog}.description`)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onSetApproval(device.kid, approve)}>
                  {t(approve ? "admin.devices.actions.approve" : "admin.devices.actions.revoke")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      },
    },
  ];
};
