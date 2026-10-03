import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Info, ChevronDown, ChevronRight } from "lucide-react";
import { usePermissions, usePermissionManagement } from "@/hooks/usePermissions";
import { AppRole } from "@/hooks/useUserRole";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Roles that can be managed (admin has all permissions by default)
const MANAGEABLE_ROLES: AppRole[] = ["staff", "partner", "practitioner", "member", "evaluator"];

// Category display order and labels
const CATEGORY_ORDER = [
  "secure",
  "studies",
  "health",
  "shop",
  "partner",
  "partner_amateur",
  "partner_pro",
  "evaluator",
  "member",
  "admin",
  "staff",
  "admin_sections",
];

const CATEGORY_LABELS: Record<string, string> = {
  secure: "admin.permissions.category.secure",
  studies: "admin.permissions.category.studies",
  health: "admin.permissions.category.health",
  shop: "admin.permissions.category.shop",
  partner: "admin.permissions.category.partner",
  partner_amateur: "admin.permissions.category.partner_amateur",
  partner_pro: "admin.permissions.category.partner_pro",
  evaluator: "admin.permissions.category.evaluator",
  member: "admin.permissions.category.member",
  admin: "admin.permissions.category.admin",
  staff: "admin.permissions.category.staff",
  admin_sections: "admin.permissions.category.adminSections",
  general: "admin.permissions.category.general",
};

const normalizePermissionCategory = (raw: string | null | undefined) => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "general";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

export default function AdminPermissions() {
  const { t } = useTranslation();
  const { hasPermission: checkPermission } = usePermissions();
  const canManagePermissions = checkPermission("manage_permissions");
  const {
    allPermissions,
    isLoading,
    roleHasPermission,
    togglePermission,
  } = usePermissionManagement();
  
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["secure", "studies", "health", "shop"])
  );

  const handleToggle = async (role: string, permissionCode: string) => {
    const key = `${role}-${permissionCode}`;
    setSavingKey(key);
    await togglePermission(role, permissionCode);
    setSavingKey(null);
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group permissions by category
  const permissionsByCategory = allPermissions.reduce((acc, perm) => {
    const category = normalizePermissionCategory(perm.category);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(perm);
    return acc;
  }, {} as Record<string, typeof allPermissions>);

  // Sort categories
  const sortedCategories = Object.keys(permissionsByCategory).sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  if (!canManagePermissions) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("admin.permissions.accessDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-8 w-8" />
          {t("admin.permissions.title")}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t("admin.permissions.description")}
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t("admin.permissions.adminNote")}
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="staff" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          {MANAGEABLE_ROLES.map((role) => (
            <TabsTrigger key={role} value={role} className="capitalize">
              {t(`admin.roles.${role}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {MANAGEABLE_ROLES.map((role) => (
          <TabsContent key={role} value={role}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {t(`admin.roles.${role}`)}
                  </Badge>
                  {t("admin.permissions.rolePermissions")}
                </CardTitle>
                <CardDescription>
                  {t("admin.permissions.roleDescription", { role: t(`admin.roles.${role}`) })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {sortedCategories.map((category) => {
                    const permissions = permissionsByCategory[category];
                    const isExpanded = expandedCategories.has(category);
                    const assignedCount = permissions.filter((p) =>
                      roleHasPermission(role, p.code)
                    ).length;

                    return (
                      <Collapsible
                        key={category}
                        open={isExpanded}
                        onOpenChange={() => toggleCategory(category)}
                      >
                        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <span className="font-semibold text-sm uppercase tracking-wide">
                              {t(CATEGORY_LABELS[category] || `admin.permissions.category.${category}`)}
                            </span>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {assignedCount} / {permissions.length}
                          </Badge>
                        </CollapsibleTrigger>
                        
                        <CollapsibleContent className="mt-2">
                          <div className="grid gap-2 pl-6">
                            {permissions.map((permission) => {
                              const key = `${role}-${permission.code}`;
                              const isSaving = savingKey === key;
                              const hasIt = roleHasPermission(role, permission.code);

                              return (
                                <div
                                  key={permission.code}
                                  className="flex items-center justify-between py-2 px-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">
                                      {permission.name}
                                    </div>
                                    {permission.description && (
                                      <div className="text-xs text-muted-foreground truncate">
                                        {permission.description}
                                      </div>
                                    )}
                                    <code className="text-xs text-muted-foreground/60">
                                      {permission.code}
                                    </code>
                                  </div>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <label className="flex items-center gap-2 cursor-pointer ml-4">
                                          <Checkbox
                                            checked={hasIt}
                                            disabled={isSaving}
                                            onCheckedChange={() =>
                                              handleToggle(role, permission.code)
                                            }
                                          />
                                        </label>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {hasIt
                                          ? t("admin.permissions.clickToRevoke")
                                          : t("admin.permissions.clickToGrant")}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
