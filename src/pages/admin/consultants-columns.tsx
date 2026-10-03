import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { ConsultantWithRelations, useUpdateStudyConsultantStatus } from "@/hooks/useAdminConsultants";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

function StatusActionsCell({ consultant }: { consultant: ConsultantWithRelations }) {
    const { t } = useTranslation();
    const updateStatusMutation = useUpdateStudyConsultantStatus();

    if (consultant.status === "pending") {
        return (
            <div className="flex gap-2">
                <Button
                    size="sm"
                    variant="default"
                    onClick={() => updateStatusMutation.mutate({ id: consultant.id, status: "approved" })}
                >
                    <CheckCircle className="w-4 h-4" />
                </Button>
                <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => updateStatusMutation.mutate({ id: consultant.id, status: "rejected" })}
                >
                    <XCircle className="w-4 h-4" />
                </Button>
            </div>
        );
    }

    return (
        <Select
            value={consultant.status || "pending"}
            onValueChange={(status) => updateStatusMutation.mutate({ id: consultant.id, status })}
        >
            <SelectTrigger className="w-28 h-8">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="pending">{t("common.pending")}</SelectItem>
                <SelectItem value="approved">{t("admin.consultants.stats.approved")}</SelectItem>
                <SelectItem value="rejected">{t("admin.consultants.stats.rejected")}</SelectItem>
            </SelectContent>
        </Select>
    );
}

export const useConsultantsColumns = (): ColumnDef<ConsultantWithRelations>[] => {
    const { t } = useTranslation();

    return [
    {
        id: "partner", // Added id to satisfy stricter ColumnDef requirements when using accessorFn
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.partner")} />;
        },
        accessorFn: (row) => row.partner?.display_name, // Helper for sorting
        cell: ({ row }) => {
            const consultant = row.original;
            return (
                <div>
                    <p className="font-medium">{consultant.partner?.display_name}</p>
                    <p className="text-sm text-muted-foreground">
                        {consultant.partner?.business_name || consultant.partner?.city}
                    </p>
                    {consultant.partner?.is_production_provider && (
                        <Badge variant="secondary" className="mt-1">{t("admin.consultants.productionProvider")}</Badge>
                    )}
                </div>
            );
        },
    },
    {
        id: "study", // Added id here as well
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.study")} />;
        },
        accessorFn: (row) => row.study?.name,
        cell: ({ row }) => {
            const consultant = row.original;
            return (
                <div>
                    <p className="font-medium">{consultant.study?.name}</p>
                    <p className="text-sm text-muted-foreground">{consultant.study?.code}</p>
                </div>
            );
        },
    },
    {
        accessorKey: "role",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.role")} />;
        },
        cell: ({ row }) => {
            return <Badge variant="outline">{row.getValue("role")}</Badge>;
        },
    },
    {
        accessorKey: "max_participants",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.maxParticipants")} />;
        },
        cell: ({ row }) => {
            return <span>{row.getValue("max_participants") || t("admin.consultants.unlimited")}</span>;
        },
    },
    {
        accessorKey: "created_at",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.applied")} />;
        },
        cell: ({ row }) => {
            return <span className="text-muted-foreground">{format(new Date(row.getValue("created_at")), "dd.MM.yyyy")}</span>;
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.status")} />;
        },
        cell: ({ row }) => {
            const status = row.getValue("status") as string;
            return (
                <Badge
                    variant={
                        status === "approved"
                            ? "default"
                            : status === "rejected"
                                ? "destructive"
                                : "secondary"
                    }
                >
                    {status}
                </Badge>
            );
        },
    },
    {
        id: "actions",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.consultants.table.actions")} />;
        },
        cell: ({ row }) => <StatusActionsCell consultant={row.original} />,
    },
];
};
