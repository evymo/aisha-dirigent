import { ColumnDef } from "@tanstack/react-table";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { TFunction } from "i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { ShipmentOrder } from "@/hooks/useAdminShipments";
import { format } from "date-fns";
import {
    Package,
    Truck,
    CheckCircle,
    XCircle,
    Clock,
    Eye,
    Send,
    ExternalLink,
    MapPin
} from "lucide-react";

export const getShipmentColumns = (
    t: TFunction,
    locale: string,
    onViewDetail: (order: ShipmentOrder) => void,
    onCreateShipment: (order: ShipmentOrder) => void,
    onMarkShipped: (orderId: string) => void
): ColumnDef<ShipmentOrder>[] => {
    const dateLocale = getDateFnsLocale(locale);

    return [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label={t("common.selectAll")}
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label={t("common.selectRow")}
                    disabled={!!row.original.packeta_packet_id} // Disable selection if already has packet ID for bulk creation context
                />
            ),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.shipments.table.date")} />
            ),
            cell: ({ row }) => format(new Date(row.original.created_at), "dd.MM.yyyy", { locale: dateLocale }),
        },
        {
            id: "customer", // Custom ID for combined column
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.shipments.table.customer")} />
            ),
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">{row.original.profile?.display_name || '-'}</div>
                    <div className="text-sm text-muted-foreground">{row.original.profile?.email || '-'}</div>
                </div>
            ),
            // Custom filter function to search both name and email could be added here or handled globally
        },
        {
            id: "address",
            header: t("admin.shipments.table.address"),
            cell: ({ row }) => {
                const address = row.original.shipping_address;
                if (address?.pickupPointName) {
                    return (
                        <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-primary" />
                            <span className="text-sm">{address.pickupPointName}</span>
                        </div>
                    );
                }
                return (
                    <div className="text-sm">
                        {address?.city}, {address?.country}
                    </div>
                );
            },
        },
        {
            accessorKey: "shipping_method",
            header: t("admin.shipments.table.method"),
            cell: ({ row }) => {
                const method = row.original.shipping_method;
                let label = method || '-';
                if (method === 'packeta_pickup') label = t("checkout.shipping.packetaPickup");
                if (method === 'packeta_home') label = t("checkout.shipping.packetaHome");
                if (method === 'personal_pickup') label = t("checkout.shipping.personalPickup");
                return <span className="text-sm">{label}</span>;
            },
        },
        {
            accessorKey: "status",
            header: t("admin.shipments.table.status"),
            cell: ({ row }) => {
                const order = row.original;
                if (order.status === 'delivered') {
                    return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />{t("admin.shipments.status.delivered")}</Badge>;
                }
                if (order.status === 'shipped' || order.status === 'in_transit') {
                    return <Badge variant="default"><Truck className="w-3 h-3 mr-1" />{t("admin.shipments.status.shipped")}</Badge>;
                }
                if (order.status === 'returned') {
                    return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{t("admin.shipments.status.returned")}</Badge>;
                }
                if (order.packeta_packet_id) {
                    return <Badge variant="outline"><Package className="w-3 h-3 mr-1" />{t("admin.shipments.status.processing")}</Badge>;
                }
                return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />{t("admin.shipments.status.readyToShip")}</Badge>;
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "packeta_packet_id",
            header: t("admin.shipments.table.tracking"),
            cell: ({ row }) => row.original.packeta_packet_id ? (
                <span className="font-mono text-xs">{row.original.packeta_packet_id}</span>
            ) : (
                <span className="text-muted-foreground">-</span>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const order = row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewDetail(order)}
                        >
                            <Eye className="w-4 h-4" />
                        </Button>
                        {!order.packeta_packet_id && order.shipping_method !== 'personal_pickup' && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onCreateShipment(order)}
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                        )}
                        {order.packeta_packet_id && order.status !== 'shipped' && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onMarkShipped(order.id)}
                            >
                                <Truck className="w-4 h-4" />
                            </Button>
                        )}
                        {order.tracking_url && (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                            >
                                <a href={order.tracking_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </Button>
                        )}
                    </div>
                );
            },
        },
    ];
};
