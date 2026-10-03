import { ColumnDef } from "@tanstack/react-table";
import { MemberSummary } from "@/hooks/useAdminData";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

// Since I cannot verify if TranslatedCell is shared, I will use standard cell renderers.

export const useMembersColumns = (): ColumnDef<MemberSummary>[] => {
    const { t } = useTranslation();

    return [
    {
        accessorKey: "display_name", // We'll use this for sorting but render custom content
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.members.table.member")} />;
        },
        cell: ({ row }) => {
            const name = row.original.display_name || t("admin.members.unnamed");
            const email = row.original.email;
            return (
                <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-sm text-muted-foreground">{email}</p>
                </div>
            );
        },
    },
    {
        accessorKey: "membership_status",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.members.table.membership")} />;
        },
        cell: ({ row }) => {
            const tier = row.original.membership_tier;
            const status = row.original.membership_status;

            if (!tier) {
                return <span className="text-muted-foreground text-sm">{t("admin.members.noMembership")}</span>;
            }

            return (
                <div className="flex items-center gap-2">
                    <Badge variant={tier === "upgraded" ? "default" : "secondary"}>
                        {tier}
                    </Badge>
                    <Badge variant={
                        status === "active" ? "outline" :
                            status === "expired" ? "destructive" : "secondary"
                    }>
                        {status}
                    </Badge>
                </div>
            );
        },
    },
    {
        accessorKey: "total_check_ins",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.members.table.checkIns")} />;
        },
        cell: ({ row }) => {
            return <div className="text-center font-semibold">{row.getValue("total_check_ins")}</div>;
        },
    },
    {
        accessorKey: "registrations_count",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.members.table.registrations")} />;
        },
        cell: ({ row }) => {
            return <div className="text-center font-semibold">{row.getValue("registrations_count")}</div>;
        },
    },
    {
        accessorKey: "last_check_in",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.members.table.lastActivity")} />;
        },
        cell: ({ row }) => {
            const date = row.getValue("last_check_in");

            if (!date) {
                return <span className="text-muted-foreground text-sm">{t("admin.members.never")}</span>;
            }

            return <span className="text-sm">{new Date(date as string).toLocaleDateString()}</span>;
        },
    },
];
};
