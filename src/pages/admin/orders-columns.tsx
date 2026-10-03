import { ColumnDef, Row } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";
import { CheckCircle, XCircle, Clock, Package, Truck, Eye, Loader2, CreditCard, Building2 } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Order } from "@/hooks/useAdminOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";

// ============================================
// CONSTANTS
// ============================================

const ORDER_STATUSES = [
    { value: "pending", labelKey: "orders.status.pending", icon: Clock },
    { value: "confirmed", labelKey: "orders.status.confirmed", icon: CheckCircle },
    { value: "processing", labelKey: "orders.status.processing", icon: Package },
    { value: "shipped", labelKey: "orders.status.shipped", icon: Truck },
    { value: "delivered", labelKey: "orders.status.delivered", icon: CheckCircle },
    { value: "cancelled", labelKey: "orders.status.cancelled", icon: XCircle },
];

const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
        case "confirmed":
        case "processing":
        case "shipped":
            return "default";
        case "delivered":
            return "secondary";
        case "cancelled":
            return "destructive";
        default:
            return "outline";
    }
};

// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const CustomerCell = ({ row }: { row: Row<Order> }) => {
    const { t } = useTranslation();
    const order = row.original;

    return (
        <div>
            <p className="font-medium">
                {order.user_name || order.user_email || t("admin.orders.unknownCustomer")}
            </p>
        </div>
    );
};

const StatusCell = ({ row, onStatusChange, updatingId }: { row: Row<Order>; onStatusChange: (id: string, status: string) => void; updatingId: string | null }) => {
    const { t } = useTranslation();
    const order = row.original;
    const isUpdating = updatingId === order.id;

    return (
        <Select
            value={order.status}
            onValueChange={(value) => onStatusChange(order.id, value)}
            disabled={isUpdating}
        >
            <SelectTrigger className="w-[140px] h-8">
                {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Badge variant={getStatusBadgeVariant(order.status)} className="w-full justify-start font-normal">
                        <span className="truncate">{t(`orders.status.${order.status}`)}</span>
                    </Badge>
                )}
            </SelectTrigger>
            <SelectContent>
                {ORDER_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                        <div className="flex items-center gap-2">
                            <status.icon className="w-4 h-4" />
                            {t(status.labelKey)}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
};

const ActionsCell = ({ row, onView }: { row: Row<Order>; onView: (order: Order) => void }) => {
    const { t } = useTranslation();
    const order = row.original;

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => onView(order)}
        >
            <Eye className="w-4 h-4 mr-1" />
            {t("common.view")}
        </Button>
    );
};

// ============================================
// COLUMN DEFINITIONS
// ============================================

export const useOrderColumns = (
    onStatusChange: (orderId: string, newStatus: string) => void,
    onView: (order: Order) => void,
    updatingId: string | null
): ColumnDef<Order>[] => {
     
    const { t } = useTranslation();
    const { formatCurrency } = useCurrency();

    return [
        {
            accessorKey: "id",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.order")} />
            ),
            cell: ({ row }) => (
                <span className="font-mono text-sm">
                    #{row.original.id.slice(0, 8).toUpperCase()}
                </span>
            ),
            enableSorting: false,
        },
        {
            id: "customer",
            accessorKey: "user_name", // For basic sorting
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.customer")} />
            ),
            cell: ({ row }) => <CustomerCell row={row} />,
        },
        {
            id: "items",
            header: t("admin.orders.table.items"),
            cell: ({ row }) => {
                const count = row.original.order_items.length;
                return <span>{count} {t("admin.orders.items", { count })}</span>;
            },
        },
        {
            accessorKey: "total",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.total")} />
            ),
            cell: ({ row }) => (
                <span className="font-semibold inline-flex items-baseline gap-1">
                    {formatCurrency(row.original.total, row.original.currency)}
                </span>
            ),
        },
        {
            id: "payment_method",
            accessorKey: "payment_method",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.paymentMethod")} />
            ),
            cell: ({ row }) => {
                const method = row.original.payment_method;
                if (method === "bank_transfer") {
                    return (
                        <Badge variant="outline" className="gap-1">
                            <Building2 className="w-3 h-3" />
                            {t("orders.paymentMethod.bankTransfer")}
                        </Badge>
                    );
                }
                return (
                    <Badge variant="outline" className="gap-1">
                        <CreditCard className="w-3 h-3" />
                        {t("orders.paymentMethod.card")}
                    </Badge>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "status",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.status")} />
            ),
            cell: ({ row }) => (
                <StatusCell row={row} onStatusChange={onStatusChange} updatingId={updatingId} />
            ),
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.orders.table.date")} />
            ),
            cell: ({ row }) => (
                <span className="text-muted-foreground text-sm">
                    {format(new Date(row.getValue("created_at")), "dd.MM.yyyy")}
                </span>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => <ActionsCell row={row} onView={onView} />,
        },
    ];
};
