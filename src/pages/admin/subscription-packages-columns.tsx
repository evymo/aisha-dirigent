import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { TFunction } from "i18next";
import { SubscriptionPackageAdmin as Package } from "@/hooks/useAdminSubscriptionPackages";
// Note: Package type might be local or from schema. 
// AdminSubscriptionPackages defines `Package` interface locally usually?
// Let's assume we export it or use schema if available.
// Viewing the file revealed `interface Package` locally.
// I should export it from there or define equivalent here.

export const getPackageColumns = (
    t: TFunction,
    onEdit: (pkg: Package) => void,
    onDelete: (pkgId: string) => void
): ColumnDef<Package>[] => [
        {
            accessorKey: "name",
            header: ({ column }) => (
                <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                    {t("admin.subscriptions.table.name")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>,
        },
        {
            accessorKey: "tier",
            header: t("admin.subscriptions.table.tier"),
            cell: ({ row }) => (
                <Badge variant="outline" className="capitalize">
                    {row.getValue("tier")}
                </Badge>
            ),
        },
        {
            accessorKey: "period",
            header: t("admin.subscriptions.table.period"),
            cell: ({ row }) => (
                <Badge variant="secondary" className="capitalize">
                    {row.getValue("period")}
                </Badge>
            ),
        },
        {
            accessorKey: "price",
            header: ({ column }) => (
                <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                    {t("admin.subscriptions.table.price")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const price = row.getValue("price") as number;
                const currency = row.original.currency;
                return <div className="font-mono">{isNaN(price) ? "—" : `${price.toLocaleString()} ${currency}`}</div>;
            },
        },
        // Features column removed
        {
            id: "actions",
            cell: ({ row }) => {
                const pkg = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onEdit(pkg)}>
                            <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="text-destructive">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>{t("admin.subscriptions.deleteDialog.title")}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {t("admin.subscriptions.deleteDialog.description", { name: pkg.name })}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={() => onDelete(pkg.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                        {t("common.delete")}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                );
            },
        },
    ];
