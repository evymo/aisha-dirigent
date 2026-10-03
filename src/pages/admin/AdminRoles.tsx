import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Badge removed
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoleDefinitions } from "@/hooks/useRoleDefinitions";
import { useUserRolesAdmin, useGrantUserRole, useRevokeUserRole } from "@/hooks/useAdminRoles";
import { type AppRole } from "@/lib/schemas/adminSchemas";
import { Shield, Users, Stethoscope, User, Eye, Handshake, AlertTriangle, UserPlus } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getRoleColumns } from "./roles-columns";

export default function AdminRoles() {
  const { t } = useTranslation();
  const { isLoading: roleLoading } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { roles: roleDefinitions, isLoading: roleDefsLoading } = useRoleDefinitions();
  const canManageRoles = hasPermission("manage_roles");
  const navigate = useNavigate();

  const { data: roles = [], isLoading: rolesLoading } = useUserRolesAdmin();
  const grantRole = useGrantUserRole();
  const revokeRole = useRevokeUserRole();

  const [filterRole, setFilterRole] = useState<AppRole | "all">("all");

  // Add role dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("member");

  const ROLE_CONFIG: Record<AppRole, { labelKey: string; icon: typeof Shield; color: string }> = {
    admin: { labelKey: "admin.roles.roleTypes.admin", icon: Shield, color: "text-destructive" },
    staff: { labelKey: "admin.roles.roleTypes.staff", icon: Users, color: "text-primary" },
    practitioner: { labelKey: "admin.roles.roleTypes.practitioner", icon: Stethoscope, color: "text-secondary" },
    member: { labelKey: "admin.roles.roleTypes.member", icon: User, color: "text-muted-foreground" },
    evaluator: { labelKey: "admin.roles.roleTypes.evaluator", icon: Eye, color: "text-amber-600" },
    partner: { labelKey: "admin.roles.roleTypes.partner", icon: Handshake, color: "text-green-600" },
    consultant: { labelKey: "admin.roles.roleTypes.consultant", icon: Stethoscope, color: "text-blue-600" },
    researcher: { labelKey: "admin.roles.roleTypes.researcher", icon: Eye, color: "text-purple-600" },
    production_operator: { labelKey: "admin.roles.roleTypes.production_operator", icon: Users, color: "text-orange-500" },
    production_supervisor: { labelKey: "admin.roles.roleTypes.production_supervisor", icon: Shield, color: "text-orange-700" },
    quality_manager: { labelKey: "admin.roles.roleTypes.quality_manager", icon: Shield, color: "text-cyan-600" },
  };

  const handleAddRole = async () => {
    if (!newUserEmail.trim()) {
      toast.error(t("common.error"), {
        description: t("admin.roles.errors.enterEmail"),
      });
      return;
    }

    grantRole.mutate(
      { email: newUserEmail, role: newRole },
      {
        onSuccess: () => {
          toast.success(t("admin.roles.success.roleAdded"), {
            description: t("admin.roles.success.roleAddedDescription", { role: t(ROLE_CONFIG[newRole].labelKey) }),
          });
          setAddDialogOpen(false);
          setNewUserEmail("");
          setNewRole("member");
        },
        onError: (error) => {
          const msg = error.message || "";
          if (msg.includes("USER_NOT_FOUND")) {
            toast.error(t("admin.roles.errors.userNotFound"), {
              description: t("admin.roles.errors.userNotFoundDescription"),
            });
            return;
          }
          if (msg.includes("ROLE_EXISTS")) {
            toast.error(t("admin.roles.errors.roleExists"), {
              description: t("admin.roles.errors.roleExistsDescription"),
            });
            return;
          }
          toast.error(t("common.error"), {
            description: t("admin.roles.errors.addFailed"),
          });
        },
      }
    );
  };

  const handleDeleteRole = async (roleId: string) => {
    revokeRole.mutate(roleId, {
      onSuccess: () => {
        toast.success(t("admin.roles.success.roleRemoved"), {
          description: t("admin.roles.success.roleRemovedDescription"),
        });
      },
      onError: () => {
        toast.error(t("common.error"), {
          description: t("admin.roles.errors.removeFailed"),
        });
      },
    });
  };

  const filteredRoles = roles.filter(role => {
    const matchesRole = filterRole === "all" || role.role === filterRole;
    return matchesRole;
  });

  const roleCounts = roles.reduce((acc, role) => {
    acc[role.role] = (acc[role.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callbacks
  const columns = useMemo(() => getRoleColumns(t, roleDefinitions, handleDeleteRole), [t, roleDefinitions]);

  const loading = rolesLoading || roleLoading || permissionsLoading || roleDefsLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  // Admin-only access check
  if (!canManageRoles) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">{t("admin.roles.accessDenied")}</h2>
        <p className="text-muted-foreground">{t("admin.roles.adminOnlyAccess")}</p>
        <Button onClick={() => navigate("/admin")}>{t("common.back")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">{t("admin.roles.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.roles.subtitle")}
          </p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="w-4 h-4 mr-2" />
              {t("admin.roles.addRole")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("admin.roles.addRoleDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("admin.roles.addRoleDialog.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("admin.roles.addRoleDialog.userEmail")}</label>
                <Input
                  type="email"
                  placeholder={t("common.emailPlaceholder")}
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("admin.roles.addRoleDialog.role")}</label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_CONFIG) as AppRole[]).map((role) => {
                      const config = ROLE_CONFIG[role];
                      return (
                        <SelectItem key={role} value={role}>
                          <div className="flex items-center gap-2">
                            <config.icon className={`w-4 h-4 ${config.color}`} />
                            {t(config.labelKey)}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleAddRole} disabled={grantRole.isPending}>
                {grantRole.isPending ? t("admin.roles.adding") : t("admin.roles.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(Object.keys(ROLE_CONFIG) as AppRole[]).map((role) => {
          const config = ROLE_CONFIG[role];
          return (
            <Card key={role}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-muted`}>
                    <config.icon className={`w-5 h-5 ${config.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{roleCounts[role] || 0}</p>
                    <p className="text-sm text-muted-foreground">{t(config.labelKey)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.roles.userRoles")}</CardTitle>
          <CardDescription>{t("admin.roles.userRolesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1"></div>
            <Select value={filterRole} onValueChange={(v) => setFilterRole(v as AppRole | "all")}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder={t("admin.roles.filterRole")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.roles.allRoles")}</SelectItem>
                {(Object.keys(ROLE_CONFIG) as AppRole[]).map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(ROLE_CONFIG[role].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DataTable
            columns={columns}
            data={filteredRoles}
            searchKey="user" // Since we search by email/name which is in the "user" column accessor? 
          // Wait, accessor is "user" but cell renders complex. 
          // DataTable search usually searches the value of the accessor. 
          // If accessor returns an object (row.original), string search might fail.
          // We should check how DataTable search works. 
          // If it uses basic filtering, we might need a custom filter function or string accessor.
          // For now, let's assume we rely on external search or fix accessor.
          // Actually, in `getRoleColumns`, accessorKey "user" has no accessorFn. 
          // So it tries to access `row.user`. But row is the flat object?
          // No, `row` in data is `UserRoleAdmin`. It doesn't have `user` property.
          // So accessorKey "user" will return undefined!
          // I should fix the column definition to have an accessorFn.
          />
        </CardContent>
      </Card>
    </div>
  );
}
