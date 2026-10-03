import { ColumnDef, Row } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { ProductAdmin } from "@/hooks/useAdminProducts";

// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const PriceCell = ({ row }: { row: Row<ProductAdmin> }) => {
    const { t } = useTranslation();
    const product = row.original;

    return (
        <span className="inline-flex items-baseline gap-1 font-medium">
            <span>{product.price.toLocaleString()}</span>
            <span>{t("common.currencyCzk")}</span>
        </span>
    );
};

const StockCell = ({ row }: { row: Row<ProductAdmin> }) => {
    const { t } = useTranslation();
    const product = row.original;

    if (!product.in_stock) {
        return <span className="text-red-500 font-medium">{t("admin.products.outOfStock")}</span>;
    }

    // If in_stock is true, but we don't know quantity (unlimited?)
    // Actually schema says stock_quantity is number, and in_stock is boolean.
    // We can display quantity if available.
    const quantity = product.stock_quantity;

    if (quantity === null || quantity === undefined) {
        return <span className="text-green-600">{t("common.infinity")}</span>;
    }

    if (quantity === 0) {
        // Edge case: in_stock=true but quantity=0. Should probably warn or follow in_stock flag.
        return <span className="text-amber-500">0 ({t("admin.products.form.inStock")})</span>;
    }

    return <span className={`font-medium ${quantity < 10 ? "text-amber-600" : "text-green-600"}`}>{quantity}</span>;
};


const ActionsCell = ({
    row,
    onEdit,
    onDelete
}: {
    row: Row<ProductAdmin>;
    onEdit: (product: ProductAdmin) => void;
    onDelete: (id: string) => void;
}) => {
    const product = row.original;

    return (
        <div className="flex justify-end gap-2">
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(product)}
            >
                <Pencil className="h-4 w-4" />
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(product.id)}
            >
                <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
        </div>
    );
};

// ============================================
// COLUMN DEFINITIONS
// ============================================

export const useProductColumns = (
    onEdit: (product: ProductAdmin) => void,
    onDelete: (id: string) => void
): ColumnDef<ProductAdmin>[] => {
     
    const { t } = useTranslation();

    return [
        {
            accessorKey: "name",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.products.table.name")} />
            ),
            cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>,
            enableSorting: true,
        },
        {
            accessorKey: "slug",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.products.table.slug")} />
            ),
            cell: ({ row }) => <span className="text-muted-foreground">{row.getValue("slug")}</span>,
        },
        {
            accessorKey: "price",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.products.table.price")} />
            ),
            cell: ({ row }) => <PriceCell row={row} />,
            enableSorting: true,
        },
        {
            accessorKey: "category",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.products.table.category")} />
            ),
            cell: ({ row }) => {
                const cat = row.getValue("category") as string;
                return cat || <span className="text-muted-foreground">-</span>;
            },
            enableSorting: true,
        },
        {
            accessorKey: "stock_quantity", // Sorting by quantity
            id: "stock",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.products.table.stock")} />
            ),
            cell: ({ row }) => <StockCell row={row} />,
            enableSorting: true,
        },
        {
            id: "actions",
            header: t("admin.products.table.actions"),
            cell: ({ row }) => (
                <ActionsCell
                    row={row}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ),
        },
    ];
};
