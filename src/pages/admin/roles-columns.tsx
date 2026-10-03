import { ColumnDef } from "@tanstack/react-table";
import { Shield, Users, Stethoscope, User, Eye, Handshake, Trash2 } from "lucide-react";
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
import { RoleCapabilityBadges } from "@/components/admin/RoleCapabilityBadges";
import type { AppRole, UserRoleAdminRow } from "@/lib/schemas/adminSchemas";
import { TFunction } from "i18next";
import { RoleDefinition } from "@/hooks/useRoleDefinitions";

import { LucideIcon } from "lucide-react";

const ROLE_ICONS: Record<AppRole, LucideIcon> = {
    admin: Shield,
    staff: Users,
    practitioner: Stethoscope,
    member: User,
    evaluator: Eye,
    partner: Handshake,
    consultant: Stethoscope,
    researcher: Eye,
    production_operator: Users,
    production_supervisor: Shield,
    quality_manager: Shield,
};

const ROLE_COLORS: Record<AppRole, string> = {
    admin: "text-destructive",
    staff: "text-primary",
    practitioner: "text-secondary",
    member: "text-muted-foreground",
    evaluator: "text-amber-600",
    partner: "text-green-600",
    consultant: "text-blue-600",
    researcher: "text-purple-600",
    production_operator: "text-orange-500",
    production_supervisor: "text-orange-700",
    quality_manager: "text-cyan-600",
};

export const getRoleColumns = (
    t: TFunction,
    roleDefinitions: RoleDefinition[],
    onDelete: (roleId: string) => void
): ColumnDef<UserRoleAdminRow>[] => [
        {
            accessorKey: "user",
            header: t("admin.roles.table.user"),
            cell: ({ row }) => (
                <div>
                    <p className="font-medium">
                        {row.original.profile_display_name || t("admin.roles.unknownUser")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {row.original.profile_email || `ID: ${row.original.user_id.slice(0, 8)}...`}
                    </p>
                </div>
            ),
        },
        {
            accessorKey: "role",
            header: t("admin.roles.table.role"),
            cell: ({ row }) => {
                const role = row.original.role;
                const Icon = ROLE_ICONS[role] || User;
                const color = ROLE_COLORS[role] || "text-muted-foreground";
                const labelKey = `admin.roles.roleTypes.${role}`;
                const roleDef = roleDefinitions.find((r) => r.name === role);

                return (
                    <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="gap-1 w-fit">
                            <Icon className={`w-3 h-3 ${color}`} />
                            {t(labelKey)}
                        </Badge>
                        {roleDef && <RoleCapabilityBadges role={roleDef} compact />}
                    </div>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "granted_at",
            header: t("admin.roles.table.granted"),
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.original.granted_at
                        ? new Date(row.original.granted_at).toLocaleDateString("cs-CZ")
                        : "—"}
                </span>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const role = row.original;
                const roleLabel = t(`admin.roles.roleTypes.${role.role}`);

                return (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive">
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t("admin.roles.removeDialog.title")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t("admin.roles.removeDialog.description", {
                                        role: roleLabel,
                                        user: role.profile_email || role.user_id,
                                    })}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() => onDelete(role.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {t("admin.roles.remove")}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                );
            },
        },
    ];
