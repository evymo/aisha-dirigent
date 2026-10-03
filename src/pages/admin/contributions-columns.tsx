import { ColumnDef } from "@tanstack/react-table";
import { DollarSign, Coins, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TFunction } from "i18next";
import { ContributionWithStudy } from "@/lib/schemas/adminSchemas";
import { format } from "date-fns";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const getContributionColumns = (
    t: TFunction,
    onStatusChange: (id: string, status: string) => void,
    defaultCurrency: string
): ColumnDef<ContributionWithStudy>[] => [
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                    {t("admin.contributions.table.date")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <span className="text-muted-foreground">
                    {format(new Date(row.getValue("created_at")), "dd.MM.yyyy HH:mm")}
                </span>
            ),
        },
        {
            accessorKey: "study_name",
            header: t("admin.contributions.table.study"),
            cell: ({ row }) => (
                <div>
                    <p className="font-medium">{row.getValue("study_name") || "-"}</p>
                    <p className="text-sm text-muted-foreground">{row.original.study_code}</p>
                </div>
            ),
        },
        {
            accessorKey: "contribution_type",
            header: t("admin.contributions.table.type"),
            cell: ({ row }) => {
                const type = row.getValue("contribution_type") as string;
                return (
                    <Badge variant={type === "financial" ? "default" : "secondary"}>
                        {type === "financial" ? (
                            <DollarSign className="w-3 h-3 mr-1" />
                        ) : (
                            <Coins className="w-3 h-3 mr-1" />
                        )}
                        {type === "financial"
                            ? t("admin.contributions.typeOptions.money")
                            : type.replace("tokens_", "")}
                    </Badge>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "amount",
            header: ({ column }) => (
                <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                    {t("admin.contributions.table.amount")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const amount = Number(row.getValue("amount"));
                const currency = row.original.currency || defaultCurrency;
                return (
                    <div className="font-medium">
                        {amount.toLocaleString()} {currency}
                    </div>
                );
            },
        },
        {
            accessorKey: "status",
            header: t("admin.contributions.table.status"),
            cell: ({ row }) => {
                const status = row.getValue("status") as string;
                return (
                    <Select
                        value={status || "pending"}
                        onValueChange={(val) => onStatusChange(row.original.id, val)}
                    >
                        <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending">{t("admin.contributions.statusOptions.pending")}</SelectItem>
                            <SelectItem value="completed">{t("admin.contributions.statusOptions.completed")}</SelectItem>
                            <SelectItem value="failed">{t("admin.contributions.statusOptions.failed")}</SelectItem>
                            <SelectItem value="refunded">{t("admin.contributions.statusOptions.refunded")}</SelectItem>
                        </SelectContent>
                    </Select>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "is_anonymous",
            header: t("admin.contributions.table.anonymous"),
            cell: ({ row }) => (
                <span>{row.getValue("is_anonymous") ? t("common.yes") : t("common.no")}</span>
            ),
        },
        {
            id: "actions",
            header: t("admin.contributions.table.actions"),
            cell: ({ row }) => {
                const message = row.original.message;
                if (!message) return null;
                return (
                    <span className="text-sm text-muted-foreground" title={message}>
                        <FileText className="h-4 w-4" />
                    </span>
                );
            },
        },
    ];
