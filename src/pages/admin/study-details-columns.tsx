import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TFunction } from "i18next";
import { ConsultantWithRelations, ContributionWithStudy } from "@/lib/schemas/adminSchemas";

export const getConsultantColumns = (
    t: TFunction,
    onStatusChange: (id: string, status: string) => void
): ColumnDef<ConsultantWithRelations>[] => [
        {
            accessorKey: "partner.display_name", // Accessing nested property? Tanstack Table supports dot notation.
            header: t("admin.studies.consultant.name"),
            cell: ({ row }) => row.original.partner?.display_name || "-",
        },
        {
            accessorKey: "role",
            header: t("admin.studies.consultant.role"),
            cell: ({ row }) => row.getValue("role") || "-",
        },
        {
            accessorKey: "status",
            header: t("admin.studies.consultant.status"),
            cell: ({ row }) => (
                <Badge variant={row.getValue("status") === "approved" ? "default" : "secondary"}>
                    {row.getValue("status")}
                </Badge>
            ),
        },
        {
            id: "actions",
            header: t("admin.studies.consultant.actions"),
            cell: ({ row }) => {
                const consultant = row.original;
                return (
                    <Select
                        value={consultant.status || "pending"}
                        onValueChange={(status) => onStatusChange(consultant.id, status)}
                    >
                        <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending">{t("common.pending")}</SelectItem>
                            <SelectItem value="approved">{t("common.approved")}</SelectItem>
                            <SelectItem value="rejected">{t("common.rejected")}</SelectItem>
                        </SelectContent>
                    </Select>
                );
            },
        },
    ];

export const getContributionColumns = (t: TFunction): ColumnDef<ContributionWithStudy>[] => [
    {
        accessorKey: "contribution_type",
        header: t("admin.studies.contribution.type"),
    },
    {
        id: "amount",
        header: t("admin.studies.contribution.amount"),
        cell: ({ row }) => `${row.original.amount} ${row.original.currency || BASE_CURRENCY_FALLBACK}`,
    },
    {
        accessorKey: "status",
        header: t("admin.studies.contribution.status"),
        cell: ({ row }) => (
            <Badge variant={row.getValue("status") === "completed" ? "default" : "secondary"}>
                {row.getValue("status")}
            </Badge>
        ),
    },
    {
        accessorKey: "created_at",
        header: t("admin.studies.contribution.date"),
        cell: ({ row }) => new Date(row.getValue("created_at")).toLocaleDateString(),
    },
];
