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
import { MoreHorizontal, Pencil, Trash2, Globe, Scan, FileText, Download } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { AdminArchiveDocument } from "@/lib/schemas/adminSchemas";

// Use the AdminArchiveDocument type from schema, but alias it for convenience if needed
type ArchiveDocument = AdminArchiveDocument;

const PROVENANCE_BADGE_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    original_scan: "default",
    translated_excerpt: "secondary",
    editorial_note: "outline",
    unverified_claim: "destructive",
};

export const useArchiveColumns = (
    onEdit: (doc: ArchiveDocument) => void,
    onDelete: (id: string) => void
): ColumnDef<ArchiveDocument>[] => {
     
    const { t } = useTranslation();

    return [
        {
            accessorKey: "year",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.archive.table.year")} />
            ),
            cell: ({ row }) => (
                <span className="font-mono text-sm">
                    {row.original.year || row.original.decade || "-"}
                </span>
            ),
        },
        {
            accessorKey: "document_type",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.archive.table.type")} />
            ),
            cell: ({ row }) => (
                <Badge variant="outline" className="capitalize">
                    {t(`admin.archive.documentTypes.${row.original.document_type}`)}
                </Badge>
            ),
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "title",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.archive.table.title")} />
            ),
            cell: ({ row }) => {
                const doc = row.original;
                // Use unified title field (legacy _cs/_en removed)
                const currentTitle = doc.title;

                return (
                    <div className="flex flex-col max-w-[300px]">
                        <span className="font-medium truncate">{currentTitle}</span>
                    </div>
                );
            },
        },
        {
            accessorKey: "provenance_badge",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.archive.table.provenance")} />
            ),
            cell: ({ row }) => {
                const badge = row.original.provenance_badge;
                return (
                    <Badge variant={PROVENANCE_BADGE_COLORS[badge] || "outline"}>
                        {t(`admin.archive.provenanceBadges.${badge}`)}
                    </Badge>
                );
            },
        },
        {
            id: "attributes",
            header: t("admin.archive.table.attributes"),
            cell: ({ row }) => {
                const doc = row.original;
                return (
                    <div className="flex gap-1">
                        {doc.is_featured && (
                            <Badge variant="secondary" className="px-1" title={t("admin.archive.form.featuredDocument")}>
                                <Globe className="w-3 h-3" />
                            </Badge>
                        )}
                        {doc.is_download_public && (
                            <Badge variant="outline" className="px-1" title={t("admin.archive.form.publicDownload")}>
                                <Download className="w-3 h-3" />
                            </Badge>
                        )}
                        {doc.scan_url && (
                            <Badge variant="outline" className="px-1" title={t("admin.archive.form.scanUrl")}>
                                <Scan className="w-3 h-3" />
                            </Badge>
                        )}
                        {doc.transcript_url && (
                            <Badge variant="outline" className="px-1" title={t("admin.archive.form.transcriptUrl")}>
                                <FileText className="w-3 h-3" />
                            </Badge>
                        )}
                    </div>
                );
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const doc = row.original;

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
                            <DropdownMenuItem onClick={() => onEdit(doc)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(doc.id)} className="text-destructive focus:text-destructive">
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
