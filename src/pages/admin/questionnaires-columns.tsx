import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Tables } from "@/integrations/db/types";

// We need to type this based on the extended type used in AdminQuestionnaires
// For now, I'll approximate it or try to import it if it was exported.
// Since it wasn't exported, I'll define a compatible interface here.

// Use intersection type instead of extending to avoid conflict with Tables<"questionnaires">
type Questionnaire = Tables<"questionnaires"> & {
    name_key?: string | null;
    description_key?: string | null;
    version?: number | null;
};

export const useQuestionnaireColumns = (
    onEdit: (q: Questionnaire) => void,
    onDelete: (id: string) => void,
    onToggleActive: (q: Questionnaire) => void
): ColumnDef<Questionnaire>[] => {
     
    const { t } = useTranslation();

    return [
        {
            accessorKey: "code",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.questionnaires.table.code")} />
            ),
            cell: ({ row }) => (
                <Badge variant="outline" className="font-mono">
                    {row.original.code}
                </Badge>
            ),
        },
        {
            accessorKey: "name",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.questionnaires.table.name")} />
            ),
            cell: ({ row }) => (
                <div className="flex flex-col max-w-[300px]">
                    <span className="font-medium truncate">
                        {/* If we had dynamic translations loaded properly here we could show the localized name.
                For now we rely on the base 'name' field which serves as a fallback or base name. 
                In the future, we could potentially pass a translation map or use a custom hook here. */}
                        {row.original.name}
                    </span>
                    {row.original.description && (
                        <span className="text-xs text-muted-foreground truncate max-w-[250px] inline-block">
                            {row.original.description}
                        </span>
                    )}
                </div>
            ),
        },
        {
            accessorKey: "version",
            header: t("admin.questionnaires.table.version"),
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    v{row.original.version || 1}
                </span>
            ),
        },
        {
            accessorKey: "is_active",
            header: t("admin.questionnaires.table.status"),
            cell: ({ row }) => (
                <div className="flex items-center space-x-2">
                    <Switch
                        checked={!!row.original.is_active}
                        onCheckedChange={() => onToggleActive(row.original)}
                        className="scale-75 origin-left"
                    />
                    <span className="text-sm text-muted-foreground">
                        {row.original.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                </div>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const q = row.original;

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">{t("common.openMenu")}</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{t("common.actions")}</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => onEdit(q)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(q.id)} className="text-destructive focus:text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t("common.delete")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
        },
    ];
};
