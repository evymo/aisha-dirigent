import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Pencil, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { StudyWithDynamicData } from "@/lib/schemas/adminSchemas";
import { TFunction } from "i18next";

export const getStudyColumns = (
    t: TFunction,
    onEdit: (study: StudyWithDynamicData) => void,
    onViewDetails: (study: StudyWithDynamicData) => void
): ColumnDef<StudyWithDynamicData>[] => [
        {
            accessorKey: "code",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        {t("admin.studies.table.code")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => <span className="font-mono text-sm">{row.getValue("code")}</span>,
        },
        {
            accessorKey: "name",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        {t("admin.studies.table.name")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => (
                <div>
                    <p className="font-medium">{row.getValue("name")}</p>
                    <p className="text-sm text-muted-foreground">
                        {row.original.target_condition || t("common.placeholderHyphen")}
                    </p>
                </div>
            ),
        },
        {
            accessorKey: "study_type",
            header: t("admin.studies.table.type"),
            cell: ({ row }) => (
                <Badge variant="outline">
                    {t(`admin.studies.types.${row.getValue("study_type")}`)}
                </Badge>
            ),
        },
        {
            id: "funding",
            header: t("admin.studies.table.funding"),
            cell: ({ row }) => {
                const study = row.original;
                return (
                    <div className="text-sm">
                        <p>
                            {`${t("common.valueOutOf", {
                                value: study.dynamic_funding.toLocaleString(),
                                total: (study.funding_goal ?? 0).toLocaleString(),
                            })} ${t("common.currencyKc")}`}
                        </p>
                        <p className="text-muted-foreground">
                            {study.contributions_count} {t("admin.studies.contributions")}
                        </p>
                    </div>
                );
            },
        },
        {
            id: "participants",
            header: t("admin.studies.table.participants"),
            cell: ({ row }) => {
                const study = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span>
                            {t("common.valueOutOf", {
                                value: study.registrations_count,
                                total: study.target_registration ?? t("common.infinity"),
                            })}
                        </span>
                    </div>
                );
            },
        },
        {
            accessorKey: "funding_status",
            header: t("admin.studies.table.status"),
            cell: ({ row }) => {
                const status = (row.getValue("funding_status") as string) || "draft";
                const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
                    draft: "outline",
                    funding: "default",
                    funded: "secondary",
                    active: "default",
                    completed: "secondary",
                    cancelled: "destructive",
                };

                return (
                    <Badge variant={variants[status] || "outline"}>
                        {t(`admin.studies.fundingStatuses.${status}`)}
                    </Badge>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const study = row.original;
                return (
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onEdit(study)}
                        >
                            <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onViewDetails(study)}
                        >
                            <UserCheck className="w-4 h-4" />
                        </Button>
                    </div>
                );
            },
        },
    ];
