import { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { AuditJournalEntry, JournalArea, JournalSeverity } from "@/hooks/useAuditJournal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import {
    AlertCircle, AlertTriangle, Activity, Bell, Bug, Building, Calendar,
    Coins, Database, Eye, FileText, Info, Link2, MessageCircle,
    Shield, ShoppingCart, Users
} from "lucide-react";
import { JournalEntryDetail } from "./audit-journal-detail";
import React from "react";
import { useTranslation } from "react-i18next";

// We need a wrapper to use hooks like useTranslation inside cell renderers
// or we can use a component for the cell
const TranslatedCell = ({ i18nKey }: { i18nKey: string }) => {
    const { t } = useTranslation();
    return <span>{t(i18nKey)}</span>;
};

// Configuration maps (moved from main file or re-used)
const AREA_ICONS: Partial<Record<JournalArea, React.ReactNode>> = {
    admin: <Shield className="h-4 w-4" />,
    appointments: <Calendar className="h-4 w-4" />,
    auth: <Shield className="h-4 w-4" />,
    blockchain: <Link2 className="h-4 w-4" />,
    chat: <MessageCircle className="h-4 w-4" />,
    operational_data: <Activity className="h-4 w-4" />,
    consents: <Shield className="h-4 w-4" />,
    content: <FileText className="h-4 w-4" />,
    documents: <FileText className="h-4 w-4" />,
    registrations: <FileText className="h-4 w-4" />,
    integration: <Link2 className="h-4 w-4" />,
    logistics: <ShoppingCart className="h-4 w-4" />,
    members: <Users className="h-4 w-4" />,
    memberships: <Users className="h-4 w-4" />,
    notifications: <Bell className="h-4 w-4" />,
    orders: <ShoppingCart className="h-4 w-4" />,
    partner_matching: <Users className="h-4 w-4" />,
    partners: <Building className="h-4 w-4" />,
    production: <Activity className="h-4 w-4" />,
    products: <Database className="h-4 w-4" />,
    profile: <Users className="h-4 w-4" />,
    research: <FileText className="h-4 w-4" />,
    studies: <FileText className="h-4 w-4" />,
    subscriptions: <Coins className="h-4 w-4" />,
    system: <Database className="h-4 w-4" />,
    tokens: <Coins className="h-4 w-4" />,
    users: <Users className="h-4 w-4" />,
};

const SEVERITY_CONFIG: Record<JournalSeverity, { color: string; icon: React.ReactNode }> = {
    debug: { color: "bg-muted text-muted-foreground", icon: <Bug className="h-3 w-3" /> },
    info: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <Info className="h-3 w-3" /> },
    notice: { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <Bell className="h-3 w-3" /> },
    warning: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: <AlertTriangle className="h-3 w-3" /> },
    error: { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="h-3 w-3" /> },
    critical: { color: "bg-red-600 text-white", icon: <AlertCircle className="h-3 w-3" /> },
};

export const useAuditJournalColumns = (): ColumnDef<AuditJournalEntry>[] => {
    const { t } = useTranslation();

    return [
    {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.auditJournal.table.time")} />,
        cell: ({ row }) => {
            return <span className="text-sm text-muted-foreground">{format(new Date(row.getValue("created_at")), "dd.MM. HH:mm:ss")}</span>
        },
    },
    {
        accessorKey: "area",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.auditJournal.table.area")} />,
        cell: ({ row }) => {
            const area = row.getValue("area") as JournalArea;
            return (
                <div className="flex items-center gap-1.5">
                    {AREA_ICONS[area] ?? <Database className="h-4 w-4" />}
                    <TranslatedCell i18nKey={`admin.auditJournal.areas.${area}`} />
                </div>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id));
        },
    },
    {
        accessorKey: "severity",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.auditJournal.table.severity")} />,
        cell: ({ row }) => {
            const severity = row.getValue("severity") as JournalSeverity;
            const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
            return (
                <Badge className={`${config.color} text-xs`}>
                    {config.icon}
                    <span className="ml-1"><TranslatedCell i18nKey={`admin.auditJournal.severities.${severity}`} /></span>
                </Badge>
            );
        },
    },
    {
        accessorKey: "action_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.auditJournal.table.action")} />,
        cell: ({ row }) => {
            const action = row.getValue("action_type") as string;
            return <TranslatedCell i18nKey={`admin.auditJournal.actions.${action}`} />;
        },
    },
    {
        accessorKey: "summary",
        header: t("admin.auditJournal.table.summary"),
        cell: ({ row }) => {
            const summary = row.getValue("summary") as string | null;
            return <div className="text-sm max-w-[300px] truncate">{summary ?? "-"}</div>
        }
    },
    {
        accessorKey: "user_email",
        header: t("admin.auditJournal.table.user"),
        cell: ({ row }) => {
            const email = row.getValue("user_email") as string;
            return <div className="text-sm text-muted-foreground truncate max-w-[150px]">{email || <TranslatedCell i18nKey="admin.auditJournal.detail.system" />}</div>
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const entry = row.original;
            return (
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Eye className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle><TranslatedCell i18nKey="admin.auditJournal.detail.title" /></DialogTitle>
                        </DialogHeader>
                        <JournalEntryDetail entry={entry} />
                    </DialogContent>
                </Dialog>
            );
        },
    },
];
};
