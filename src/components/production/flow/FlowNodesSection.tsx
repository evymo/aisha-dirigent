/**
 * @fileoverview Flow Nodes management section.
 * CRUD for graph nodes (supplier, storage, process, regeneration, finished, waste).
 * All operations via audited RPC through useAdminProductionFlow hook.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Network,
  Factory,
  Warehouse,
  Truck,
  Recycle,
  PackageCheck,
  Trash2,
  Radio,
} from "lucide-react";
import {
  useFlowNodesAdmin,
  useUpsertFlowNodeMutation,
  FLOW_NODE_TYPES,
  type FlowNode,
  type FlowNodeType,
} from "@/hooks";
import FlowNodeIotConfigPanel from "./FlowNodeIotConfigPanel";

interface FlowNodeForm {
  capacity_l: string;
  default_concentration_pct: string;
  is_active: boolean;
  node_code: string;
  node_name: string;
  node_type: FlowNodeType;
  notes: string;
}

const defaultForm: FlowNodeForm = {
  capacity_l: "",
  default_concentration_pct: "",
  is_active: true,
  node_code: "",
  node_name: "",
  node_type: "storage",
  notes: "",
};

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  supplier: <Truck className="w-4 h-4" />,
  storage: <Warehouse className="w-4 h-4" />,
  process: <Factory className="w-4 h-4" />,
  regeneration: <Recycle className="w-4 h-4" />,
  finished: <PackageCheck className="w-4 h-4" />,
  waste: <Trash2 className="w-4 h-4" />,
};

/**
 * Nodes management sub-component for Flow Tracking.
 * Manages directed-graph nodes through which substances flow.
 */
export default function FlowNodesSection() {
  const { t } = useTranslation();
  const { data: nodes } = useFlowNodesAdmin();
  const upsertMutation = useUpsertFlowNodeMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<FlowNode | null>(null);
  const [form, setForm] = useState<FlowNodeForm>(defaultForm);
  const [iotConfigNodeId, setIotConfigNodeId] = useState<string | undefined>();

  const resetForm = () => {
    setForm(defaultForm);
    setEditing(null);
  };

  const handleEdit = (node: FlowNode) => {
    setEditing(node);
    setForm({
      capacity_l: node.capacity_l?.toString() ?? "",
      default_concentration_pct:
        node.default_concentration_pct?.toString() ?? "",
      is_active: node.is_active,
      node_code: node.node_code,
      node_name: node.node_name,
      node_type: node.node_type as FlowNodeType,
      notes: node.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.node_code || !form.node_name) {
      toast.error(t("admin.production.flow.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        capacity_l: form.capacity_l ? parseFloat(form.capacity_l) : null,
        default_concentration_pct: form.default_concentration_pct
          ? parseFloat(form.default_concentration_pct)
          : null,
        is_active: form.is_active,
        node_code: form.node_code,
        node_name: form.node_name,
        node_type: form.node_type,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.production.flow.nodes.updated")
              : t("admin.production.flow.nodes.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () =>
          toast.error(t("admin.production.flow.errors.saveFailed")),
      },
    );
  };

  const nodeTypeBadge = (type: string) => {
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      supplier: "outline",
      storage: "secondary",
      process: "default",
      regeneration: "secondary",
      finished: "default",
      waste: "destructive",
    };
    return (
      <Badge
        variant={variants[type] ?? "outline"}
        className="flex items-center gap-1 w-fit"
      >
        {NODE_TYPE_ICONS[type]}
        {t(`admin.production.flow.nodeType.${type}`)}
      </Badge>
    );
  };

  const columns: ColumnDef<FlowNode>[] = [
    {
      accessorKey: "node_code",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.nodes.code")}
        />
      ),
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.nodes.name")}
        />
      ),
    },
    {
      accessorKey: "node_type",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.nodes.type")}
        />
      ),
      cell: ({ row }) => nodeTypeBadge(row.original.node_type),
    },
    {
      accessorKey: "capacity_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.nodes.capacity")}
        />
      ),
      cell: ({ row }) =>
        row.original.capacity_l != null
          ? `${row.original.capacity_l} l`
          : "—",
    },
    {
      accessorKey: "default_concentration_pct",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.nodes.defaultConcentration")}
        />
      ),
      cell: ({ row }) =>
        row.original.default_concentration_pct != null
          ? `${row.original.default_concentration_pct}%`
          : "—",
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.common.active")}
        />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? "default" : "outline"}>
          {row.original.is_active ? t("common.yes") : t("common.no")}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleEdit(row.original)}
            title={t("common.edit")}
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIotConfigNodeId(row.original.id)}
            title={t("admin.production.flow.iotConfig.title")}
          >
            <Radio className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  const byType = (type: string) =>
    nodes?.filter((n) => n.node_type === type).length ?? 0;

  const stats = {
    total: nodes?.length ?? 0,
    storage: byType("storage"),
    process: byType("process"),
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Network className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.nodes.totalNodes")}
                </p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <Warehouse className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.nodes.storageCount")}
                </p>
                <p className="text-2xl font-semibold">{stats.storage}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Factory className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.nodes.processCount")}
                </p>
                <p className="text-2xl font-semibold">{stats.process}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t("admin.production.flow.nodes.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? t("admin.production.flow.nodes.edit")
                  : t("admin.production.flow.nodes.add")}
              </DialogTitle>
              <DialogDescription>
                {t("admin.production.flow.nodes.formDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.nodes.code")}
                  </Label>
                  <Input
                    value={form.node_code}
                    onChange={(e) =>
                      setForm({ ...form, node_code: e.target.value })
                    }
                    placeholder="STR-MAIN-01"
                    disabled={!!editing}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.nodes.type")}
                  </Label>
                  <Select
                    value={form.node_type}
                    onValueChange={(v) =>
                      setForm({ ...form, node_type: v as FlowNodeType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FLOW_NODE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`admin.production.flow.nodeType.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.nodes.name")}
                </Label>
                <Input
                  value={form.node_name}
                  onChange={(e) =>
                    setForm({ ...form, node_name: e.target.value })
                  }
                  placeholder={t("admin.production.flow.nodes.namePlaceholder")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.nodes.capacity")}
                  </Label>
                  <Input
                    type="number"
                    step={0.1}
                    value={form.capacity_l}
                    onChange={(e) =>
                      setForm({ ...form, capacity_l: e.target.value })
                    }
                    placeholder="1000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.nodes.defaultConcentration")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.default_concentration_pct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        default_concentration_pct: e.target.value,
                      })
                    }
                    placeholder="96"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.production.flow.common.notes")}</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                  resetForm();
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={upsertMutation.isPending}
              >
                {upsertMutation.isPending
                  ? t("common.saving")
                  : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={nodes ?? []}
        searchKey="node_name"
      />

      {/* IoT Config Dialog */}
      <Dialog
        open={!!iotConfigNodeId}
        onOpenChange={(open) => {
          if (!open) setIotConfigNodeId(undefined);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5" />
              {t("admin.production.flow.iotConfig.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.production.flow.iotConfig.description")}
            </DialogDescription>
          </DialogHeader>
          <FlowNodeIotConfigPanel
            nodeId={iotConfigNodeId}
            nodes={nodes}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
