import { ColumnDef, Row } from "@tanstack/react-table";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    CheckCircle,
    XCircle,
    Clock,
    RotateCcw,
    AlertTriangle,
    Eye,
    ExternalLink,
} from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Payment } from "@/hooks/useAdminPayments";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
// ============================================
// CONSTANTS
// ============================================

const PAYMENT_STATUSES = [
    { value: "paid", labelKey: "admin.payments.status.paid", icon: CheckCircle, color: "text-green-500" },
    { value: "awaiting_payment", labelKey: "admin.payments.status.awaitingPayment", icon: Clock, color: "text-amber-500" },
    { value: "payment_failed", labelKey: "admin.payments.status.failed", icon: XCircle, color: "text-red-500" },
    { value: "payment_expired", labelKey: "admin.payments.status.expired", icon: AlertTriangle, color: "text-gray-500" },
    { value: "refunded", labelKey: "admin.payments.status.refunded", icon: RotateCcw, color: "text-blue-500" },
];

// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const AmountCell = ({ row }: { row: Row<Payment> }) => {
    const payment = row.original;
    const { formatCurrency } = useCurrency();
    return (
        <span className="font-medium">
            {formatCurrency(payment.amount, payment.currency)}
        </span>
    );
};

const StatusCell = ({ row }: { row: Row<Payment> }) => {
    const { t } = useTranslation();
    const payment = row.original;
    const statusConfig = PAYMENT_STATUSES.find(s => s.value === payment.status);

    if (!statusConfig) {
        return <Badge variant="outline">{payment.status}</Badge>;
    }

    const Icon = statusConfig.icon;
    // badge variant logic from original file
    const variant = payment.status === 'paid' ? 'default' : payment.status === 'payment_failed' ? 'destructive' : 'outline';

    return (
        <Badge variant={variant}>
            <Icon className={`w-3 h-3 mr-1 ${statusConfig.color}`} />
            {t(statusConfig.labelKey)}
        </Badge>
    );
};

const ActionsCell = ({
    row,
    onView,
    onRefund
}: {
    row: Row<Payment>;
    onView: (payment: Payment) => void;
    onRefund: (payment: Payment) => void;
}) => {
    useTranslation(); // Hook call kept for future localization
    const payment = row.original;

    return (
        <div className="flex items-center justify-end gap-2">
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onView(payment)}
            >
                <Eye className="w-4 h-4" />
            </Button>
            {payment.status === 'paid' && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRefund(payment)}
                >
                    <RotateCcw className="w-4 h-4" />
                </Button>
            )}
            {payment.stripe_payment_intent_id && (
                <Button
                    variant="ghost"
                    size="sm"
                    asChild
                >
                    <a
                        href={`https://dashboard.stripe.com/payments/${payment.stripe_payment_intent_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </a>
                </Button>
            )}
        </div>
    );
};

// ============================================
// COLUMN DEFINITIONS
// ============================================

export const usePaymentColumns = (
    onView: (payment: Payment) => void,
    onRefund: (payment: Payment) => void,
    language: string
): ColumnDef<Payment>[] => {
     
    const { t } = useTranslation();
    const dateLocale = getDateFnsLocale(language);

    return [
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.payments.table.date")} />
            ),
            cell: ({ row }) => (
                <span>
                    {format(new Date(row.getValue("created_at")), "dd.MM.yyyy HH:mm", { locale: dateLocale })}
                </span>
            ),
        },
        {
            id: "customer",
            accessorKey: "profile.display_name", // For sorting
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.payments.table.customer")} />
            ),
            cell: ({ row }) => {
                const payment = row.original;
                return (
                    <div>
                        <div className="font-medium">{payment.profile?.display_name || '-'}</div>
                        <div className="text-sm text-muted-foreground">{payment.profile?.email || '-'}</div>
                    </div>
                );
            },
        },
        {
            accessorKey: "amount",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.payments.table.amount")} />
            ),
            cell: ({ row }) => <AmountCell row={row} />,
        },
        {
            accessorKey: "status",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.payments.table.status")} />
            ),
            cell: ({ row }) => <StatusCell row={row} />,
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "stripe_payment_intent_id",
            header: t("admin.payments.table.paymentId"),
            cell: ({ row }) => {
                const pid = row.getValue("stripe_payment_intent_id") as string | null;
                return (
                    <span className="font-mono text-xs">
                        {pid ? `${pid.slice(0, 20)}...` : '-'}
                    </span>
                );
            },
        },
        {
            id: "actions",
            header: t("common.actions"),
            cell: ({ row }) => (
                <ActionsCell
                    row={row}
                    onView={onView}
                    onRefund={onRefund}
                />
            ),
        },
    ];
};
