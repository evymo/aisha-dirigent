import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, AlertTriangle, CircleDashed } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";

export interface TranslationGroup {
    key: string;
    namespace: string;
    values: Record<string, string>;
    statuses: Record<string, { is_stale: boolean; is_missing: boolean }>;
}

export type SupportedLanguage = {
    code: string;
    name_native: string;
    is_active: boolean | null;
};

export const useTranslationColumns = (
    onEdit: (group: TranslationGroup) => void,
    onDelete: (key: string, namespace: string) => void,
    activeLanguages: SupportedLanguage[]
): ColumnDef<TranslationGroup>[] => {
     
    const { t } = useTranslation();

    const columns: ColumnDef<TranslationGroup>[] = [
        {
            accessorKey: "key",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.translations.key")} />
            ),
            cell: ({ row }) => (
                <span className="font-mono text-sm">
                    {row.original.key}
                </span>
            ),
        },
        {
            accessorKey: "namespace",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.translations.namespace")} />
            ),
            cell: ({ row }) => (
                <Badge variant="secondary" className="text-xs">
                    {row.original.namespace}
                </Badge>
            ),
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        }
    ];

    // Dynamically add columns for each active language
    activeLanguages.forEach(lang => {
        columns.push({
            id: `lang_${lang.code}`,
            header: () => (
                <div className="flex items-center gap-1">
                    <span className="text-xs font-bold uppercase">{lang.code}</span>
                    <span className="text-muted-foreground text-xs">({lang.name_native})</span>
                </div>
            ),
            cell: ({ row }) => {
                const group = row.original;
                const status = group.statuses[lang.code];
                const value = group.values[lang.code];
                const isMissing = status?.is_missing || !value;
                const isStale = status?.is_stale;

                return (
                    <div className="flex items-center gap-1 max-w-[200px]">
                        {isStale && (
                            <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        )}
                        {isMissing ? (
                            <span className="text-destructive italic text-sm flex items-center gap-1">
                                <CircleDashed className="h-3 w-3" />
                                {t("admin.translations.missing")}
                            </span>
                        ) : (
                            <span className="truncate" title={value}>{value}</span>
                        )}
                    </div>
                );
            }
        });
    });

    columns.push({
        id: "actions",
        cell: ({ row }) => {
            const group = row.original;

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
                        <DropdownMenuItem onClick={() => onEdit(group)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => onDelete(group.key, group.namespace)}
                            className="text-destructive focus:text-destructive"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            );
        },
    });

    return columns;
};
