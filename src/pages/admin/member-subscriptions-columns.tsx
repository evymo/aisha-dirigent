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
import { CheckCircle, XCircle, Clock, Banknote, Eye, Loader2 } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { MemberSubscription } from "@/hooks/useAdminMemberSubscriptions";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";

// ============================================
// CONSTANTS
// ============================================

const SUBSCRIPTION_STATUSES = [
    { value: "pending", labelKey: "admin.memberSubscriptions.status.pending", icon: Clock },
    { value: "approved", labelKey: "admin.memberSubscriptions.status.approved", icon: CheckCircle },
    { value: "paid", labelKey: "admin.memberSubscriptions.status.paid", icon: Banknote },
    { value: "active", labelKey: "admin.memberSubscriptions.status.active", icon: CheckCircle },
    { value: "cancelled", labelKey: "admin.memberSubscriptions.status.cancelled", icon: XCircle },
    { value: "expired", labelKey: "admin.memberSubscriptions.status.expired", icon: XCircle },
];

const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
        case "approved":
            return "default";
        case "paid":
        case "active":
            return "secondary";
        case "cancelled":
        case "expired":
            return "destructive";
        default:
            return "outline";
    }
};

// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const MemberCell = ({ row }: { row: Row<MemberSubscription> }) => {
    const { t } = useTranslation();
    const sub = row.original;

    return (
        <div>
            <p className="font-medium">
                {sub.profile?.display_name || sub.profile?.email || t("admin.memberSubscriptions.unknownMember")}
            </p>
            {sub.profile?.phone && (
                <p className="text-sm text-muted-foreground">{sub.profile.phone}</p>
            )}
        </div>
    );
};

const PackageCell = ({ row }: { row: Row<MemberSubscription> }) => {
    const { t } = useTranslation();
    const sub = row.original;

    return (
        <div>
            <p className="font-medium">{sub.package?.name || t("common.placeholderHyphen")}</p>
            <p className="text-sm text-muted-foreground capitalize">
                {sub.package?.tier} / {sub.package?.period}
            </p>
        </div>
    );
};

const StatusCell = ({ row, onStatusChange, updatingId }: { row: Row<MemberSubscription>; onStatusChange: (id: string, status: string) => void; updatingId: string | null }) => {
    const { t } = useTranslation();
    const sub = row.original;
    const isUpdating = updatingId === sub.id;

    return (
        <Select
            value={sub.status}
            onValueChange={(value) => onStatusChange(sub.id, value)}
            disabled={isUpdating}
        >
            <SelectTrigger className="w-[130px] h-8">
                {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Badge variant={getStatusBadgeVariant(sub.status)} className="w-full justify-start font-normal">
                        <span className="truncate">{t(`admin.memberSubscriptions.status.${sub.status}`)}</span>
                    </Badge>
                )}
            </SelectTrigger>
            <SelectContent>
                {SUBSCRIPTION_STATUSES.map((status) => (
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

const ActionsCell = ({ row, onView }: { row: Row<MemberSubscription>; onView: (sub: MemberSubscription) => void }) => {
    const { t } = useTranslation();
    const sub = row.original;

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => onView(sub)}
        >
            <Eye className="w-4 h-4 mr-1" />
            {t("common.view")}
        </Button>
    );
};

// ============================================
// COLUMN DEFINITIONS HOOK
// ============================================

/**
 * Hook that returns subscription columns with proper React hook dependencies.
 * This is a hook (not a regular function) because it uses useTranslation and useCurrency.
 */
export const useSubscriptionColumns = (
    onStatusChange: (subId: string, newStatus: string) => void,
    onView: (sub: MemberSubscription) => void,
    updatingId: string | null
): ColumnDef<MemberSubscription>[] => {
     
    const { t } = useTranslation();
    const { formatCurrency } = useCurrency();

    return [
        {
            accessorKey: "id",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.id")} />
            ),
            cell: ({ row }) => (
                <span className="font-mono text-sm">
                    #{row.original.id.slice(0, 8).toUpperCase()}
                </span>
            ),
            enableSorting: false,
        },
        {
            id: "member",
            accessorKey: "profile.display_name", // For sorting
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.member")} />
            ),
            cell: ({ row }) => <MemberCell row={row} />,
        },
        {
            id: "package",
            accessorKey: "package.name",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.package")} />
            ),
            cell: ({ row }) => <PackageCell row={row} />,
        },
        {
            accessorKey: "amount_paid",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.amount")} />
            ),
            cell: ({ row }) => (
                <span className="font-semibold inline-flex items-baseline gap-1">
                    {formatCurrency(row.original.amount_paid, row.original.currency)}
                </span>
            ),
        },
        {
            accessorKey: "status",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.status")} />
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
                <DataTableColumnHeader column={column} title={t("admin.memberSubscriptions.table.date")} />
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

/**
 * @deprecated Use useSubscriptionColumns hook instead.
 * This function violates React hooks rules by calling hooks inside a regular function.
 */
export const getSubscriptionColumns = useSubscriptionColumns;
